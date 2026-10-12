# Sunucu Paneli: Windows kurulumu
#
# Paneli Windows'ta uygulama gibi açar. Ne yapar:
#   1. Bu tünel için ayrı bir SSH anahtarı oluşturur ve sunucuya ekler.
#      Sunucu şifreniz BİR KEZ sorulur. Anahtar sunucuda sadece panele tünel
#      açabilecek şekilde kısıtlanır (komut çalıştıramaz, başka porta bağlanamaz,
#      sunucuda port dinleyemez).
#   2. Windows açılışında görünmez pencerede başlayan, kopunca kendini yeniden
#      bağlayan bir SSH tüneli kurar.
#   3. Masaüstüne ve Başlat menüsüne "Sunucu Paneli" kısayolu ekler. Kısayol
#      paneli ayrı bir uygulama penceresinde açar.
#
# Tek komutla kurulum (PowerShell):
#   iwr -useb https://raw.githubusercontent.com/awendorr/server-panel/main/windows/kur.ps1 -OutFile $env:TEMP\panel-kur.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\panel-kur.ps1
#
# Parametreler (hepsi isteğe bağlı, verilmezse sorulur):
#   -Server kullanici@sunucu   -SshPort 22   -RemotePort 7319   -LocalPort 8282
# Ayarları değiştirmek için tekrar çalıştırın (önceki değerler varsayılan olur).
# Kaldırmak için (kurulum kendini buraya kopyalar):
#   powershell -ExecutionPolicy Bypass -File $env:LOCALAPPDATA\ServerPanel\kur.ps1 -Uninstall

param(
  [string]$Server,
  [int]$SshPort = 0,
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
$InstallerCopy = Join-Path $AppDir "kur.ps1"
$KeyPath = Join-Path $env:USERPROFILE ".ssh\server-panel_ed25519"
$LoopScript = Join-Path $AppDir "tunnel.ps1"
$OpenScript = Join-Path $AppDir "open.ps1"
$OpenVbsPath = Join-Path $AppDir "open.vbs"
$IconPath = Join-Path $AppDir "icon.ico"
$StartupVbsPath = Join-Path ([Environment]::GetFolderPath("Startup")) "ServerPanelTunnel.vbs"
$DesktopLnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "Sunucu Paneli.lnk"
$StartMenuLnk = Join-Path ([Environment]::GetFolderPath("Programs")) "Sunucu Paneli.lnk"
$Utf8Bom = New-Object System.Text.UTF8Encoding $true
# Windows Script Host UTF-8 okuyamaz; Türkçe karakterli kullanıcı klasörleri için UTF-16 (BOM'lu)
$VbsEncoding = [Text.Encoding]::Unicode

function Say($msg) { Write-Host "==> $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "!!  $msg" -ForegroundColor Yellow }
# Üretilen betiklere yolları tek tırnaklı PowerShell metni olarak göm ($, ` ve ' güvenli)
function Q($s) { "'" + ([string]$s).Replace("'", "''") + "'" }

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
  Remove-Item $StartupVbsPath, $DesktopLnk, $StartMenuLnk -ErrorAction SilentlyContinue
  Remove-Item $AppDir -Recurse -ErrorAction SilentlyContinue
  Say "Sunucu Paneli kaldırıldı (tünel, kısayollar, ayarlar)."
  Write-Host "    SSH anahtarı duruyor: $KeyPath"
  Write-Host "    Sunucudaki izni de kaldırmak için sunucuda ~/.ssh/authorized_keys içindeki 'server-panel-tunnel' ile biten satırı silin."
  exit 0
}

# Önceki kurulumun ayarları (yeniden çalıştırınca varsayılan olur)
$prev = $null
if (Test-Path $ConfigPath) { try { $prev = Get-Content $ConfigPath -Raw | ConvertFrom-Json } catch { } }
function PrevOr($name, $default) {
  if ($prev -and $prev.$name) { return $prev.$name }
  return $default
}

function Ask($label, $default) {
  $hint = if ($default) { " [$default]" } else { "" }
  $v = Read-Host "$label$hint"
  if ([string]::IsNullOrWhiteSpace($v)) { return $default }
  return $v.Trim()
}

function Assert-Port($label, $value) {
  $p = 0
  if (-not [int]::TryParse("$value", [ref]$p) -or $p -lt 1 -or $p -gt 65535) {
    Warn "$label 1-65535 arasında bir sayı olmalı (girilen: '$value')."
    exit 1
  }
  return $p
}

if (-not $Server) {
  $Server = Ask "Sunucu (kullanici@adres, ör. ali@192.168.1.10)" (PrevOr "Server" $null)
}
$Server = "$Server".Trim()
# "kullanici@adres:2222" yazıldıysa SSH portunu ayır
if ($Server -match '^([^@:]+@[^:]+):(\d+)$') {
  $Server = $Matches[1]
  if (-not $SshPort) { $SshPort = Assert-Port "SSH portu" $Matches[2] }
}
# Adres: alan adı, IPv4 ya da IPv6 (ör. kullanici@fe80::1)
if ($Server -notmatch '^[A-Za-z0-9._-]+@([A-Za-z0-9._-]+|[0-9A-Fa-f]*:[0-9A-Fa-f:.]+)$') {
  Warn "Sunucu 'kullanici@adres' biçiminde olmalı."
  exit 1
}
if ($SshPort) { $SshPort = Assert-Port "SSH portu" $SshPort }
else { $SshPort = Assert-Port "SSH portu" (Ask "SSH portu" (PrevOr "SshPort" 22)) }
if ($RemotePort) { $RemotePort = Assert-Port "Sunucudaki panel portu" $RemotePort }
else { $RemotePort = Assert-Port "Sunucudaki panel portu" (Ask "Sunucudaki panel portu" (PrevOr "RemotePort" 7319)) }
if ($LocalPort) { $LocalPort = Assert-Port "Bu bilgisayardaki port" $LocalPort }
else { $LocalPort = Assert-Port "Bu bilgisayardaki port" (Ask "Bu bilgisayarda kullanılacak port" (PrevOr "LocalPort" 8282)) }

# 1. OpenSSH istemcisi
$ssh = Get-Command ssh.exe -ErrorAction SilentlyContinue
if (-not $ssh) {
  Warn "ssh.exe bulunamadı. Ayarlar > Uygulamalar > İsteğe bağlı özellikler > 'OpenSSH İstemcisi' ekleyin ve tekrar çalıştırın."
  exit 1
}
$sshExe = $ssh.Source
$sshBase = @("-p", "$SshPort", "-o", "ConnectTimeout=8", "-o", "StrictHostKeyChecking=accept-new")
# Yalnızca bu anahtar denensin: ssh-agent'taki ya da ~/.ssh/config'teki başka anahtarlar karışmasın
$sshKey = $sshBase + @("-i", $KeyPath, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes")

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
$keyBody = $pub.Split(' ')[1]

# Anahtar sunucuda kısıtlı olarak kayıtlı mı? Kısıtlıysa komut çalışmaz, 'unrestricted' yazılmaz.
function Test-TunnelKey {
  $out = & $sshExe @sshKey $Server "echo unrestricted" 2>$null
  # Sunucudaki .bashrc vb. bir şey yazdırabilir; yalnızca komutun kendi çıktısına bakılır
  return ($LASTEXITCODE -eq 0) -and ($out -notcontains 'unrestricted')
}

# 4. Anahtar yoksa, ayar değiştiyse ya da ilk kurulumsa sunucudaki satırı yaz (şifre bir kez sorulur)
# KeyOpts: sunucudaki satırın biçimi değişince eski kurulumlar bir kez güncellenir
$changed = (-not $prev) -or ((PrevOr "KeyOpts" 1) -ne 2) -or ($prev.Server -ne $Server) -or ($prev.RemotePort -ne $RemotePort) -or ((PrevOr "SshPort" 22) -ne $SshPort)
if ($changed -or -not (Test-TunnelKey)) {
  Say "Anahtar sunucuya ekleniyor. $Server için SSH şifreniz sorulabilir (bir kez)."
  # Komutta çift tırnak kullanılmıyor (PowerShell 5.1 onları ssh'ye bozuk geçirir); \042 sunucuda " olur.
  # Önce yalnızca bu anahtarın eski satırı silinir (port değişmiş olabilir), kullanıcının diğer satırlarına dokunulmaz.
  # Dosya satır sonuyla bitmiyorsa yeni satır son satıra yapışmasın diye önce satır sonu eklenir.
  $ak = "~/.ssh/authorized_keys"
  $remote = "umask 077; mkdir -p ~/.ssh; touch $ak; " +
    "tail -c1 $ak | LC_ALL=C grep -q . && echo >> $ak; " +
    "sed -i '\#^restrict,port-forwarding,permitopen=.*$keyBody#d' $ak; " +
    "printf 'restrict,port-forwarding,permitopen=\042127.0.0.1:$RemotePort\042,permitlisten=\042127.0.0.1:1\042,command=\042/bin/true\042 %s\n' '$pub' >> $ak"
  & $sshExe @sshBase $Server $remote
  if ($LASTEXITCODE -ne 0) { Warn "Anahtar eklenemedi (şifre yanlış olabilir). Tekrar deneyin."; exit 1 }

  if (-not (Test-TunnelKey)) {
    Warn "Anahtarla giriş doğrulanamadı. Sunucuda ~/.ssh izinlerini kontrol edin: chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys"
    Warn "authorized_keys içinde bu anahtarın kısıtsız bir kopyası varsa (satır sonunda 'server-panel-tunnel') onu silip tekrar deneyin."
    exit 1
  }
}
Say "Anahtarla giriş çalışıyor."

New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
@{ Server = $Server; SshPort = $SshPort; KeyOpts = 2; RemotePort = $RemotePort; LocalPort = $LocalPort } | ConvertTo-Json |
  ForEach-Object { [IO.File]::WriteAllText($ConfigPath, $_, $Utf8Bom) }

# Kaldırma için kurulumun bir kopyasını sakla (%TEMP% temizlenebilir)
if ($PSCommandPath -and ($PSCommandPath -ne $InstallerCopy)) {
  Copy-Item -LiteralPath $PSCommandPath -Destination $InstallerCopy -Force -ErrorAction SilentlyContinue
}

# 5. Kopunca yeniden bağlanan tünel
$loop = @"
# Sunucu Paneli tüneli: kopunca 5 sn sonra yeniden bağlanır
while (`$true) {
  & $(Q $sshExe) -i $(Q $KeyPath) -p $SshPort -N -L 127.0.0.1:${LocalPort}:127.0.0.1:${RemotePort} ``
    -o IdentitiesOnly=yes -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 ``
    -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new $(Q $Server)
  Start-Sleep -Seconds 5
}
"@
[IO.File]::WriteAllText($LoopScript, $loop, $Utf8Bom)

# Windows açılışında görünmez başlat (yönetici izni gerektirmez)
$startupVbsText = "CreateObject(""WScript.Shell"").Run ""powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """"$LoopScript"""""", 0, False"
[IO.File]::WriteAllText($StartupVbsPath, $startupVbsText, $VbsEncoding)

# 6. Kısayolun çalıştıracağı betik: tünel kapalıysa başlat, hazır olunca paneli uygulama penceresinde aç
#    Hazır mı kontrolü 127.0.0.1'e yapılır: tünel yalnızca IPv4'te dinler, "localhost" önce ::1'i dener.
$open = @"
`$url = "http://localhost:$LocalPort/"
`$running = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
  Where-Object { `$_.CommandLine -like "*ServerPanel\tunnel.ps1*" }
if (-not `$running) {
  `$vbs = Join-Path ([Environment]::GetFolderPath('Startup')) 'ServerPanelTunnel.vbs'
  Start-Process -FilePath "wscript.exe" -ArgumentList ('"' + `$vbs + '"')
}
for (`$i = 0; `$i -lt 20; `$i++) {
  try { Invoke-WebRequest -Uri "http://127.0.0.1:$LocalPort/login" -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Milliseconds 500 }
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
$openVbsText = "CreateObject(""WScript.Shell"").Run ""powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """"$OpenScript"""""", 0, False"
[IO.File]::WriteAllText($OpenVbsPath, $openVbsText, $VbsEncoding)
if (-not (Test-Path $OpenVbsPath) -or -not (Test-Path $StartupVbsPath)) {
  Warn "Başlatma dosyaları yazılamadı: $AppDir"
  exit 1
}

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
  $lnk.Arguments = "`"$OpenVbsPath`""
  $lnk.WorkingDirectory = $AppDir
  $lnk.Description = "Sunucu Paneli ($Server)"
  if (Test-Path $IconPath) { $lnk.IconLocation = "$IconPath,0" }
  $lnk.Save()
}

# 9. Tüneli şimdi başlat ve doğrula
Start-Process -FilePath "wscript.exe" -ArgumentList "`"$StartupVbsPath`""
$ok = $false
for ($i = 0; $i -lt 20; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$LocalPort/login" -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch { Start-Sleep -Milliseconds 500 }
}

Write-Host ""
if ($ok) {
  Say "Kurulum tamam. Panel: http://localhost:$LocalPort"
} else {
  Warn "Tünel başlatıldı ama panel yanıt vermedi. Sunucuda panelin çalıştığını ve portun $RemotePort olduğunu kontrol edin: pm2 ls"
}
Write-Host "    Masaüstünde ve Başlat menüsünde 'Sunucu Paneli' kısayolu var."
Write-Host "    Tünel her Windows açılışında arka planda kendiliğinden başlar."
Write-Host "    Kaldırmak için: powershell -ExecutionPolicy Bypass -File `"$InstallerCopy`" -Uninstall"
Start-Process -FilePath "wscript.exe" -ArgumentList "`"$OpenVbsPath`""
