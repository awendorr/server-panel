# Aşama 2-5 test adımları

Panel çalışırken (`pm2 start ecosystem.config.js` ya da `./install.sh`) tarayıcıdan giriş yapın.

## Aşama 2: PM2
```bash
# Test için iki örnek süreç
cat > /tmp/demo.js <<'JS'
let i = 0; setInterval(() => { i++; console.log(`istek ${i}`); if (i % 3 === 0) console.error(`uyarı ${i}`); }, 1000);
JS
pm2 start /tmp/demo.js --name demo-api
pm2 save                                   # demo-api "açılışta" rozeti almalı
pm2 start /tmp/demo.js --name kaydedilmemis # bunda rozet olmamalı
```
- **PM2** sayfasında iki süreç; CPU, RAM, restart ve uptime 2 sn'de bir güncellenmeli.
- `demo-api` satırına tıklayın: stdout'ta "istek N", stderr sekmesinde "uyarı N" satırları canlı akmalı.
- "Durdur" → onay penceresi → durum "Durdu" olmalı; "Başlat" ile geri gelmeli. "Sil" ile listeden kalkmalı.
- Panelin kendi satırında "bu panel" rozeti görünür; onu durdurmak/silmek için adını yazmanız istenir.
- **Audit kaydı**'nda "PM2 durdur" vb. satırlar olmalı.
- Temizlik: `pm2 delete demo-api kaydedilmemis && pm2 save`

## Aşama 3: Terminal
- **Terminal** sayfası açılınca bir kabuk açılır: `whoami`, `htop` (q ile çık), `nano /tmp/x` deneyin.
- "+" ile ikinci sekme açın, sekmeler arasında geçin; her biri kendi geçmişini korumalı.
- Pencereyi daraltın/genişletin: `tput cols` farklı değer vermeli.
- Başka bir sayfaya gidip dönün: sekmeler duruyor olmalı.
- Çıkış yapın ya da tarayıcı sekmesini kapatın: `ps aux | grep -- "-bash"` ile kabukların kapandığını görün.
- Audit kaydında "Terminal açıldı / kapatıldı".

## Aşama 4: Dosya yöneticisi
- **Dosyalar** ana klasörünüzle açılır. Yol kutusuna `/etc` yazıp Enter, kırıntı yolundan geri dönün.
- "Yeni dosya" → `deneme.js` → editör açılır, renklendirme olmalı; yazıp Ctrl+S → "Kaydedildi".
- Dosyayı yeniden açın, içerik korunmuş olmalı. Aynı dosyayı terminalden değiştirip editörden kaydetmeyi deneyin: "Dosya siz düzenlerken değişti" uyarısı gelmeli.
- "Yükle" ya da sürükle-bırak ile dosya yükleyin; aynı dosyayı tekrar yüklerken üzerine yazma onayı sorulmalı.
- "İndir" dosyayı indirmeli. İkili bir dosyayı (ör. `/bin/ls`) açmaya çalışınca indirme önerilmeli.
- Dosya silerken onay; klasör silerken klasör adını yazmanız istenir.
- **Path traversal testi** (`.env` içinde `FILE_ROOT=/home/dave` yapıp `pm2 restart server-panel --update-env`):
  ```bash
  # Tarayıcıdan giriş yaptıktan sonra yol kutusuna sırayla: /etc   ../../etc   /home/dave/../../etc
  # Hepsi "Bu yola erişim izni yok" vermeli.
  ln -s /etc/passwd ~/passwd-link   # editörde açınca "symlink izin verilen kök dışına çıkıyor" hatası
  rm ~/passwd-link
  ```

## Aşama 5: Süreçler, servisler, portlar, uyarılar
- **Süreçler ve servisler → Süreçler:** liste 3 sn'de bir yenilenir; "RAM %" başlığına tıklayınca belleğe göre sıralanır, filtre kutusu çalışmalı.
  `yes > /dev/null &` çalıştırın, `yes` en üste çıkmalı; `kill %1` ile durdurun.
- **systemd servisleri:** `sshd`, `cron` gibi servisler "active · running" görünmeli; "Hatalı" filtresi `systemctl --failed` ile aynı listeyi vermeli.
- **Açık portlar:** 22 (sshd) "dışa açık", 7319 (node) "yerel" görünmeli. `ss -ltnp` çıktısıyla karşılaştırın.
- **Uyarılar:** varsayılan kurallar (CPU/RAM/disk %90) hazır gelir. Test için CPU %20, süre 10 sn kuralı ekleyin ve yük oluşturun:
  ```bash
  timeout 40 sh -c 'for i in $(seq $(nproc)); do yes > /dev/null & done; wait'
  ```
  ~10 sn sonra sağ altta kırmızı bildirim ve menüde rozet; yük bitince "Düzeldi" bildirimi. Olay listesinde "aktif" → "çözüldü".
  Test kuralını silmeyi unutmayın.
