(function () {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  fetch('/api/auth/status').then((r) => r.json()).then((s) => {
    if (s.loggedIn) location.href = '/';
    if (!s.hasUsers) document.getElementById('no-users').classList.remove('hidden');
  }).catch(() => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');
    btn.disabled = true;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: form.username.value,
          password: form.password.value,
        }),
      });
      if (res.ok) {
        location.href = '/';
        return;
      }
      const data = await res.json().catch(() => ({}));
      errorEl.textContent = data.error || 'Giriş başarısız';
      errorEl.classList.remove('hidden');
      form.password.value = '';
      form.password.focus();
    } catch (_) {
      errorEl.textContent = 'Sunucuya ulaşılamadı';
      errorEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  });
})();
