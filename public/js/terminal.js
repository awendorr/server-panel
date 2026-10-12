(function () {
  const THEME = {
    background: '#020617', foreground: '#e2e8f0', cursor: '#34d399', cursorAccent: '#020617',
    selectionBackground: '#334155',
    black: '#1e293b', red: '#f87171', green: '#34d399', yellow: '#fbbf24', blue: '#60a5fa',
    magenta: '#c084fc', cyan: '#22d3ee', white: '#e2e8f0',
    brightBlack: '#475569', brightRed: '#fca5a5', brightGreen: '#6ee7b7', brightYellow: '#fde68a',
    brightBlue: '#93c5fd', brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#f8fafc',
  };
  // Mobilde klavyede olmayan tuşlar
  const KEYS = [
    ['Esc', '\x1b'], ['Tab', '\t'], ['Ctrl+C', '\x03'], ['Ctrl+D', '\x04'], ['Ctrl+L', '\x0c'],
    ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C'],
  ];

  // Sekmeler sayfa değişince de yaşar; DOM'u saklayıp geri takarız
  let wrapper = null;
  let socket = null;
  let tabs = []; // { id, title, term, fit, el, alive }
  let active = null;
  let counter = 0;
  let observer = null;
  let bound = false;

  function build() {
    wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold">Terminal</h1>
          <p class="text-sm text-slate-400">Sunucuda etkileşimli kabuk. Panelden çıkınca ya da bağlantı kopunca açık kabuklar kapanır.</p>
        </div>
      </div>
      <div class="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
        <div class="flex items-center gap-1 overflow-x-auto border-b border-slate-800 bg-slate-900 px-2 py-1.5">
          <div id="term-tabs" class="flex items-center gap-1"></div>
          <button id="term-new" title="Yeni sekme" class="ml-1 shrink-0 rounded-md px-2.5 py-1 text-lg leading-none text-slate-300 hover:bg-slate-800">+</button>
        </div>
        <div id="term-host" class="relative h-[calc(100vh-260px)] min-h-[320px] md:h-[calc(100vh-220px)]"></div>
        <div id="term-keys" class="flex gap-1 overflow-x-auto border-t border-slate-800 bg-slate-900 px-2 py-1.5 md:hidden">
          ${KEYS.map(([l], i) => `<button data-key="${i}" class="shrink-0 rounded-md bg-slate-800 px-2.5 py-1 text-xs text-slate-200">${l}</button>`).join('')}
        </div>
      </div>`;
    wrapper.querySelector('#term-new').addEventListener('click', () => openTab());
    wrapper.querySelector('#term-keys').addEventListener('click', (e) => {
      const b = e.target.closest('[data-key]');
      if (!b || !active || !active.alive) return;
      socket.emit('term:input', { id: active.id, data: KEYS[Number(b.dataset.key)][1] });
      active.term.focus();
    });
    observer = new ResizeObserver(() => fitActive());
    observer.observe(wrapper.querySelector('#term-host'));
  }

  function renderTabs() {
    wrapper.querySelector('#term-tabs').innerHTML = tabs.map((t, i) => `
      <div data-tab="${i}" class="group flex shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 py-1 text-sm
        ${t === active ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800/60'}">
        <span class="h-1.5 w-1.5 rounded-full ${t.alive ? 'bg-emerald-400' : 'bg-slate-600'}"></span>
        <span>${Panel.fmt.escapeHtml(t.title)}</span>
        <button data-close="${i}" title="Kapat" class="rounded px-1 text-slate-500 hover:bg-slate-700 hover:text-slate-200">×</button>
      </div>`).join('');
    wrapper.querySelectorAll('[data-tab]').forEach((el) => el.addEventListener('click', (e) => {
      const idx = Number(el.dataset.tab);
      if (e.target.closest('[data-close]')) closeTab(tabs[idx]);
      else activate(tabs[idx]);
    }));
  }

  function fitActive() {
    if (!active || !wrapper.isConnected) return;
    try {
      active.fit.fit();
      if (active.alive) socket.emit('term:resize', { id: active.id, cols: active.term.cols, rows: active.term.rows });
    } catch (_) { /* görünmezken ölçülemez */ }
  }

  function activate(tab) {
    active = tab;
    tabs.forEach((t) => { t.el.style.display = t === tab ? 'block' : 'none'; });
    renderTabs();
    if (tab) {
      requestAnimationFrame(() => { fitActive(); tab.term.focus(); });
    }
  }

  function openTab() {
    const el = document.createElement('div');
    el.className = 'absolute inset-0 p-2';
    wrapper.querySelector('#term-host').appendChild(el);
    const term = new Terminal({
      theme: THEME,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: window.innerWidth < 640 ? 12 : 14,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: false,
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(el);
    const tab = { id: null, title: `Kabuk ${++counter}`, term, fit, el, alive: false };
    tabs.push(tab);
    activate(tab);
    try { fit.fit(); } catch (_) { /* yok say */ }

    term.writeln('\x1b[90mBağlanıyor…\x1b[0m');
    socket.emit('term:open', { cols: term.cols, rows: term.rows }, (res) => {
      if (!res || !res.ok) {
        term.writeln(`\x1b[31mTerminal açılamadı: ${(res && res.error) || 'bilinmeyen hata'}\x1b[0m`);
        return;
      }
      tab.id = res.id;
      tab.alive = true;
      term.reset();
      renderTabs();
      fitActive();
    });
    term.onData((data) => { if (tab.alive) socket.emit('term:input', { id: tab.id, data }); });
    term.onTitleChange((t) => { if (t) { tab.title = t.slice(0, 30); renderTabs(); } });
  }

  function markEnded(tab, message) {
    if (!tab.alive) return;
    tab.alive = false;
    tab.term.writeln(`\r\n\x1b[90m${message}\x1b[0m`);
    renderTabs();
  }

  function closeTab(tab) {
    if (tab.alive) socket.emit('term:close', { id: tab.id });
    tab.term.dispose();
    tab.el.remove();
    const idx = tabs.indexOf(tab);
    tabs.splice(idx, 1);
    if (active === tab) activate(tabs[Math.min(idx, tabs.length - 1)] || null);
    else renderTabs();
  }

  function bindSocket() {
    if (bound) return;
    bound = true;
    socket.on('term:data', ({ id, data }) => {
      const t = tabs.find((x) => x.id === id);
      if (t) t.term.write(data);
    });
    socket.on('term:exit', ({ id, code }) => {
      const t = tabs.find((x) => x.id === id);
      if (t) markEnded(t, `[Kabuk kapandı, çıkış kodu ${code}]`);
    });
    // Bağlantı koparsa sunucu kabukları sonlandırır
    socket.on('disconnect', () => tabs.forEach((t) => markEnded(t, '[Bağlantı koptu, kabuk sonlandırıldı. Yeni sekme açın.]')));
  }

  Panel.register('terminal', {
    mount(el, sock) {
      socket = sock;
      if (!wrapper) build();
      el.appendChild(wrapper);
      bindSocket();
      if (!tabs.length) openTab();
      else activate(active || tabs[0]);
    },
    unmount() {
      // Kabukları kapatma, sadece görünümü ayır
      if (wrapper) wrapper.remove();
    },
  });
})();
