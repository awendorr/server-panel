# Aşama 1 test adımları

## Kurulum
```bash
npm install
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # çıktıyı SESSION_SECRET'e yaz
npm run create-user -- admin
npm start
```
Yerel bilgisayarından: `ssh -N -L 7319:127.0.0.1:7319 kullanici@sunucu`, sonra tarayıcıda `http://localhost:7319`.

## 1. Sadece 127.0.0.1'de dinliyor mu
```bash
ss -ltnp | grep 7319          # 127.0.0.1:7319 görünmeli, 0.0.0.0 değil
curl -I http://SUNUCU_IP:7319  # dışarıdan bağlantı reddedilmeli
```

## 2. Giriş koruması
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7319/                    # 302 (login'e yönlendirir)
curl -s -w "\n" http://127.0.0.1:7319/api/metrics/current                          # 401
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w "%{http_code} " -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"yanlis"}' http://127.0.0.1:7319/api/auth/login; done; echo
# Beklenen: 401 401 401 401 401 429  (5 hatadan sonra 15 dk kilit)
```
Kilidi test sonrası hemen kaldırmak için: `sqlite3 data/panel.db "DELETE FROM login_attempts"`

## 3. Dashboard
- Giriş yap. Sol üstte yeşil "Bağlı" görünmeli, kartlar 2 sn'de bir güncellenmeli.
- Yük oluştur ve CPU grafiğinin yükseldiğini gör:
  `timeout 30 sh -c 'yes > /dev/null & yes > /dev/null & wait'`
- Disk G/Ç: `dd if=/dev/zero of=/tmp/test.bin bs=1M count=500 oflag=direct && rm /tmp/test.bin`
- Ağ: `curl -o /dev/null https://speed.hetzner.de/100MB.bin`
- Sıcaklık "Sensör yok" ise `sudo apt install lm-sensors && sudo sensors-detect` (sanal sunucularda genellikle sensör olmaz).
- Telefonda veya tarayıcıyı daraltarak mobil görünüm: menü ☰ butonuyla açılmalı.

## 4. Geçmiş
- Panel birkaç dakika çalıştıktan sonra "1 saat" ve "24 saat" sekmelerinde veri görünmeli.
- "7 gün" dakikalık özetlerden gelir, ilk noktalar 5 dakika sonra belirir.
```bash
sqlite3 data/panel.db "SELECT COUNT(*) FROM metrics_raw; SELECT COUNT(*) FROM metrics_minute;"
```

## 5. Oturum ve audit
- Çıkış yap: canlı veri durmalı, sayfa yenilenince giriş ekranına dönmeli.
- "Audit kaydı" sayfasında başarılı/başarısız girişler, engellenen denemeler ve çıkışlar listelenmeli.
- CSRF: `curl -X POST -b cookie.txt http://127.0.0.1:7319/api/auth/logout` → 403

## 6. PM2 ile
```bash
pm2 start ecosystem.config.js && pm2 save
pm2 restart server-panel    # sonra dashboard'un yeniden bağlandığını ve geçmişin korunduğunu kontrol et
```
