#!/usr/bin/env bash
# Sunucu Paneli: tek komutla kurulum / güncelleme
#   curl -fsSL https://raw.githubusercontent.com/awendorr/server-panel/main/get.sh | bash
#
# Ayarlar (isteğe bağlı, ortam değişkeni olarak):
#   PANEL_DIR   kurulacak klasör     (varsayılan: ~/server-panel)
#   PANEL_REPO  GitHub deposu        (varsayılan: awendorr/server-panel)
#   PANEL_REF   dal ya da etiket      (varsayılan: main)
set -euo pipefail

REPO="${PANEL_REPO:-awendorr/server-panel}"
REF="${PANEL_REF:-main}"
DIR="${PANEL_DIR:-$HOME/server-panel}"
URL="${PANEL_TARBALL_URL:-https://codeload.github.com/${REPO}/tar.gz/${REF}}"

say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m!!\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] && printf '\033[1;33m!!\033[0m Root olarak kuruyorsunuz. Panelin terminali ve dosya yöneticisi root yetkisiyle çalışacak; ayrı bir kullanıcı önerilir.\n'
command -v tar >/dev/null || die "tar gerekli"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say "İndiriliyor: ${REPO} (${REF})"
if command -v curl >/dev/null; then
  curl -fsSL "$URL" -o "$TMP/panel.tar.gz" || die "İndirilemedi: $URL"
elif command -v wget >/dev/null; then
  wget -qO "$TMP/panel.tar.gz" "$URL" || die "İndirilemedi: $URL"
else
  die "curl ya da wget gerekli"
fi

mkdir -p "$DIR"
# .env ve data/ arşivde yok; güncellemede korunur
tar -xzf "$TMP/panel.tar.gz" -C "$DIR" --strip-components=1
chmod +x "$DIR/install.sh" "$DIR/get.sh" 2>/dev/null || true
say "Dosyalar: $DIR"

cd "$DIR"
# curl | bash ile çalışırken sorular için klavyeyi bağla
if [ -t 0 ]; then
  exec bash ./install.sh
elif [ -r /dev/tty ]; then
  exec bash ./install.sh < /dev/tty
else
  die "Etkileşimli terminal bulunamadı. Kurulumu bitirmek için: cd $DIR && bash install.sh"
fi
