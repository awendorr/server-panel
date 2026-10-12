(function () {
  const { fmt } = Panel;
  const METRIC_LABELS = { cpu: 'CPU', ram: 'RAM', swap: 'Swap', disk: 'Disk' };

  let root = null, rules = [], events = [], handlers = {}, socket = null;

  function template() {
    return `
      <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold">Uyarılar</h1>
          <p class="text-sm text-slate-400">Eşik, belirtilen süre boyunca aşılırsa panelde bildirim gösterilir.</p>
        </div>
        <button id="notif-btn" class="hidden rounded-lg border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800">Masaüstü bildirimlerini aç</button>
      </div>

      <section class="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 class="mb-3 font-semibold">Kurallar</h2>
        <div id="rules" class="space-y-2"></div>
        <form id="rule-form" class="mt-4 grid grid-cols-2 gap-2 border-t border-slate-800 pt-4 text-sm md:grid-cols-5">
          <label class="flex flex-col gap-1 text-xs text-slate-400">Metrik
            <select name="metric" class="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-200">
              ${Object.entries(METRIC_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
            </select></label>
          <label class="flex flex-col gap-1 text-xs text-slate-400">Disk bölümü
            <select name="target" disabled class="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-200 disabled:opacity-40"><option value="">Tümü</option></select></label>
          <label class="flex flex-col gap-1 text-xs text-slate-400">Eşik (%)
            <input name="threshold" type="number" min="1" max="100" value="85" required class="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-200"></label>
          <label class="flex flex-col gap-1 text-xs text-slate-400">Süre (sn)
            <input name="duration_sec" type="number" min="0" max="86400" value="60" required class="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-200"></label>
          <button class="col-span-2 self-end rounded-lg bg-emerald-600 px-3 py-2 font-medium text-white hover:bg-emerald-500 md:col-span-1">Kural ekle</button>
        </form>
      </section>

      <section class="mt-6 rounded-xl border border-slate-800 bg-slate-900">
        <div class="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 class="font-semibold">Olaylar</h2>
          <button id="ack-all" class="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">Tümünü okundu say</button>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[640px] text-left text-sm">
            <thead class="border-b border-slate-800 text-xs uppercase text-slate-400"><tr>
              <th class="px-4 py-3">Durum</th><th class="px-4 py-3">Metrik</th><th class="px-4 py-3 text-right">En yüksek</th>
              <th class="px-4 py-3 text-right">Eşik</th><th class="px-4 py-3">Başlangıç</th><th class="px-4 py-3">Süre</th><th class="px-4 py-3"></th></tr></thead>
            <tbody id="events"></tbody>
          </table>
        </div>
      </section>`;
  }

  function ruleText(r) {
    const target = r.metric === 'disk' ? (r.target ? ` (${r.target})` : ' (tüm bölümler)') : '';
    return `${METRIC_LABELS[r.metric]}${target} %${r.threshold} üzerinde, ${r.duration_sec} sn boyunca`;
  }

  function renderRules() {
    root.querySelector('#rules').innerHTML = rules.length ? rules.map((r) => `
      <div class="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm">
        <label class="relative inline-flex cursor-pointer items-center">
          <input type="checkbox" data-toggle="${r.id}" ${r.enabled ? 'checked' : ''} class="peer sr-only">
          <span class="h-5 w-9 rounded-full bg-slate-700 transition peer-checked:bg-emerald-600"></span>
          <span class="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-4"></span>
        </label>
        <span class="flex-1 ${r.enabled ? '' : 'text-slate-500'}">${fmt.escapeHtml(ruleText(r))}</span>
        <button data-del-rule="${r.id}" class="rounded-md px-2 py-1 text-xs text-rose-300 hover:bg-rose-900/40">Sil</button>
      </div>`).join('') : '<p class="text-sm text-slate-500">Henüz kural yok</p>';
  }

  function renderEvents() {
    const now = Date.now();
    root.querySelector('#events').innerHTML = events.length ? events.map((e) => {
      const active = !e.resolved_at;
      const dur = ((e.resolved_at || now) - e.started_at) / 1000;
      return `<tr class="border-b border-slate-800/60 last:border-0 ${active ? 'bg-rose-950/30' : ''}">
        <td class="px-4 py-2">${active ? '<span class="rounded-full bg-rose-500/20 px-2 py-0.5 text-xs text-rose-300">aktif</span>' : '<span class="rounded-full bg-slate-500/20 px-2 py-0.5 text-xs text-slate-400">çözüldü</span>'}</td>
        <td class="px-4 py-2">${METRIC_LABELS[e.metric] || e.metric}${e.target ? ` <span class="text-slate-500">${fmt.escapeHtml(e.target)}</span>` : ''}</td>
        <td class="tabular px-4 py-2 text-right">${fmt.pct(e.value)}</td>
        <td class="tabular px-4 py-2 text-right text-slate-400">%${e.threshold}</td>
        <td class="tabular whitespace-nowrap px-4 py-2 text-slate-400">${new Date(e.started_at).toLocaleString('tr-TR')}</td>
        <td class="tabular whitespace-nowrap px-4 py-2 text-slate-400">${fmt.duration(dur)}</td>
        <td class="px-4 py-2 text-right">${e.acknowledged ? '' : `<button data-ack="${e.id}" class="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">Okundu</button>`}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="7" class="px-4 py-6 text-center text-slate-500">Henüz uyarı olmadı</td></tr>';
  }

  async function load() {
    try {
      [rules, events] = await Promise.all([Panel.api('/api/alerts/rules'), Panel.api('/api/alerts/events?limit=200')]);
      if (!root) return;
      renderRules();
      renderEvents();
    } catch (err) { Panel.toast(err.message, 'error'); }
  }

  async function fillMounts() {
    try {
      const cur = await Panel.api('/api/metrics/current');
      const sel = root && root.querySelector('select[name="target"]');
      if (!sel || !cur) return;
      sel.innerHTML = '<option value="">Tümü</option>' + cur.disks.map((d) => `<option>${fmt.escapeHtml(d.mount)}</option>`).join('');
    } catch (_) { /* yok say */ }
  }

  Panel.register('alerts', {
    mount(el, sock) {
      root = el;
      socket = sock;
      root.innerHTML = template();
      const form = root.querySelector('#rule-form');
      form.metric.addEventListener('change', () => { form.target.disabled = form.metric.value !== 'disk'; });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await Panel.api('/api/alerts/rules', { method: 'POST', body: {
            metric: form.metric.value,
            target: form.metric.value === 'disk' ? form.target.value : null,
            threshold: Number(form.threshold.value),
            duration_sec: Number(form.duration_sec.value),
          } });
          Panel.toast('Kural eklendi', 'success', 2000);
          load();
        } catch (err) { Panel.toast(err.message, 'error'); }
      });
      root.addEventListener('change', async (e) => {
        const id = e.target.dataset.toggle;
        if (!id) return;
        try { await Panel.api(`/api/alerts/rules/${id}`, { method: 'PUT', body: { enabled: e.target.checked } }); load(); } catch (err) { Panel.toast(err.message, 'error'); }
      });
      root.addEventListener('click', async (e) => {
        const del = e.target.closest('[data-del-rule]');
        const ack = e.target.closest('[data-ack]');
        try {
          if (del) {
            const r = rules.find((x) => x.id === Number(del.dataset.delRule));
            if (!(await Panel.confirm({ title: 'Kuralı sil', message: ruleText(r), confirmText: 'Sil', danger: true }))) return;
            await Panel.api(`/api/alerts/rules/${r.id}`, { method: 'DELETE' });
            load();
          } else if (ack) {
            await Panel.api(`/api/alerts/events/${ack.dataset.ack}/ack`, { method: 'POST' });
            load();
            Panel.refreshAlertBadge();
          } else if (e.target.id === 'ack-all') {
            await Panel.api('/api/alerts/events/ack-all', { method: 'POST' });
            load();
            Panel.refreshAlertBadge();
          }
        } catch (err) { Panel.toast(err.message, 'error'); }
      });
      const nb = root.querySelector('#notif-btn');
      const updateNotifBtn = () => {
        const on = Panel.notificationsSupported() && Notification.permission === 'granted';
        nb.classList.remove('hidden');
        nb.textContent = on ? 'Masaüstü bildirimleri açık' : 'Masaüstü bildirimlerini aç';
        nb.disabled = on;
        nb.classList.toggle('text-emerald-300', on);
      };
      nb.addEventListener('click', async () => { await Panel.enableNotifications(); updateNotifBtn(); });
      updateNotifBtn();
      handlers = { 'alert:fired': load, 'alert:resolved': load };
      Object.entries(handlers).forEach(([ev, fn]) => socket.on(ev, fn));
      load();
      fillMounts();
    },
    unmount() {
      Object.entries(handlers).forEach(([ev, fn]) => socket.off(ev, fn));
      root = null;
    },
  });
})();
