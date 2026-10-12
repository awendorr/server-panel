(function () {
  const { fmt } = Panel;

  const LABELS = {
    'auth.login': 'Giriş',
    'auth.login_blocked': 'Giriş engellendi',
    'auth.logout': 'Çıkış',
    'pm2.start': 'PM2 başlat',
    'pm2.stop': 'PM2 durdur',
    'pm2.restart': 'PM2 yeniden başlat',
    'pm2.delete': 'PM2 sil',
    'terminal.open': 'Terminal açıldı',
    'terminal.close': 'Terminal kapatıldı',
    'terminal.exit': 'Kabuk sonlandı',
    'file.write': 'Dosya kaydedildi',
    'file.delete': 'Dosya silindi',
    'file.upload': 'Dosya yüklendi',
    'file.download': 'Dosya indirildi',
    'file.mkdir': 'Klasör oluşturuldu',
    'file.rename': 'Ad değiştirildi',
    'alert.rule_create': 'Uyarı kuralı eklendi',
    'alert.rule_update': 'Uyarı kuralı değişti',
    'alert.rule_delete': 'Uyarı kuralı silindi',
  };

  Panel.register('audit', {
    async mount(el) {
      el.innerHTML = `
        <h1 class="mb-6 text-2xl font-semibold">Audit kaydı</h1>
        <div class="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
          <table class="w-full text-left text-sm">
            <thead class="border-b border-slate-800 text-xs uppercase text-slate-400">
              <tr><th class="px-4 py-3">Zaman</th><th class="px-4 py-3">Kullanıcı</th><th class="px-4 py-3">IP</th>
                  <th class="px-4 py-3">İşlem</th><th class="px-4 py-3">Hedef</th><th class="px-4 py-3">Sonuç</th></tr>
            </thead>
            <tbody id="audit-rows"><tr><td colspan="6" class="px-4 py-6 text-center text-slate-500">Yükleniyor…</td></tr></tbody>
          </table>
        </div>`;
      try {
        const rows = await Panel.api('/api/audit?limit=200');
        el.querySelector('#audit-rows').innerHTML = rows.length ? rows.map((r) => `
          <tr class="border-b border-slate-800/60 last:border-0">
            <td class="tabular whitespace-nowrap px-4 py-2 text-slate-400">${new Date(r.ts).toLocaleString('tr-TR')}</td>
            <td class="px-4 py-2">${fmt.escapeHtml(r.username || '–')}</td>
            <td class="tabular px-4 py-2 text-slate-400">${fmt.escapeHtml(r.ip || '–')}</td>
            <td class="whitespace-nowrap px-4 py-2">${fmt.escapeHtml(LABELS[r.action] || r.action)}</td>
            <td class="max-w-xs truncate px-4 py-2 text-slate-400">${fmt.escapeHtml(r.target || '')}</td>
            <td class="px-4 py-2">${r.success ? '<span class="text-emerald-400">Başarılı</span>' : '<span class="text-rose-400">Başarısız</span>'}</td>
          </tr>`).join('') : '<tr><td colspan="6" class="px-4 py-6 text-center text-slate-500">Kayıt yok</td></tr>';
      } catch (err) {
        Panel.toast(err.message, 'error');
      }
    },
  });
})();
