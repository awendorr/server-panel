# Sunucu Paneli: Windows kurulumu
#
# Paneli Windows'ta uygulama gibi açar. Ne yapar:
#   1. Bu tünel için ayrı bir SSH anahtarı oluşturur ve sunucuya ekler.
#      Sunucu şifreniz BİR KEZ sorulur. Anahtar sunucuda sadece panele tünel
#      açabilecek şekilde kısıtlanır (komut çalıştıramaz, başka porta bağlanamaz).
#   2. Windows açılışında görünmez pencerede başlayan, kopunca kendini yeniden
#      bağlayan bir SSH tüneli kurar.
#   3. Masaüstüne ve Başlat menüsüne "Sunucu Paneli" kısayolu ekler. Kısayol
#      paneli ayrı bir uygulama penceresinde açar.
#
# Tek komutla kurulum (PowerShell):
#   iwr -useb https://raw.githubusercontent.com/awendorr/server-panel/main/windows/kur.ps1 -OutFile $env:TEMP\panel-kur.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\panel-kur.ps1
#
# Parametreler (hepsi isteğe bağlı, verilmezse sorulur):
#   -Server kullanici@sunucu   -RemotePort 7319   -LocalPort 8282
# Kaldırmak için:
#   powershell -ExecutionPolicy Bypass -File $env:TEMP\panel-kur.ps1 -Uninstall

param(
  [string]$Server,
  [int]$RemotePort = 0,
  [int]$LocalPort = 0,
  [switch]$Uninstall
)

$Repo = "awendorr/server-panel"
$Branch = "main"

# Not: "Stop" kullanılmıyor; PowerShell 5.1 ssh'nin stderr çıktısını hata sayıp betiği durdurur
$ErrorActionPreference = "Continue"
$AppDir = Join-Path $env:LOCALAPPDATA "ServerPanel"
$ConfigPath = Join-Path $AppDir "config.json"
$KeyPath = Join-Path $env:USERPROFILE ".ssh\server-panel_ed25519"
$LoopScript = Join-Path $AppDir "tunnel.ps1"
$OpenScript = Join-Path $AppDir "open.ps1"
$OpenVbs = Join-Path $AppDir "open.vbs"
$IconPath = Join-Path $AppDir "icon.ico"
$StartupVbs = Join-Path ([Environment]::GetFolderPath("Startup")) "ServerPanelTunnel.vbs"
$DesktopLnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "Sunucu Paneli.lnk"
$StartMenuLnk = Join-Path ([Environment]::GetFolderPath("Programs")) "Sunucu Paneli.lnk"
$Utf8Bom = New-Object System.Text.UTF8Encoding $true

function Say($msg) { Write-Host "==> $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "!!  $msg" -ForegroundColor Yellow }

function Stop-Tunnel {
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object { $_.CommandLine -like "*ServerPanel\tunnel.ps1*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process -Filter "Name = 'ssh.exe'" |
    Where-Object { $_.CommandLine -like "*server-panel_ed25519*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

if ($Uninstall) {
  Stop-Tunnel
  Remove-Item $StartupVbs, $DesktopLnk, $StartMenuLnk -ErrorAction SilentlyContinue
  Remove-Item $AppDir -Recurse -ErrorAction SilentlyContinue
  Say "Sunucu Paneli kaldırıldı (tünel, kısayollar, ayarlar)."
  Write-Host "    SSH anahtarı duruyor: $KeyPath"
  Write-Host "    Sunucudaki izni de kaldırmak için sunucuda ~/.ssh/authorized_keys içindeki 'server-panel-tunnel' satırını silin."
  exit 0
}

# Önceki kurulumun ayarları (yeniden çalıştırınca varsayılan olur)
$prev = $null
if (Test-Path $ConfigPath) { try { $prev = Get-Content $ConfigPath -Raw | ConvertFrom-Json } catch { } }

function Ask($label, $default) {
  $hint = if ($default) { " [$default]" } else { "" }
  $v = Read-Host "$label$hint"
  if ([string]::IsNullOrWhiteSpace($v)) { return $default }
  return $v.Trim()
}

if (-not $Server) {
  $Server = Ask "Sunucu (kullanici@adres, ör. ali@192.168.1.10)" $(if ($prev) { $prev.Server } else { $null })
}
if (-not $Server -or $Server -notmatch '^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$') {
  Warn "Sunucu 'kullanici@adres' biçiminde olmalı."
  exit 1
}
if (-not $RemotePort) { $RemotePort = [int](Ask "Sunucudaki panel portu" $(if ($prev) { $prev.RemotePort } else { 7319 })) }
if (-not $LocalPort) { $LocalPort = [int](Ask "Bu bilgisayarda kullanılacak port" $(if ($prev) { $prev.LocalPort } else { 8282 })) }

# 1. OpenSSH istemcisi
$ssh = Get-Command ssh.exe -ErrorAction SilentlyContinue
if (-not $ssh) {
  Warn "ssh.exe bulunamadı. Ayarlar > Uygulamalar > İsteğe bağlı özellikler > 'OpenSSH İstemcisi' ekleyin ve tekrar çalıştırın."
  exit 1
}
$sshExe = $ssh.Source

# 2. Yerel port boş mu? (Bizim eski tünelimizse sorun değil)
Stop-Tunnel
Start-Sleep -Milliseconds 500
$busy = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue
if ($busy) {
  $owner = ($busy | Select-Object -First 1).OwningProcess
  $ownerName = (Get-Process -Id $owner -ErrorAction SilentlyContinue).ProcessName
  Warn "Bu bilgisayarda $LocalPort portu '$ownerName' tarafından kullanılıyor. Tekrar çalıştırıp başka bir port seçin."
  exit 1
}

# 3. Tünele özel SSH anahtarı
New-Item -ItemType Directory -Force -Path (Split-Path $KeyPath) | Out-Null
if (-not (Test-Path $KeyPath)) {
  Say "Tünel için SSH anahtarı oluşturuluyor"
  # Boş parola: cmd üzerinden "" geçirmek PowerShell sürümlerinden bağımsız çalışır
  cmd /c "ssh-keygen -q -t ed25519 -f `"$KeyPath`" -N `"`" -C server-panel-tunnel"
  if (-not (Test-Path $KeyPath)) { Warn "Anahtar oluşturulamadı."; exit 1 }
}
$pub = (Get-Content "$KeyPath.pub" -Raw).Trim()

# 4. Anahtar bu sunucuda çalışıyor mu? Çalışmıyorsa ekle (şifre bir kez sorulur)
& $sshExe -i $KeyPath -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new $Server "true" 2>$null
if ($LASTEXITCODE -ne 0) {
  Say "Anahtar sunucuya ekleniyor. $Server için SSH şifreniz sorulacak (bir kez)."
  # Komutta çift tırnak kullanılmıyor (PowerShell 5.1 onları ssh'ye bozuk geçirir); \042 sunucuda " olur.
  $keyBody = $pub.Split(' ')[1]
  $remote = "umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; " +
    "grep -qF '$keyBody' ~/.ssh/authorized_keys || " +
    "printf 'restrict,port-forwarding,permitopen=\042127.0.0.1:$RemotePort\042,command=\042/bin/true\042 %s\n' '$pub' >> ~/.ssh/authorized_keys"
  & $sshExe -o StrictHostKeyChecking=accept-new $Server $remote
  if ($LASTEXITCODE -ne 0) { Warn "Anahtar eklenemedi (şifre yanlış olabilir). Tekrar deneyin."; exit 1 }

  & $sshExe -i $KeyPath -o BatchMode=yes -o ConnectTimeout=8 $Server "true" 2>$null
  if ($LASTEXITCODE -ne 0) {
    Warn "Anahtarla giriş doğrulanamadı. Sunucuda ~/.ssh izinlerini kontrol edin: chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys"
    Warn "Sunucuda daha önce farklı bir portla eklenmiş 'server-panel-tunnel' satırı varsa silip tekrar deneyin."
    exit 1
  }
}
Say "Anahtarla giriş çalışıyor."

New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
@{ Server = $Server; RemotePort = $RemotePort; LocalPort = $LocalPort } | ConvertTo-Json |
  ForEach-Object { [IO.File]::WriteAllText($ConfigPath, $_, $Utf8Bom) }

# 5. Kopunca yeniden bağlanan tünel
$loop = @"
# Sunucu Paneli tüneli: kopunca 5 sn sonra yeniden bağlanır
while (`$true) {
  & "$sshExe" -i "$KeyPath" -N -L 127.0.0.1:${LocalPort}:127.0.0.1:${RemotePort} ``
    -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 ``
    -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new $Server
  Start-Sleep -Seconds 5
}
"@
[IO.File]::WriteAllText($LoopScript, $loop, $Utf8Bom)

# Windows açılışında görünmez başlat (yönetici izni gerektirmez)
$vbs = "CreateObject(""WScript.Shell"").Run ""powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """"$LoopScript"""""", 0, False"
[IO.File]::WriteAllText($StartupVbs, $vbs, [Text.Encoding]::ASCII)

# 6. Kısayolun çalıştıracağı betik: tünel kapalıysa başlat, hazır olunca paneli uygulama penceresinde aç
$open = @"
`$url = "http://localhost:$LocalPort/"
`$running = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
  Where-Object { `$_.CommandLine -like "*ServerPanel\tunnel.ps1*" }
if (-not `$running) { Start-Process -FilePath "wscript.exe" -ArgumentList '"$StartupVbs"' }
for (`$i = 0; `$i -lt 20; `$i++) {
  try { Invoke-WebRequest -Uri "`${url}login" -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Milliseconds 500 }
}
`$browsers = @(
  "`${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "`$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "`$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "`${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "`$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
`$browser = `$browsers | Where-Object { Test-Path `$_ } | Select-Object -First 1
if (`$browser) { Start-Process -FilePath `$browser -ArgumentList "--app=`$url" }
else { Start-Process `$url }
"@
[IO.File]::WriteAllText($OpenScript, $open, $Utf8Bom)
$openVbs = "CreateObject(""WScript.Shell"").Run ""powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """"$OpenScript"""""", 0, False"
[IO.File]::WriteAllText($OpenVbs, $openVbs, [Text.Encoding]::ASCII)

# 7. Simge: yanında varsa oradan, yoksa GitHub'dan
$localIcon = if ($PSScriptRoot) { Join-Path $PSScriptRoot "..\public\icons\icon.ico" } else { $null }
if ($localIcon -and (Test-Path $localIcon)) {
  Copy-Item $localIcon $IconPath -Force
} else {
  try {
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/$Repo/$Branch/public/icons/icon.ico" -OutFile $IconPath -UseBasicParsing
  } catch { }
}

# 8. Masaüstü ve Başlat menüsü kısayolları
$shell = New-Object -ComObject WScript.Shell
foreach ($lnkPath in @($DesktopLnk, $StartMenuLnk)) {
  $lnk = $shell.CreateShortcut($lnkPath)
  $lnk.TargetPath = Join-Path $env:WINDIR "System32\wscript.exe"
  $lnk.Arguments = "`"$OpenVbs`""
  $lnk.WorkingDirectory = $AppDir
  $lnk.Description = "Sunucu Paneli ($Server)"
  if (Test-Path $IconPath) { $lnk.IconLocation = "$IconPath,0" }
  $lnk.Save()
}

# 9. Tüneli şimdi başlat ve doğrula
Start-Process -FilePath "wscript.exe" -ArgumentList "`"$StartupVbs`""
$ok = $false
for ($i = 0; $i -lt 16; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:$LocalPort/login" -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch { Start-Sleep -Milliseconds 500 }
}

Write-Host ""
if ($ok) {
  Say "Kurulum tamam. Panel: http://localhost:$LocalPort"
} else {
  Warn "Tünel başlatıldı ama panel yanıt vermedi. Sunucuda panelin çalıştığını kontrol edin: pm2 ls"
}
Write-Host "    Masaüstünde ve Başlat menüsünde 'Sunucu Paneli' kısayolu var."
Write-Host "    Tünel her Windows açılışında arka planda kendiliğinden başlar."
Start-Process -FilePath "wscript.exe" -ArgumentList "`"$OpenVbs`""
