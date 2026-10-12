#!/usr/bin/env bash
# Sunucu Paneli kurulum / güncelleme betiği
# Kullanım: proje klasöründe, paneli çalıştıracak kullanıcıyla:  bash install.sh
# (Tek komutla kurulum için get.sh'a bakın.)
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*"; }
ask_yes() { # ask_yes "soru" -> varsayılan evet
  local a
  read -rp "$1 [E/h]: " a || a=""
  [[ ! "$a" =~ ^[HhNn] ]]
}
SUDO=""
if [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi

# 1. Node.js (18+). Yoksa ya da eskiyse, apt kullanan sistemlerde kurmayı teklif et.
node_major() { command -v node >/dev/null 2>&1 && node -p 'process.versions.node.split(".")[0]' || echo 0; }
if [ "$(node_major)" -lt 18 ]; then
  warn "Node.js 18 veya üstü gerekli (bulunan: $(command -v node >/dev/null 2>&1 && node -v || echo yok))."
  if command -v apt-get >/dev/null 2>&1 && { [ -n "$SUDO" ] || [ "$(id -u)" = "0" ]; } && ask_yes "Node.js 22 ve derleme araçları kurulsun mu?"; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
    $SUDO apt-get install -y nodejs build-essential python3
  else
    echo "  Elle kurmak için (Ubuntu/Debian):"
    echo "    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
    echo "    sudo apt-get install -y nodejs build-essential python3"
    exit 1
  fi
fi
say "Node.js $(node -v)"

# 2. Bağımlılıklar (node-pty, bcrypt, better-sqlite3 derleme gerektirebilir)
if ! command -v make >/dev/null 2>&1 || ! command -v g++ >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1 && { [ -n "$SUDO" ] || [ "$(id -u)" = "0" ]; }; then
    say "Derleme araçları kuruluyor (build-essential)"
    $SUDO apt-get install -y build-essential python3 || warn "Kurulamadı; npm adımı hata verirse elle kurun."
  else
    warn "Derleme araçları eksik olabilir. Hata alırsanız: sudo apt-get install -y build-essential python3"
  fi
fi
say "npm paketleri kuruluyor"
npm install --omit=dev --no-audit --no-fund

# 3. .env
if [ ! -f .env ]; then
  say ".env oluşturuluyor (rastgele SESSION_SECRET ile)"
  cp .env.example .env
  SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
  sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=${SECRET}/" .env
  chmod 600 .env
fi
mkdir -p data && chmod 700 data
PORT=$(grep -E '^PORT=' .env | cut -d= -f2); PORT=${PORT:-7319}

# Port başka bir uygulama tarafından kullanılıyor mu?
if command -v ss >/dev/null 2>&1 && ss -ltnH "sport = :$PORT" 2>/dev/null | grep -q . \
   && ! (command -v pm2 >/dev/null 2>&1 && pm2 describe server-panel >/dev/null 2>&1); then
  warn "$PORT portu kullanımda. .env içindeki PORT değerini değiştirip tekrar çalıştırın."
  exit 1
fi

# 4. İlk kullanıcı
USERS=$(node -e "const db=require('./server/db');console.log(db.prepare('SELECT COUNT(*) n FROM users').get().n)")
if [ "$USERS" = "0" ]; then
  say "Panel için ilk kullanıcıyı oluşturun"
  read -rp "Kullanıcı adı [$(whoami)]: " PUSER || PUSER=""
  npm run -s create-user -- "${PUSER:-$(whoami)}"
fi

# 5. PM2 ile başlat
if ! command -v pm2 >/dev/null 2>&1; then
  say "pm2 global olarak kuruluyor"
  if [ -w "$(npm root -g)" ]; then npm install -g pm2; else $SUDO npm install -g pm2; fi
fi
if pm2 describe server-panel >/dev/null 2>&1; then
  say "Panel yeniden başlatılıyor"
  pm2 restart server-panel --update-env
else
  say "Panel pm2 ile başlatılıyor"
  pm2 start ecosystem.config.js
fi
pm2 save

# 6. Açılışta otomatik başlatma (systemd)
if command -v systemctl >/dev/null 2>&1 && ! systemctl is-enabled "pm2-$(whoami)" >/dev/null 2>&1; then
  if { [ -n "$SUDO" ] || [ "$(id -u)" = "0" ]; } && ask_yes "Sunucu yeniden başlayınca panel de otomatik başlasın mı?"; then
    $SUDO env PATH="$PATH:$(dirname "$(command -v node)")" "$(command -v pm2)" startup systemd -u "$(whoami)" --hp "$HOME" >/dev/null \
      && say "Açılışta otomatik başlatma açık." \
      || warn "Ayarlanamadı. Elle: pm2 startup"
  else
    echo "   Açılışta otomatik başlatma için: pm2 startup (çıkan komutu çalıştırın)"
  fi
fi

sleep 1
if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/login" 2>/dev/null; then
  say "Kurulum tamam. Panel 127.0.0.1:${PORT} üzerinde çalışıyor."
else
  warn "Panel yanıt vermedi. Loglar için: pm2 logs server-panel"
fi
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "   Panel güvenlik için yalnızca sunucunun içinden erişilebilir. Kendi bilgisayarınızdan açmak için:"
echo
echo "   Windows (uygulama + arka plan tüneli, tek komut, PowerShell):"
echo "     iwr -useb https://raw.githubusercontent.com/awendorr/server-panel/main/windows/kur.ps1 -OutFile \$env:TEMP\\panel-kur.ps1; powershell -ExecutionPolicy Bypass -File \$env:TEMP\\panel-kur.ps1"
echo "     Sunucu sorulunca: $(whoami)@${IP:-SUNUCU_IP}   panel portu: ${PORT}"
echo
echo "   Linux / macOS (SSH tüneli):"
echo "     ssh -N -L 8282:127.0.0.1:${PORT} $(whoami)@${IP:-SUNUCU_IP}   sonra http://localhost:8282"
