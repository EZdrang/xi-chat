# 汐 · Android 构建脚本（无 Gradle：aapt2 + javac + d8 + zipalign + apksigner）
#
# 前置：JDK 17、Android SDK（platform-34 + build-tools 34.0.0）、Python 3
# 可用环境变量覆盖：ANDROID_SDK_ROOT / JAVA_HOME / PYTHON
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = $PSScriptRoot

$SDK = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT }
       elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME }
       elseif (Test-Path "$env:LOCALAPPDATA\Android\Sdk") { "$env:LOCALAPPDATA\Android\Sdk" }
       else { throw '找不到 Android SDK：设 ANDROID_SDK_ROOT，或装到 %LOCALAPPDATA%\Android\Sdk' }

$BT   = Join-Path $SDK 'build-tools\34.0.0'
$AJAR = Join-Path $SDK 'platforms\android-34\android.jar'
if (-not (Test-Path $BT))   { throw "缺 build-tools 34.0.0：$BT" }
if (-not (Test-Path $AJAR)) { throw "缺 platform android-34：$AJAR" }

if (-not $env:JAVA_HOME) {
    $jdk = Get-ChildItem 'C:\Program Files\*' -Directory -Filter '*jdk*' -ErrorAction SilentlyContinue |
           Select-Object -First 1
    if ($jdk) { $env:JAVA_HOME = $jdk.FullName }
}

$PY = if ($env:PYTHON) { $env:PYTHON }
      else { (Get-Command python -ErrorAction SilentlyContinue).Source }
if (-not $PY) { throw '找不到 python：装 Python 3 或设 PYTHON 环境变量' }

$App     = Join-Path $Root 'app'
$Build   = Join-Path $Root 'build'
$Dist    = Join-Path $Root 'dist'
$KS      = Join-Path $Root 'xi-release.jks'
$KS_PASS = $env:XI_KS_PASS
if (-not $KS_PASS) { $KS_PASS = 'xichat2026' }

function Step($name) { Write-Host "`n===== $name =====" -ForegroundColor Cyan }

# 清理
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
$apk = Join-Path $Dist 'xi-chat-v1.4.apk'
& (Join-Path $BT 'apksigner.bat') sign --ks $KS --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" `
    --v1-signing-enabled true --v2-signing-enabled true `
    --out $apk (Join-Path $Build 'aligned.apk')
if ($LASTEXITCODE -ne 0) { throw 'apksigner failed' }

Step 'verify'
& (Join-Path $BT 'apksigner.bat') verify --print-certs $apk
& (Join-Path $BT 'aapt2.exe') dump badging $apk | Select-String -Pattern 'package:|launchable-activity|sdkVersion|targetSdkVersion|application-label'

$size = [math]::Round((Get-Item $apk).Length / 1KB, 1)
Write-Host "`n完成：$apk  ($size KB)" -ForegroundColor Green
