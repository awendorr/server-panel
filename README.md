# Sunucu Paneli

Linux sunucular için web tabanlı yönetim ve izleme paneli. Node.js, Express, Socket.IO ve SQLite ile çalışır.

## Özellikler

- **Dashboard:** CPU (toplam ve çekirdek bazlı), sıcaklık, RAM/swap, disk bölümleri, disk G/Ç, ağ trafiği, load average, uptime. 2 sn'de bir canlı; 1 saat / 24 saat / 7 gün geçmişi SQLite'tan.
- **PM2:** süreç listesi (durum, CPU, RAM, restart, uptime), başlat/durdur/yeniden başlat/sil, stdout ve stderr için ayrı canlı log sekmeleri, `pm2 save` listesindekiler için "açılışta" rozeti.
- **Terminal:** xterm.js ile gerçek kabuk, çoklu sekme, otomatik yeniden boyutlandırma, mobilde Esc/Tab/Ctrl/ok tuşları.
- **Dosya yöneticisi:** gezinme, Monaco kod editörü (Ctrl+S ile kaydet), yükleme (sürükle-bırak dahil), indirme, yeni dosya/klasör, ad değiştirme, onaylı silme.
- **Süreçler ve servisler:** htop benzeri süreç listesi (CPU/RAM'e göre sıralı), systemd servisleri ve durumları, açık portlar ve dinleyen uygulamalar.
- **Uyarılar:** CPU/RAM/swap/disk için eşik + süre kuralları; aşılınca panelde bildirim ve menüde rozet.
- **Audit kaydı:** giriş/çıkış, terminal açma/kapama, dosya yazma/silme/yükleme/indirme, PM2 işlemleri, uyarı kuralı değişiklikleri.

## Kurulum

### 1. Sunucu (Linux): tek komut

Paneli çalıştıracak kullanıcıyla (root değil, `sudo` yetkisi olan bir kullanıcı önerilir) sunucuda:

```bash
curl -fsSL https://raw.githubusercontent.com/awendorr/server-panel/main/get.sh | bash
```

Bu komut:
- Projeyi `~/server-panel` klasörüne indirir.
- Node.js 18+ yoksa (Ubuntu/Debian'da) Node.js 22 ve derleme araçlarını kurmayı teklif eder.
- Paketleri kurar, rastgele `SESSION_SECRET` ile `.env` oluşturur, panel için kullanıcı adı ve şifre sorar.
- Paneli pm2 ile başlatır, `pm2 save` yapar ve sunucu açılışında otomatik başlatmayı teklif eder.

**Güncellemek** için aynı komutu tekrar çalıştırın; `.env`, kullanıcılar ve geçmiş veriler korunur.
Farklı klasör için: `curl -fsSL .../get.sh | PANEL_DIR=/opt/server-panel bash`

Panel güvenlik için yalnızca `127.0.0.1:7319` adresini dinler; internetten doğrudan erişilemez.

### 2. Bilgisayarınız (Windows): tek komut

PowerShell'de:

```powershell
iwr -useb https://raw.githubusercontent.com/awendorr/server-panel/main/windows/kur.ps1 -OutFile $env:TEMP\panel-kur.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\panel-kur.ps1
```

Sunucu adresini (`kullanici@ip`) ve portları sorar (varsayılan: sunucuda 7319, bilgisayarda 8282). Sonra:
- Bu iş için ayrı bir SSH anahtarı oluşturup sunucuya ekler. Sunucu şifreniz **bir kez** sorulur.
  Anahtar sunucuda `restrict,permitopen="127.0.0.1:7319",command="/bin/true"` ile kısıtlanır: yalnızca panele tünel açabilir, komut çalıştıramaz.
- Windows açılışında görünmez pencerede başlayan, bağlantı koparsa kendini yeniden bağlayan bir SSH tüneli kurar (yönetici izni gerekmez).
- Masaüstüne ve Başlat menüsüne **Sunucu Paneli** kısayolu ekler. Kısayol paneli Edge/Chrome'da ayrı bir uygulama penceresinde açar.

Uyarılar sayfasındaki "Masaüstü bildirimlerini aç" ile uyarılar Windows bildirimi olarak gelir (uygulama penceresi açık ya da simge durumundayken).

Kaldırmak için: `powershell -ExecutionPolicy Bypass -File $env:TEMP\panel-kur.ps1 -Uninstall`

### Linux / macOS masaüstünden erişim

```bash
ssh -N -L 8282:127.0.0.1:7319 kullanici@sunucu-adresi
```

Pencere açık kaldığı sürece `http://localhost:8282` adresinden panele ulaşırsınız.

## Gereksinimler

- Sunucu: Linux (Ubuntu/Debian test edildi), Node.js 18+ (kurulum betiği kurabilir), derleme araçları (`build-essential python3`)
- (İsteğe bağlı) CPU sıcaklığı için: `sudo apt install -y lm-sensors`
- Windows: Windows 10/11, yerleşik OpenSSH istemcisi, Edge veya Chrome

## Elle kurulum

```bash
cd /opt/server-panel            # projeyi kopyaladığınız klasör
npm install --omit=dev

cp .env.example .env
# SESSION_SECRET üretip .env'e yazın:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
nano .env
chmod 600 .env

# İlk kullanıcıyı oluşturun (şifre en az 10 karakter)
npm run create-user -- admin
```

Aynı komut var olan bir kullanıcının şifresini değiştirmek için de kullanılır.

### Tarayıcı CSS'i

`public/css/tailwind.css` derlenmiş olarak gelir. Arayüzde Tailwind sınıflarını değiştirirseniz:

```bash
npm install           # dev bağımlılıkları dahil
npm run build:css
```

## Çalıştırma

Deneme için:

```bash
npm start
# Panel http://127.0.0.1:7319 adresinde çalışıyor
```

### PM2 ile kalıcı çalıştırma

```bash
sudo npm install -g pm2
pm2 start ecosystem.config.js
pm2 save                  # şu anki süreç listesini kaydet
pm2 startup               # çıkan komutu kopyalayıp çalıştırın (açılışta otomatik başlatma)

pm2 logs server-panel     # loglar
pm2 restart server-panel  # güncellemeden sonra
```

Panel, onu çalıştıran Linux kullanıcısının yetkileriyle çalışır:

- **Terminal ve dosya yöneticisi** o kullanıcının yapabildiği her şeyi yapabilir. Root ile çalıştırmayın; `sudo` gerekiyorsa terminalden kullanın.
- **PM2 sayfası** aynı kullanıcının pm2 süreçlerini gösterir (`~/.pm2`). Uygulamalarınızı hangi kullanıcıyla pm2'ye eklediyseniz paneli de o kullanıcıyla çalıştırın.
- **Açık portlar** listesinde başka kullanıcılara ait süreçlerin adları görünmeyebilir (port yine listelenir).
- Dosya yöneticisini tek bir klasörle sınırlamak için `.env` içinde `FILE_ROOT=/home/dave` gibi bir değer verin.

## Erişim

Panel yalnızca `127.0.0.1`'e bağlanır, internetten doğrudan erişilemez. İki yol var:

### 1. SSH tüneli (en basit)

Kendi bilgisayarınızda:

```bash
ssh -N -L 7319:127.0.0.1:7319 kullanici@sunucu-adresi
```

Sonra tarayıcıda `http://localhost:7319` açın. Tünel açık kaldığı sürece panel çalışır.
Yerelde 7319 doluysa `-L 8282:127.0.0.1:7319` gibi başka bir port verip `http://localhost:8282` kullanın.

`~/.ssh/config` içine kısayol:

```
Host panel
  HostName sunucu-adresi
  User kullanici
  LocalForward 7319 127.0.0.1:7319
```

Ardından `ssh -N panel` yeterli.

### 2. Nginx + HTTPS

`.env` içinde `TRUST_PROXY=1` yapın (secure cookie ve gerçek istemci IP'si için), paneli yeniden başlatın.

```nginx
server {
    listen 443 ssl http2;
    server_name panel.ornek.com;

    ssl_certificate     /etc/letsencrypt/live/panel.ornek.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/panel.ornek.com/privkey.pem;

    client_max_body_size 100m;   # dosya yükleme (4. aşama) için

    location / {
        proxy_pass http://127.0.0.1:7319;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Socket.IO (WebSocket)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}

server {
    listen 80;
    server_name panel.ornek.com;
    return 301 https://$host$request_uri;
}
```

Sertifika: `sudo certbot --nginx -d panel.ornek.com`. Ek güvenlik için Nginx'te IP kısıtlaması (`allow`/`deny`) önerilir.

## Güvenlik

- Şifreler bcrypt (cost 12) ile saklanır, oturumlar SQLite'ta tutulur.
- Cookie: `HttpOnly`, `SameSite=Strict`, HTTPS arkasında `Secure`.
- Giriş denemesi sınırı: bir IP'den `LOGIN_WINDOW_MIN` dakikada `LOGIN_MAX_ATTEMPTS` hatalı deneme sonrası kilit.
- Değişiklik yapan tüm API isteklerinde CSRF token kontrolü, sıkı Content-Security-Policy (helmet).
- Socket.IO bağlantıları da oturum ve Origin kontrolünden geçer; çıkış yapınca açık soketler kapatılır.
- Kritik işlemler `audit_log` tablosuna yazılır, panelde **Audit kaydı** sayfasından görülebilir.

## Veri saklama

| Tablo | İçerik | Süre |
|---|---|---|
| `metrics_raw` | 10 sn'lik ortalamalar | 24 saat |
| `metrics_minute` | Dakikalık özet | 7 gün |
| `disk_usage` | Bölüm bazlı disk kullanımı (dakikalık) | 7 gün |
| `audit_log` | Kritik işlemler | `AUDIT_RETENTION_DAYS` (varsayılan 90) |
| `login_attempts` | Giriş denemeleri | 1 gün |
| `alert_events` | Uyarı olayları (çözülmüş) | 30 gün |

Veritabanı: `data/panel.db` (yedeklemek için `sqlite3 data/panel.db ".backup yedek.db"`).

## Proje yapısı

```
server/
  index.js          Express + Socket.IO giriş noktası
  config.js         .env okuma
  db/               SQLite bağlantısı ve şema
  middleware/       auth, CSRF/helmet, giriş sınırı
  routes/           REST API
  services/         metrik, pm2, terminal, dosya, sistem, uyarı, audit, oturum servisleri
  sockets/          Socket.IO kanalları
  scripts/          create-user
public/             Tek sayfa arayüz (Tailwind, Chart.js, xterm.js, Monaco)
install.sh          Kurulum / güncelleme betiği
get.sh              Tek komutla indirme + kurulum
windows/kur.ps1     Windows: arka plan tüneli + masaüstü kısayolu
```
