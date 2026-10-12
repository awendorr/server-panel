(function () {
  const { fmt } = Panel;
  const REFRESH_MS = 3000;

  let root = null, tab = 'processes', sort = 'cpu', filter = '', paused = false, timer = null;
  let data = { processes: null, services: null, ports: null };
  let svcFilter = 'all';

  function template() {
    return `
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h1 class="text-2xl font-semibold">Süreçler ve servisler</h1>
        <div class="inline-flex rounded-lg border border-slate-800 bg-slate-900 p-1 text-sm">
          <button data-stab="processes" class="stab rounded-md px-3 py-1">Süreçler</button>
          <button data-stab="services" class="stab rounded-md px-3 py-1">systemd servisleri</button>
          <button data-stab="ports" class="stab rounded-md px-3 py-1">Açık portlar</button>
        </div>
      </div>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <input id="sys-filter" placeholder="Filtrele…" class="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-slate-500 sm:max-w-xs">
        <div id="sys-extra" class="flex flex-wrap items-center gap-2 text-sm"></div>
        <span id="sys-summary" class="ml-auto text-sm text-slate-400"></span>
      </div>
      <div id="sys-note" class="mb-3 hidden rounded-lg border border-amber-800 bg-amber-950/40 px-4 py-2 text-sm text-amber-200"></div>
      <div class="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
        <table class="w-full text-left text-sm"><thead id="sys-head" class="border-b border-slate-800 text-xs uppercase text-slate-400"></thead><tbody id="sys-body"></tbody></table>
      </div>`;
  }

  const th = (label, extra = '') => `<th class="whitespace-nowrap px-4 py-3 ${extra}">${label}</th>`;
  const match = (...fields) => !filter || fields.some((f) => String(f ?? '').toLowerCase().includes(filter));

  function renderProcesses() {
    const d = data.processes;
    root.querySelector('#sys-extra').innerHTML = `
      <label class="flex items-center gap-1 text-slate-400"><input id="sys-pause" type="checkbox" ${paused ? 'checked' : ''} class="accent-emerald-500"> Duraklat</label>`;
    const arrow = (k) => (sort === k ? ' ↓' : '');
    root.querySelector('#sys-head').innerHTML = `<tr>${th('PID')}${th('Kullanıcı')}
      ${th(`<button data-sort="cpu" class="uppercase hover:text-slate-200">CPU %${arrow('cpu')}</button>`, 'text-right')}
      ${th(`<button data-sort="mem" class="uppercase hover:text-slate-200">RAM %${arrow('mem')}</button>`, 'text-right')}
      ${th('RSS', 'text-right')}${th('Durum')}${th('Komut')}</tr>`;
    if (!d) return loading(7);
    const rows = d.list.filter((p) => match(p.pid, p.name, p.user, p.command));
    root.querySelector('#sys-summary').textContent = `${d.total} süreç · ${d.running} çalışan`;
    root.querySelector('#sys-body').innerHTML = rows.slice(0, 300).map((p) => `
      <tr class="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/40">
        <td class="tabular px-4 py-1.5 text-slate-400">${p.pid}</td>
        <td class="px-4 py-1.5">${fmt.escapeHtml(p.user)}</td>
        <td class="tabular px-4 py-1.5 text-right ${p.cpu >= 50 ? 'text-rose-300' : p.cpu >= 10 ? 'text-amber-300' : ''}">${p.cpu.toFixed(1)}</td>
        <td class="tabular px-4 py-1.5 text-right ${p.mem >= 20 ? 'text-amber-300' : ''}">${p.mem.toFixed(1)}</td>
        <td class="tabular whitespace-nowrap px-4 py-1.5 text-right text-slate-400">${fmt.bytes(p.rss)}</td>
        <td class="px-4 py-1.5 text-slate-400">${fmt.escapeHtml(p.state)}</td>
        <td class="max-w-[28rem] truncate px-4 py-1.5 font-mono text-xs" title="${fmt.escapeHtml(p.command)}">
          <span class="text-slate-200">${fmt.escapeHtml(p.name)}</span> <span class="text-slate-500">${fmt.escapeHtml(p.command.startsWith(p.name) ? p.command.slice(p.name.length) : p.command)}</span></td>
      </tr>`).join('') || empty(7);
  }

  function svcBadge(s) {
    const cls = s.active === 'active' ? (s.sub === 'running' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-sky-500/15 text-sky-300')
      : s.active === 'failed' ? 'bg-rose-500/15 text-rose-300' : 'bg-slate-500/20 text-slate-400';
    return `<span class="rounded-full px-2 py-0.5 text-xs ${cls}">${fmt.escapeHtml(s.active)} · ${fmt.escapeHtml(s.sub)}</span>`;
  }

  function renderServices() {
    const d = data.services;
    const opts = [['all', 'Tümü'], ['running', 'Çalışan'], ['failed', 'Hatalı'], ['inactive', 'Pasif']];
    root.querySelector('#sys-extra').innerHTML = `<select id="svc-filter" class="rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-sm">
      ${opts.map(([v, l]) => `<option value="${v}" ${svcFilter === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    root.querySelector('#sys-head').innerHTML = `<tr>${th('Servis')}${th('Durum')}${th('Açılışta')}${th('Açıklama')}</tr>`;
    if (!d) return loading(4);
    const note = root.querySelector('#sys-note');
    if (!d.available) {
      note.textContent = `systemd kullanılamıyor: ${d.error}`;
      note.classList.remove('hidden');
    }
    const failed = d.list.filter((s) => s.active === 'failed').length;
    const running = d.list.filter((s) => s.sub === 'running').length;
    root.querySelector('#sys-summary').textContent = d.available ? `${d.list.length} servis · ${running} çalışan · ${failed} hatalı` : '';
    const rows = d.list.filter((s) => match(s.unit, s.description)).filter((s) => svcFilter === 'all'
      || (svcFilter === 'running' && s.sub === 'running') || (svcFilter === 'failed' && s.active === 'failed')
      || (svcFilter === 'inactive' && s.active === 'inactive'));
    rows.sort((a, b) => (a.active === 'failed') !== (b.active === 'failed') ? (a.active === 'failed' ? -1 : 1) : a.unit.localeCompare(b.unit));
    root.querySelector('#sys-body').innerHTML = rows.map((s) => `
      <tr class="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/40">
        <td class="whitespace-nowrap px-4 py-1.5 font-medium">${fmt.escapeHtml(s.unit.replace(/\.service$/, ''))}</td>
        <td class="whitespace-nowrap px-4 py-1.5">${svcBadge(s)}</td>
        <td class="px-4 py-1.5 text-slate-400">${s.enabled === 'enabled' ? '<span class="text-violet-300">evet</span>' : fmt.escapeHtml(s.enabled || '–')}</td>
        <td class="max-w-md truncate px-4 py-1.5 text-slate-400">${fmt.escapeHtml(s.description)}</td>
      </tr>`).join('') || empty(4);
  }

  function renderPorts() {
    const d = data.ports;
    root.querySelector('#sys-extra').innerHTML = '';
    root.querySelector('#sys-head').innerHTML = `<tr>${th('Protokol')}${th('Adres')}${th('Port', 'text-right')}${th('Süreç')}${th('PID', 'text-right')}${th('Kullanıcı')}${th('Erişim')}</tr>`;
    if (!d) return loading(7);
    const note = root.querySelector('#sys-note');
    if (d.partial) {
      note.textContent = 'Panel root olarak çalışmadığı için başka kullanıcılara ait süreçlerin adları görünmeyebilir.';
      note.classList.remove('hidden');
    }
    const rows = d.list.filter((p) => match(p.port, p.process, p.address, p.user, p.proto));
    root.querySelector('#sys-summary').textContent = `${d.list.length} dinleyen soket · ${d.list.filter((p) => p.public).length} dışa açık`;
    root.querySelector('#sys-body').innerHTML = rows.map((p) => `
      <tr class="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/40">
        <td class="px-4 py-1.5 uppercase text-slate-400">${p.proto}</td>
        <td class="px-4 py-1.5 font-mono text-xs">${fmt.escapeHtml(p.address)}</td>
        <td class="tabular px-4 py-1.5 text-right font-medium">${p.port}</td>
        <td class="px-4 py-1.5">${fmt.escapeHtml(p.process || '–')}</td>
        <td class="tabular px-4 py-1.5 text-right text-slate-400">${p.pid ?? '–'}</td>
        <td class="px-4 py-1.5 text-slate-400">${fmt.escapeHtml(p.user)}</td>
        <td class="px-4 py-1.5">${p.public ? '<span class="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">dışa açık</span>' : '<span class="rounded-full bg-slate-500/20 px-2 py-0.5 text-xs text-slate-400">yerel</span>'}</td>
      </tr>`).join('') || empty(7);
  }

  const loading = (n) => { root.querySelector('#sys-body').innerHTML = `<tr><td colspan="${n}" class="px-4 py-6 text-center text-slate-500">Yükleniyor…</td></tr>`; };
  const empty = (n) => `<tr><td colspan="${n}" class="px-4 py-6 text-center text-slate-500">Kayıt yok</td></tr>`;

  function render() {
    if (!root) return;
    root.querySelectorAll('.stab').forEach((b) => {
      const on = b.dataset.stab === tab;
      b.classList.toggle('bg-slate-700', on);
      b.classList.toggle('text-white', on);
    });
    root.querySelector('#sys-note').classList.add('hidden');
    ({ processes: renderProcesses, services: renderServices, ports: renderPorts })[tab]();
  }

  async function refresh() {
    if (!root) return;
    const current = tab;
    try {
      const url = current === 'processes' ? `/api/system/processes?sort=${sort}` : `/api/system/${current}`;
      data[current] = await Panel.api(url);
      if (current === tab) render();
    } catch (err) {
      Panel.toast(err.message, 'error');
    }
  }

  function schedule() {
    clearInterval(timer);
    // Servis ve port listesi daha seyrek değişir
    const every = tab === 'processes' ? REFRESH_MS : 10000;
    timer = setInterval(() => { if (!paused || tab !== 'processes') refresh(); }, every);
  }

  Panel.register('system', {
    mount(el) {
      root = el;
      root.innerHTML = template();
      root.querySelector('#sys-filter').addEventListener('input', (e) => { filter = e.target.value.trim().toLowerCase(); render(); });
      root.addEventListener('click', (e) => {
        const t = e.target.closest('[data-stab]');
        if (t) { tab = t.dataset.stab; render(); refresh(); schedule(); }
        const s = e.target.closest('[data-sort]');
        if (s) { sort = s.dataset.sort; data.processes && data.processes.list.sort((a, b) => b[sort] - a[sort]); render(); refresh(); }
      });
      root.addEventListener('change', (e) => {
        if (e.target.id === 'sys-pause') paused = e.target.checked;
        if (e.target.id === 'svc-filter') { svcFilter = e.target.value; render(); }
      });
      render();
      refresh();
      schedule();
    },
    unmount() {
      clearInterval(timer);
      root = null;
    },
  });
})();
