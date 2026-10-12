#!/usr/bin/env bash
# Sunucu Paneli kurulum / güncelleme betiği
# Kullanım: proje klasöründe, paneli çalıştıracak kullanıcıyla:  bash install.sh
# (Tek komutla kurulum için get.sh'a bakın.)
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mHATA:\033[0m %s\n' "$*" >&2; exit 1; }
ask_yes() { # ask_yes "soru" -> varsayılan evet
  local a
  read -rp "$1 [E/h]: " a || a=""
  [[ ! "$a" =~ ^[HhNn] ]]
}

SUDO=""
CAN_ROOT=0
if [ "$(id -u)" = "0" ]; then CAN_ROOT=1
elif command -v sudo >/dev/null 2>&1; then SUDO="sudo"; CAN_ROOT=1
fi
HAS_APT=0
command -v apt-get >/dev/null 2>&1 && HAS_APT=1
APT_UPDATED=0
apt_install() {
  if [ "$APT_UPDATED" = 0 ]; then
    $SUDO apt-get update -qq || warn "apt-get update başarısız oldu, devam ediliyor"
    APT_UPDATED=1
  fi
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@"
}

# 1. Node.js 20+ ve npm. Yoksa ya da eskiyse, apt kullanan sistemlerde Node.js 22 kurmayı teklif et.
NODE_MIN=20
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
node_ok() {
  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && [ "$(node_major)" -ge "$NODE_MIN" ]
}
if ! node_ok; then
  found="$(command -v node >/dev/null 2>&1 && node -v || echo yok)"
  command -v npm >/dev/null 2>&1 || found="$found, npm yok"
  warn "Node.js ${NODE_MIN} veya üstü ve npm gerekli (bulunan: ${found})."
  if [ "$HAS_APT" = 1 ] && [ "$CAN_ROOT" = 1 ] && ask_yes "Node.js 22 (NodeSource) ve derleme araçları kurulsun mu?"; then
    command -v curl >/dev/null 2>&1 || apt_install curl ca-certificates
    curl -fsSL https://deb.nodesource.com/setup_22.x | ${SUDO:+$SUDO -E} bash -
    APT_UPDATED=1 # NodeSource betiği apt-get update yapar
    apt_install nodejs build-essential python3
    hash -r
    node_ok || die "Node.js $(node -v 2>/dev/null || echo '?') hâlâ eski. nvm kullanıyorsanız: nvm install 22 && nvm alias default 22, sonra tekrar çalıştırın."
  else
    echo "  Elle kurmak için (Ubuntu/Debian):"
    echo "    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
    echo "    sudo apt-get install -y nodejs build-essential python3"
    exit 1
  fi
fi
say "Node.js $(node -v), npm $(npm -v)"

# 2. Bağımlılıklar (node-pty her zaman derlenir; bcrypt ve better-sqlite3 hazır paket bulamazsa derlenir)
if ! command -v make >/dev/null 2>&1 || ! command -v g++ >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then
  if [ "$HAS_APT" = 1 ] && [ "$CAN_ROOT" = 1 ]; then
    say "Derleme araçları kuruluyor (build-essential, python3)"
    apt_install build-essential python3 || warn "Kurulamadı; npm adımı hata verirse elle kurun."
  else
    warn "Derleme araçları eksik olabilir. Hata alırsanız: sudo apt-get install -y build-essential python3"
  fi
fi
say "npm paketleri kuruluyor"
npm install --omit=dev --no-audit --no-fund \
  || die "npm paketleri kurulamadı. Yukarıdaki hataya bakın (derleme araçları: sudo apt-get install -y build-essential python3)."
# better-sqlite3 derlenmiş modülünü ancak veritabanı açılınca yükler; Node sürümü değiştiyse yeniden derle
native_ok() { node -e "new (require('better-sqlite3'))(':memory:').close(); require('node-pty'); require('bcrypt')" 2>/dev/null; }
if ! native_ok; then
  say "Yerel modüller bu Node.js sürümü için yeniden derleniyor"
  npm rebuild better-sqlite3 node-pty bcrypt || true
fi
native_ok || die "Yerel modüller yüklenemedi (Node $(node -v), npm $(npm -v)). Yukarıda npm'in 'install-scripts' uyarısı varsa kurulum betikleri engellenmiştir (ignore-scripts); yoksa derleme araçlarını kurun: sudo apt-get install -y build-essential python3"

# 3. .env
if [ ! -f .env ]; then
  say ".env oluşturuluyor (rastgele SESSION_SECRET ile)"
  cp .env.example .env
  SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
  sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=${SECRET}/" .env
  chmod 600 .env
fi
mkdir -p data && chmod 700 data
# Portu panelin kendi ayar okuyucusundan al (.env yorumları, boşluklar vb. aynı şekilde yorumlanır)
PORT=$(node -p "require('./server/config').port" 2>/dev/null || true)
case "$PORT" in ''|*[!0-9]*) PORT=7319 ;; esac

# 4. pm2: global yoksa kur; kurulamazsa projeyle gelen pm2'yi kullan
PM2=$(command -v pm2 || true)
LOCAL_PM2="$PWD/node_modules/.bin/pm2"
# pm2 kapalıyken (ör. açılışta başlatma yoksa) kayıtlı listeyi önce geri yükle; yoksa boş liste kaydedilip
# kullanıcının diğer uygulamaları listeden düşer
PM2_DIR="${PM2_HOME:-$HOME/.pm2}"
if [ -s "$PM2_DIR/dump.pm2" ] && ! kill -0 "$(cat "$PM2_DIR/pm2.pid" 2>/dev/null)" 2>/dev/null; then
  "${PM2:-$LOCAL_PM2}" resurrect >/dev/null 2>&1 || true
fi
# Güncellemede: panel daha önce projedeki pm2 ile başlatıldıysa yine onu kullan (sudo tekrar sorulmasın)
if [ -z "$PM2" ] && [ -d "${PM2_HOME:-$HOME/.pm2}" ] && "$LOCAL_PM2" describe server-panel >/dev/null 2>&1; then
  PM2="$LOCAL_PM2"
fi
if [ -z "$PM2" ]; then
  say "pm2 global olarak kuruluyor"
  if [ -w "$(npm root -g)" ]; then npm install -g pm2 || true
  elif [ -n "$SUDO" ]; then $SUDO npm install -g pm2 || true
  fi
  hash -r
  PM2=$(command -v pm2 || true)
  if [ -z "$PM2" ]; then
    PM2="$LOCAL_PM2"
    warn "pm2 global kurulamadı; projedeki pm2 kullanılıyor: $PM2"
  fi
fi

# Port başka bir uygulama tarafından kullanılıyor mu?
if command -v ss >/dev/null 2>&1 && ss -ltnH "sport = :$PORT" 2>/dev/null | grep -q . \
   && ! "$PM2" describe server-panel >/dev/null 2>&1; then
  die "$PORT portu kullanımda. .env içindeki PORT değerini değiştirip tekrar çalıştırın."
fi

# 5. İlk kullanıcı
user_count() { node -e "const db=require('./server/db');console.log(db.prepare('SELECT COUNT(*) n FROM users').get().n)"; }
USERS=$(user_count) || die "Veritabanı açılamadı (data/panel.db)."
if [ "$USERS" = "0" ]; then
  say "Panel için ilk kullanıcıyı oluşturun (şifre en az 10 karakter)"
  for _ in 1 2 3; do
    read -rp "Kullanıcı adı [$(whoami)]: " PUSER || PUSER=""
    rc=0
    npm run -s create-user -- "${PUSER:-$(whoami)}" || rc=$?
    [ "$rc" = 0 ] && break
    [ "$rc" = 130 ] && die "İptal edildi. Kurulumu tamamlamak için tekrar: bash install.sh"
  done
  [ "$(user_count)" != "0" ] || die "Kullanıcı oluşturulamadı. Tekrar denemek için: bash install.sh"
fi
# Otomasyonla verilen şifre pm2'nin sakladığı ortama geçmesin
unset PANEL_PASSWORD

# 6. PM2 ile başlat
if "$PM2" describe server-panel >/dev/null 2>&1; then
  say "Panel yeniden başlatılıyor"
  "$PM2" restart server-panel --update-env
else
  say "Panel pm2 ile başlatılıyor"
  "$PM2" start ecosystem.config.js
fi
"$PM2" save

# 7. Açılışta otomatik başlatma (systemd)
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ] \
   && ! systemctl is-enabled "pm2-$(whoami)" >/dev/null 2>&1; then
  if [ "$CAN_ROOT" = 1 ] && ask_yes "Sunucu yeniden başlayınca panel de otomatik başlasın mı?"; then
    $SUDO env PATH="$PATH:$(dirname "$(command -v node)")" "$PM2" startup systemd -u "$(whoami)" --hp "$HOME" >/dev/null \
      && say "Açılışta otomatik başlatma açık." \
      || warn "Ayarlanamadı. Elle: $PM2 startup"
  else
    echo "   Açılışta otomatik başlatma için: $PM2 startup (çıkan komutu çalıştırın)"
  fi
fi

# Panel ayağa kalktı mı? (ilk açılışta veritabanı hazırlanırken birkaç saniye sürebilir)
UP=0
for _ in $(seq 1 30); do
  if node -e "const r=require('http').get('http://127.0.0.1:${PORT}/login',(s)=>process.exit(s.statusCode<500?0:1));r.on('error',()=>process.exit(1));r.setTimeout(2000,()=>r.destroy())" 2>/dev/null; then
    UP=1; break
  fi
  sleep 0.5
done
if [ "$UP" = 1 ]; then
  say "Kurulum tamam. Panel 127.0.0.1:${PORT} üzerinde çalışıyor."
else
  warn "Panel yanıt vermedi. Loglar için: $PM2 logs server-panel"
fi

IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
TARGET="$(whoami)@${IP:-SUNUCU_ADRESI}"
echo
echo "   Panel güvenlik için yalnızca sunucunun içinden erişilebilir. Kendi bilgisayarınızdan açmak için:"
echo
echo "   Windows (uygulama + arka plan tüneli, tek komut, PowerShell):"
echo "     iwr -useb https://raw.githubusercontent.com/awendorr/server-panel/main/windows/kur.ps1 -OutFile \$env:TEMP\\panel-kur.ps1; powershell -ExecutionPolicy Bypass -File \$env:TEMP\\panel-kur.ps1"
echo "     Sunucu sorulunca: ${TARGET}   panel portu: ${PORT}"
echo
echo "   Linux / macOS (SSH tüneli):"
echo "     ssh -N -L 8282:127.0.0.1:${PORT} ${TARGET}   sonra http://localhost:8282"
echo
echo "   (${IP:-Bu adres} bu sunucunun yerel ağ adresidir. İnternet üzerinden bağlanıyorsanız sunucunun genel IP'sini ya da alan adını yazın.)"
echo "   Giriş denemeleri yüzünden beklemeye düşerseniz sunucuda: cd $PWD && npm run unlock"
