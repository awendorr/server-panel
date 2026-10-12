(function () {
  const { fmt } = Panel;
  const MAX_LOG_CHARS = 400 * 1000;

  const STATUS = {
    online: ['Çalışıyor', 'bg-emerald-500/15 text-emerald-300'],
    stopped: ['Durdu', 'bg-slate-500/20 text-slate-300'],
    stopping: ['Duruyor', 'bg-amber-500/15 text-amber-300'],
    launching: ['Başlıyor', 'bg-sky-500/15 text-sky-300'],
    errored: ['Hata', 'bg-rose-500/15 text-rose-300'],
    'one-launch-status': ['Tek sefer', 'bg-slate-500/20 text-slate-300'],
  };

  let root, socket, procs = [], selected = null, logTab = 'out';
  let logs = { out: '', err: '' };
  let handlers = {};

  function badge(status) {
    const [label, cls] = STATUS[status] || [status, 'bg-slate-500/20 text-slate-300'];
    return `<span class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${cls}">
      <span class="h-1.5 w-1.5 rounded-full bg-current"></span>${fmt.escapeHtml(label)}</span>`;
  }

  function btn(act, label, cls, disabled) {
    return `<button data-act="${act}" ${disabled ? 'disabled' : ''}
      class="rounded-md px-2 py-1 text-xs ${cls} disabled:cursor-not-allowed disabled:opacity-30">${label}</button>`;
  }

  function actionButtons(p) {
    const online = p.status === 'online' || p.status === 'launching';
    return `<div class="flex flex-wrap justify-end gap-1">
      ${btn('start', 'Başlat', 'bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30', online)}
      ${btn('restart', 'Yeniden başlat', 'bg-sky-600/20 text-sky-300 hover:bg-sky-600/30', false)}
      ${btn('stop', 'Durdur', 'bg-amber-600/20 text-amber-300 hover:bg-amber-600/30', !online)}
      ${btn('delete', 'Sil', 'bg-rose-600/20 text-rose-300 hover:bg-rose-600/30', false)}
    </div>`;
  }

  function template() {
    return `
      <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold">PM2 süreçleri</h1>
          <p class="text-sm text-slate-400">Satıra tıklayarak loglarını açın. <span class="rounded bg-violet-500/15 px-1.5 py-0.5 text-xs text-violet-300">açılışta</span> rozeti, <code>pm2 save</code> listesindekileri gösterir.</p>
        </div>
        <span id="pm2-summary" class="text-sm text-slate-400"></span>
      </div>
      <div id="pm2-error" class="mb-4 hidden rounded-lg border border-rose-800 bg-rose-950/50 px-4 py-3 text-sm text-rose-200"></div>
      <div class="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
        <table class="w-full min-w-[760px] text-left text-sm">
          <thead class="border-b border-slate-800 text-xs uppercase text-slate-400">
            <tr>
              <th class="px-4 py-3">Ad</th><th class="px-4 py-3">Durum</th>
              <th class="px-4 py-3 text-right">CPU</th><th class="px-4 py-3 text-right">RAM</th>
              <th class="px-4 py-3 text-right">Restart</th><th class="px-4 py-3 text-right">Uptime</th>
              <th class="px-4 py-3 text-right">İşlemler</th>
            </tr>
          </thead>
          <tbody id="pm2-rows"><tr><td colspan="7" class="px-4 py-6 text-center text-slate-500">Yükleniyor…</td></tr></tbody>
        </table>
      </div>

      <section id="pm2-logs" class="mt-6 hidden rounded-xl border border-slate-800 bg-slate-900">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
          <h2 class="font-semibold">Loglar: <span id="log-name" class="text-emerald-300"></span></h2>
          <div class="flex items-center gap-2">
            <div class="inline-flex rounded-lg border border-slate-800 bg-slate-950 p-1 text-sm">
              <button data-tab="out" class="log-tab rounded-md px-3 py-1">stdout</button>
              <button data-tab="err" class="log-tab rounded-md px-3 py-1">stderr <span id="err-count" class="ml-1 hidden rounded bg-rose-600 px-1 text-[10px] text-white"></span></button>
            </div>
            <label class="flex items-center gap-1 text-xs text-slate-400"><input id="log-follow" type="checkbox" checked class="accent-emerald-500"> Takip et</label>
            <button id="log-clear" class="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">Temizle</button>
            <button id="log-close" class="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">Kapat</button>
          </div>
        </div>
        <pre id="log-view" class="h-[420px] overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-xs leading-relaxed text-slate-300"></pre>
      </section>`;
  }

  function renderList() {
    const tbody = root.querySelector('#pm2-rows');
    const online = procs.filter((p) => p.status === 'online').length;
    root.querySelector('#pm2-summary').textContent = procs.length ? `${online} / ${procs.length} çalışıyor` : '';
    if (!procs.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-6 text-center text-slate-500">PM2 altında süreç yok</td></tr>';
      return;
    }
    tbody.innerHTML = procs.map((p) => `
      <tr data-id="${p.id}" class="cursor-pointer border-b border-slate-800/60 last:border-0 hover:bg-slate-800/40 ${selected && selected.id === p.id ? 'bg-slate-800/60' : ''}">
        <td class="px-4 py-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium">${fmt.escapeHtml(p.name)}</span>
            <span class="text-xs text-slate-500">#${p.id}</span>
            ${p.saved ? '<span class="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-300" title="pm2 save listesinde: açılışta otomatik başlar">açılışta</span>' : ''}
            ${p.isPanel ? '<span class="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">bu panel</span>' : ''}
            ${p.mode === 'cluster' ? '<span class="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300">cluster</span>' : ''}
          </div>
          <div class="max-w-xs truncate text-xs text-slate-500" title="${fmt.escapeHtml(p.script)}">${fmt.escapeHtml(p.script || '')}</div>
        </td>
        <td class="px-4 py-3">${badge(p.status)}</td>
        <td class="tabular px-4 py-3 text-right">${p.cpu === null ? '–' : p.cpu + '%'}</td>
        <td class="tabular px-4 py-3 text-right">${fmt.bytes(p.memory)}</td>
        <td class="tabular px-4 py-3 text-right ${p.restarts > 10 ? 'text-amber-300' : ''}">${p.restarts}</td>
        <td class="tabular px-4 py-3 text-right">${p.uptime === null ? '–' : fmt.duration(p.uptime / 1000)}</td>
        <td class="px-4 py-3">${actionButtons(p)}</td>
      </tr>`).join('');
  }

  async function runAction(p, act) {
    const labels = { start: 'başlatılsın', stop: 'durdurulsun', restart: 'yeniden başlatılsın', delete: 'PM2 listesinden silinsin' };
    if (act !== 'start') {
      let message = `"${p.name}" ${labels[act]} mı?`;
      if (p.isPanel && act !== 'restart') message += '\n\nDikkat: bu, şu an kullandığınız panelin kendisi. Panel kapanacak ve tekrar başlatmak için sunucuya SSH ile bağlanmanız gerekecek.';
      if (act === 'delete') message += '\n\nSüreç durdurulur ve listeden kaldırılır. Uygulama dosyalarına dokunulmaz.';
      const ok = await Panel.confirm({
        title: { stop: 'Süreci durdur', restart: 'Yeniden başlat', delete: 'Süreci sil' }[act],
        message,
        confirmText: { stop: 'Durdur', restart: 'Yeniden başlat', delete: 'Sil' }[act],
        danger: act !== 'restart',
        requireText: p.isPanel && act !== 'restart' ? p.name : null,
      });
      if (!ok) return;
    }
    try {
      await Panel.api(`/api/pm2/${p.id}/${act}`, { method: 'POST', body: { name: p.name } });
      const done = { start: 'başlatıldı', stop: 'durduruldu', restart: 'yeniden başlatıldı', delete: 'silindi' };
      Panel.toast(`"${p.name}" ${done[act]}`, 'success', 3000);
      if (act === 'delete' && selected && selected.id === p.id) closeLogs();
    } catch (err) {
      Panel.toast(`İşlem başarısız: ${err.message}`, 'error');
    }
  }

  // ---- Loglar ----
  function trim(s) { return s.length > MAX_LOG_CHARS ? s.slice(s.length - MAX_LOG_CHARS) : s; }

  function renderLogs() {
    const view = root.querySelector('#log-view');
    view.textContent = logs[logTab] || (logTab === 'out' ? 'stdout boş' : 'stderr boş');
    view.classList.toggle('text-rose-200', logTab === 'err');
    if (root.querySelector('#log-follow').checked) view.scrollTop = view.scrollHeight;
    root.querySelectorAll('.log-tab').forEach((b) => {
      const on = b.dataset.tab === logTab;
      b.classList.toggle('bg-slate-700', on);
      b.classList.toggle('text-white', on);
    });
  }

  let newErr = 0;
  function setErrCount(n) {
    newErr = n;
    const el = root.querySelector('#err-count');
    el.textContent = n > 99 ? '99+' : n;
    el.classList.toggle('hidden', n === 0);
  }

  async function openLogs(p) {
    selected = p;
    logs = { out: '', err: '' };
    setErrCount(0);
    root.querySelector('#pm2-logs').classList.remove('hidden');
    root.querySelector('#log-name').textContent = p.name;
    root.querySelector('#log-view').textContent = 'Yükleniyor…';
    renderList();
    socket.emit('pm2:logs:subscribe', p.id);
    try {
      const data = await Panel.api(`/api/pm2/${p.id}/logs`);
      if (!selected || selected.id !== p.id) return;
      // Bu arada soketten gelen satırları geçmişin sonuna ekle
      logs = { out: trim(data.out + logs.out), err: trim(data.err + logs.err) };
      renderLogs();
      root.querySelector('#pm2-logs').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      Panel.toast('Loglar alınamadı: ' + err.message, 'error');
    }
  }

  function closeLogs() {
    selected = null;
    socket.emit('pm2:logs:unsubscribe');
    root.querySelector('#pm2-logs').classList.add('hidden');
    renderList();
  }

  Panel.register('pm2', {
    mount(el, sock) {
      root = el;
      socket = sock;
      root.innerHTML = template();

      root.querySelector('#pm2-rows').addEventListener('click', (e) => {
        const tr = e.target.closest('tr[data-id]');
        if (!tr) return;
        const p = procs.find((x) => x.id === Number(tr.dataset.id));
        if (!p) return;
        const b = e.target.closest('[data-act]');
        if (b) runAction(p, b.dataset.act);
        else openLogs(p);
      });
      root.querySelectorAll('.log-tab').forEach((b) => b.addEventListener('click', () => {
        logTab = b.dataset.tab;
        if (logTab === 'err') setErrCount(0);
        renderLogs();
      }));
      root.querySelector('#log-clear').addEventListener('click', () => { logs[logTab] = ''; renderLogs(); });
      root.querySelector('#log-close').addEventListener('click', closeLogs);

      handlers = {
        'pm2:list': (list) => {
          procs = list;
          root.querySelector('#pm2-error').classList.add('hidden');
          if (selected) selected = procs.find((p) => p.id === selected.id) || selected;
          renderList();
        },
        'pm2:error': (msg) => {
          const e = root.querySelector('#pm2-error');
          e.textContent = msg;
          e.classList.remove('hidden');
        },
        'pm2:log': (entry) => {
          if (!selected || entry.id !== selected.id) return;
          logs[entry.type] = trim(logs[entry.type] + entry.data);
          if (entry.type === 'err' && logTab !== 'err') setErrCount(newErr + 1);
          if (entry.type === logTab) renderLogs();
        },
      };
      Object.entries(handlers).forEach(([ev, fn]) => socket.on(ev, fn));
      if (socket.connected) socket.emit('pm2:subscribe');
      renderLogs();
    },
    onReconnect(sock) {
      sock.emit('pm2:subscribe');
      if (selected) sock.emit('pm2:logs:subscribe', selected.id);
    },
    unmount() {
      Object.entries(handlers).forEach(([ev, fn]) => socket.off(ev, fn));
      socket.emit('pm2:unsubscribe');
      socket.emit('pm2:logs:unsubscribe');
      selected = null;
      procs = [];
      root = null;
    },
  });
})();
