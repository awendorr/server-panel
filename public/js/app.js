// Ortak yardımcılar: API, socket, sayfa yönlendirme, biçimlendirme
window.Panel = (function () {
  const state = { csrfToken: null, username: null, socket: null, current: null };
  const pages = {};

  // ---- API ----
  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (opts.body !== undefined && !(opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    if (opts.method && opts.method !== 'GET') headers['X-CSRF-Token'] = state.csrfToken;
    const res = await fetch(path, Object.assign({}, opts, { headers, credentials: 'same-origin' }));
    if (res.status === 401) {
      location.href = '/login';
      throw new Error('Oturum sona erdi');
    }
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const data = isJson ? await res.json() : await res.text();
    if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    return data;
  }

  // ---- Biçimlendirme ----
  function bytes(n, digits = 1) {
    if (n === null || n === undefined || !Number.isFinite(n)) return '–';
    const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let i = 0;
    while (Math.abs(n) >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i === 0 ? 0 : digits)} ${u[i]}`;
  }
  const rate = (n) => (n === null || n === undefined ? '–' : `${bytes(n)}/s`);
  const pct = (n, d = 1) => (n === null || n === undefined || !Number.isFinite(n) ? '–' : `${n.toFixed(d)}%`);
  function duration(sec) {
    if (!Number.isFinite(sec)) return '–';
    sec = Math.floor(sec);
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d) return `${d}g ${h}s ${m}dk`;
    if (h) return `${h}s ${m}dk`;
    return `${m}dk ${sec % 60}sn`;
  }
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // Kullanım oranına göre renk
  function levelColor(p) {
    if (p === null || p === undefined) return 'bg-slate-600';
    if (p >= 90) return 'bg-rose-500';
    if (p >= 70) return 'bg-amber-500';
    return 'bg-emerald-500';
  }

  // ---- Bildirim ----
  function toast(message, type = 'info', timeout = 5000) {
    const colors = {
      info: 'border-sky-700 bg-sky-950/90',
      success: 'border-emerald-700 bg-emerald-950/90',
      warn: 'border-amber-700 bg-amber-950/90',
      error: 'border-rose-700 bg-rose-950/90',
    };
    const el = document.createElement('div');
    el.className = `rounded-lg border px-4 py-3 text-sm shadow-lg ${colors[type] || colors.info}`;
    el.textContent = message;
    document.getElementById('toasts').appendChild(el);
    if (timeout) setTimeout(() => el.remove(), timeout);
    el.addEventListener('click', () => el.remove());
    return el;
  }

  // ---- Onay penceresi ----
  // requireText verilirse kullanıcının onu yazması gerekir (ör. silinecek dosya adı)
  function confirmDialog({ title, message, confirmText = 'Onayla', danger = false, requireText = null }) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4';
      wrap.innerHTML = `
        <div class="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-xl" role="dialog" aria-modal="true">
          <h3 class="text-lg font-semibold">${escapeHtml(title)}</h3>
          <p class="mt-2 whitespace-pre-line break-words text-sm text-slate-300">${escapeHtml(message)}</p>
          ${requireText ? `<label class="mt-4 block text-xs text-slate-400">Onaylamak için <b class="text-slate-200">${escapeHtml(requireText)}</b> yazın</label>
            <input data-confirm-input class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500">` : ''}
          <div class="mt-5 flex justify-end gap-2">
            <button data-cancel class="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Vazgeç</button>
            <button data-ok class="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-40 ${danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500'}">${escapeHtml(confirmText)}</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      const ok = wrap.querySelector('[data-ok]');
      const input = wrap.querySelector('[data-confirm-input]');
      if (input) {
        ok.disabled = true;
        input.addEventListener('input', () => { ok.disabled = input.value !== requireText; });
        input.focus();
      } else {
        ok.focus();
      }
      const done = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') done(false); };
      document.addEventListener('keydown', onKey);
      wrap.querySelector('[data-cancel]').addEventListener('click', () => done(false));
      ok.addEventListener('click', () => done(true));
      wrap.addEventListener('click', (e) => { if (e.target === wrap) done(false); });
    });
  }

  // Basit metin girişi penceresi
  function promptDialog({ title, label, value = '', confirmText = 'Tamam' }) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4';
      wrap.innerHTML = `
        <form class="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-xl">
          <h3 class="text-lg font-semibold">${escapeHtml(title)}</h3>
          <label class="mt-3 block text-xs text-slate-400">${escapeHtml(label)}</label>
          <input class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500">
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" data-cancel class="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Vazgeç</button>
            <button type="submit" class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">${escapeHtml(confirmText)}</button>
          </div>
        </form>`;
      document.body.appendChild(wrap);
      const input = wrap.querySelector('input');
      input.value = value;
      input.focus();
      input.select();
      const done = (v) => { wrap.remove(); resolve(v); };
      wrap.querySelector('[data-cancel]').addEventListener('click', () => done(null));
      wrap.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); done(input.value.trim() || null); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
    });
  }

  // ---- Socket ----
  function setConn(status) {
    const color = { on: 'bg-emerald-500', off: 'bg-rose-500', wait: 'bg-amber-500' }[status];
    document.querySelectorAll('.conn-dot').forEach((d) => {
      d.classList.remove('bg-slate-600', 'bg-emerald-500', 'bg-rose-500', 'bg-amber-500');
      d.classList.add(color);
    });
    const t = document.getElementById('conn-text');
    if (t) t.textContent = { on: 'Bağlı', off: 'Bağlantı yok', wait: 'Bağlanıyor…' }[status];
  }

  function connectSocket() {
    const socket = io({ transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      setConn('on');
      if (state.current && pages[state.current].onReconnect) pages[state.current].onReconnect(socket);
    });
    socket.on('disconnect', (reason) => {
      setConn('off');
      // Sunucu oturumu kapattıysa giriş sayfasına dön
      if (reason === 'io server disconnect') {
        api('/api/auth/me').then(() => socket.connect()).catch(() => {});
      }
    });
    socket.on('connect_error', (err) => {
      setConn('off');
      if (err && err.data && err.data.code === 401) location.href = '/login';
    });
    socket.io.on('reconnect_attempt', () => setConn('wait'));
    socket.on('alert:fired', (e) => {
      const target = e.target ? ` (${e.target})` : '';
      const msg = `${e.metric.toUpperCase()}${target} %${e.value.toFixed(0)}, eşik %${e.threshold}`;
      toast(`Uyarı: ${msg}`, 'error', 0);
      desktopNotify('Sunucu uyarısı', msg, `alert-${e.id}`);
      refreshAlertBadge();
    });
    socket.on('alert:resolved', (e) => {
      const target = e.target ? ` (${e.target})` : '';
      const msg = `${e.metric.toUpperCase()}${target} eşiğin altına indi`;
      toast(`Düzeldi: ${msg}`, 'success', 8000);
      desktopNotify('Düzeldi', msg, `alert-${e.id}`);
      refreshAlertBadge();
    });
    state.socket = socket;
    return socket;
  }

  // ---- Masaüstü bildirimleri (uygulama penceresi açıkken, simge durumunda bile) ----
  function notificationsSupported() {
    return 'Notification' in window && 'serviceWorker' in navigator && window.isSecureContext;
  }

  async function desktopNotify(title, body, tag) {
    if (!notificationsSupported() || Notification.permission !== 'granted') return;
    const opts = { body, tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', renotify: true, data: { url: '/#alerts' } };
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, opts);
    } catch (_) {
      try { new Notification(title, opts); } catch (__) { /* yok say */ }
    }
  }

  async function enableNotifications() {
    if (!notificationsSupported()) {
      toast('Bu tarayıcı ya da bağlantı bildirimleri desteklemiyor (http://localhost veya https gerekir)', 'warn');
      return false;
    }
    const res = await Notification.requestPermission();
    if (res === 'granted') desktopNotify('Bildirimler açık', 'Sunucu uyarıları artık masaüstü bildirimi olarak gelecek.', 'test');
    else toast('Bildirim izni verilmedi. Tarayıcının site ayarlarından açabilirsiniz.', 'warn');
    return res === 'granted';
  }

  // Menüdeki uyarı rozeti: aktif ya da okunmamış olay sayısı
  async function refreshAlertBadge() {
    try {
      const list = await api('/api/alerts/events?limit=200');
      const n = list.filter((e) => !e.resolved_at || !e.acknowledged).length;
      const link = document.querySelector('#nav [data-page="alerts"]');
      let b = link.querySelector('.alert-badge');
      if (!b) {
        b = document.createElement('span');
        b.className = 'alert-badge rounded-full bg-rose-600 px-1.5 text-[11px] font-medium text-white';
        link.appendChild(b);
      }
      b.textContent = n > 99 ? '99+' : n;
      b.classList.toggle('hidden', n === 0);
      // Görev çubuğundaki uygulama simgesinde de sayı göster
      if ('setAppBadge' in navigator) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
      document.title = n ? `(${n}) Sunucu Paneli` : 'Sunucu Paneli';
    } catch (_) { /* yok say */ }
  }

  // ---- Sayfa yönlendirme ----
  function register(name, page) { pages[name] = page; }

  function navigate() {
    const name = (location.hash || '#dashboard').slice(1);
    const target = pages[name] ? name : 'dashboard';
    if (state.current === target) return;
    if (state.current && pages[state.current].unmount) pages[state.current].unmount();
    const el = document.getElementById('page');
    el.innerHTML = '';
    state.current = target;
    pages[target].mount(el, state.socket);
    document.querySelectorAll('#nav .nav-link').forEach((a) => {
      a.classList.toggle('active', a.dataset.page === target);
    });
    closeSidebar();
    window.scrollTo(0, 0);
  }

  function closeSidebar() {
    document.getElementById('sidebar').classList.add('-translate-x-full');
    document.getElementById('backdrop').classList.add('hidden');
  }

  function setupChrome() {
    document.getElementById('menu-btn').addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('-translate-x-full');
      document.getElementById('backdrop').classList.remove('hidden');
    });
    document.getElementById('backdrop').addEventListener('click', closeSidebar);

    document.querySelectorAll('#nav .nav-link').forEach((a) => {
      a.className = 'nav-link flex items-center justify-between rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800 [&.active]:bg-slate-800 [&.active]:text-white';
      if (a.hasAttribute('data-soon')) {
        a.insertAdjacentHTML('beforeend', '<span class="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">yakında</span>');
      }
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) { /* yok say */ }
      location.href = '/login';
    });
    window.addEventListener('hashchange', navigate);
  }

  async function init() {
    const me = await api('/api/auth/me');
    state.csrfToken = me.csrfToken;
    state.username = me.username;
    document.getElementById('current-user').textContent = me.username;
    setupChrome();
    setConn('wait');
    connectSocket();
    navigate();
    refreshAlertBadge();
  }

  return { state, api, register, init, toast, confirm: confirmDialog, prompt: promptDialog, refreshAlertBadge, enableNotifications, notificationsSupported, fmt: { bytes, rate, pct, duration, escapeHtml, levelColor } };
})();
