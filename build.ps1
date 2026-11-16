# Xi Chat - Android build (no Gradle: aapt2 + javac + d8 + zipalign + apksigner)
#
# Requirements: JDK 17, Android SDK (platform-34 + build-tools 34.0.0), Python 3
# Override with env vars: ANDROID_SDK_ROOT / ANDROID_HOME / JAVA_HOME / PYTHON
# NOTE: keep this file ASCII-only. PowerShell 5.1 reads BOM-less UTF-8 as ANSI.
# Native tools write warnings to stderr; we rely on $LASTEXITCODE, not on stderr.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$Root = $PSScriptRoot

function Find-Sdk {
    $candidates = @()
    if ($env:ANDROID_SDK_ROOT) { $candidates += $env:ANDROID_SDK_ROOT }
    if ($env:ANDROID_HOME)     { $candidates += $env:ANDROID_HOME }
    $candidates += @(
        (Join-Path $env:LOCALAPPDATA 'Android\Sdk'),
        (Join-Path $env:USERPROFILE 'android-sdk'),
        (Join-Path $env:USERPROFILE 'Android\Sdk'),
        'C:\android-sdk',
        'C:\Android\Sdk'
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path (Join-Path $c 'platforms\android-34\android.jar'))) { return $c }
    }
    throw "Android SDK not found. Set ANDROID_SDK_ROOT or install to $env:LOCALAPPDATA\Android\Sdk"
}

$SDK  = Find-Sdk
$BT   = Join-Path $SDK 'build-tools\34.0.0'
$AJAR = Join-Path $SDK 'platforms\android-34\android.jar'
if (-not (Test-Path $BT)) { throw "Missing build-tools 34.0.0 in $SDK" }

if (-not $env:JAVA_HOME) {
    $jdk = Get-ChildItem 'C:\Program Files\*' -Directory -Filter '*jdk*' -ErrorAction SilentlyContinue |
           Select-Object -First 1
    if ($jdk) { $env:JAVA_HOME = $jdk.FullName }
}

$PY = if ($env:PYTHON) { $env:PYTHON }
      else { (Get-Command python -ErrorAction SilentlyContinue).Source }
if (-not $PY) { throw 'python not found. Install Python 3 or set PYTHON.' }

$App     = Join-Path $Root 'app'
$Build   = Join-Path $Root 'build'
$Dist    = Join-Path $Root 'dist'
$KS      = Join-Path $Root 'xi-release.jks'
$KS_PASS = if ($env:XI_KS_PASS) { $env:XI_KS_PASS } else { 'xichat2026' }

function Step($name) { Write-Host "`n===== $name =====" -ForegroundColor Cyan }

if (Test-Path $Build) { Remove-Item $Build -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Build, (Join-Path $Build 'gen'), (Join-Path $Build 'obj'), (Join-Path $Build 'dex'), $Dist | Out-Null

Step '1/6 aapt2 compile'
& (Join-Path $BT 'aapt2.exe') compile --dir (Join-Path $App 'res') -o (Join-Path $Build 'res.zip')
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile failed' }

Step '2/6 aapt2 link'
& (Join-Path $BT 'aapt2.exe') link `
    -o (Join-Path $Build 'base.apk') `
    -I $AJAR `
    --manifest (Join-Path $App 'AndroidManifest.xml') `
    -A (Join-Path $App 'assets') `
    --java (Join-Path $Build 'gen') `
    --auto-add-overlay `
    (Join-Path $Build 'res.zip')
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link failed' }

Step '3/6 javac'
$sources = @()
$sources += Get-ChildItem (Join-Path $Build 'gen') -Recurse -Filter *.java | ForEach-Object { $_.FullName }
$sources += Get-ChildItem (Join-Path $App 'src') -Recurse -Filter *.java | ForEach-Object { $_.FullName }
& javac -nowarn -encoding UTF-8 --release 8 -classpath $AJAR -d (Join-Path $Build 'obj') $sources
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }

Step '4/6 d8'
$classes = Get-ChildItem (Join-Path $Build 'obj') -Recurse -Filter *.class | ForEach-Object { $_.FullName }
& (Join-Path $BT 'd8.bat') --release --lib $AJAR --min-api 24 --output (Join-Path $Build 'dex') $classes
if ($LASTEXITCODE -ne 0) { throw 'd8 failed' }

Step '5/6 pack + zipalign'
& $PY (Join-Path $Root 'tools\add_dex.py') (Join-Path $Build 'base.apk') (Join-Path $Build 'dex') (Join-Path $Build 'packed.apk')
if ($LASTEXITCODE -ne 0) { throw 'pack failed' }
& (Join-Path $BT 'zipalign.exe') -f -p 4 (Join-Path $Build 'packed.apk') (Join-Path $Build 'aligned.apk')
if ($LASTEXITCODE -ne 0) { throw 'zipalign failed' }

Step '6/6 sign'
if (-not (Test-Path $KS)) {
    & keytool -genkeypair -keystore $KS -alias xi -keyalg RSA -keysize 2048 -validity 10950 `
        -storepass $KS_PASS -keypass $KS_PASS `
        -dname "CN=Xi Chat, OU=Xi, O=Xi, L=Shanghai, C=CN"
    if ($LASTEXITCODE -ne 0) { throw 'keytool failed' }
}
$apk = Join-Path $Dist 'xi-chat-v1.9.apk'
& (Join-Path $BT 'apksigner.bat') sign --ks $KS --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" `
    --v1-signing-enabled true --v2-signing-enabled true `
    --out $apk (Join-Path $Build 'aligned.apk')
if ($LASTEXITCODE -ne 0) { throw 'apksigner failed' }

Step 'verify'
& (Join-Path $BT 'apksigner.bat') verify --print-certs $apk | Select-String 'SHA-256'
& (Join-Path $BT 'aapt2.exe') dump badging $apk | Select-String -Pattern 'package:|application-label|sdkVersion|targetSdkVersion'

$size = [math]::Round((Get-Item $apk).Length / 1KB, 1)
Write-Host "`nOK: $apk  ($size KB)" -ForegroundColor Green
