@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Fuchs Metallbau - APK Builder

echo.
echo  ========================================
echo    Fuchs Metallbau - APK Builder
echo  ========================================
echo.

:: ── 1. Node.js pruefen ──
where node >nul 2>&1
if %ERRORLEVEL% neq 0 goto :NO_NODE
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo  [OK] Node.js %NODE_VER%
goto :CHECK_EAS

:NO_NODE
echo  [FEHLER] Node.js ist nicht installiert!
echo  Download: https://nodejs.org
pause
exit /b 1

:: ── 2. EAS CLI pruefen ──
:CHECK_EAS
where eas >nul 2>&1
if %ERRORLEVEL% neq 0 goto :INSTALL_EAS
for /f "tokens=*" %%i in ('eas --version 2^>nul') do set EAS_VER=%%i
echo  [OK] EAS CLI %EAS_VER%
goto :CHECK_LOGIN

:INSTALL_EAS
echo  [..] EAS CLI wird installiert...
call npm install -g eas-cli
where eas >nul 2>&1
if %ERRORLEVEL% neq 0 goto :EAS_FAIL
echo  [OK] EAS CLI installiert
goto :CHECK_LOGIN

:EAS_FAIL
echo  [FEHLER] EAS CLI Installation fehlgeschlagen.
pause
exit /b 1

:: ── 3. Expo Login pruefen ──
:CHECK_LOGIN
echo.
echo  Pruefe Expo Login...
call eas whoami >nul 2>&1
if %ERRORLEVEL% neq 0 goto :DO_LOGIN
for /f "tokens=*" %%i in ('eas whoami 2^>nul') do set EAS_USER=%%i
echo  [OK] Eingeloggt als: %EAS_USER%
goto :CHECK_PROJECT

:DO_LOGIN
echo.
echo  Du musst dich bei Expo einloggen.
echo  Falls du noch keinen Account hast: https://expo.dev/signup
echo.
call eas login
if %ERRORLEVEL% neq 0 goto :LOGIN_FAIL
call eas whoami >nul 2>&1
if %ERRORLEVEL% neq 0 goto :LOGIN_FAIL
for /f "tokens=*" %%i in ('eas whoami 2^>nul') do set EAS_USER=%%i
echo  [OK] Eingeloggt als: %EAS_USER%
goto :CHECK_PROJECT

:LOGIN_FAIL
echo  [FEHLER] Login fehlgeschlagen. Bitte versuche es erneut.
pause
exit /b 1

:: ── 4. EAS Projekt pruefen/initialisieren ──
:CHECK_PROJECT
echo.
echo  Pruefe EAS Projekt-Konfiguration...

:: Prüfe ob projectId schon in app.json existiert
findstr /c:"projectId" app.json >nul 2>&1
if %ERRORLEVEL% equ 0 goto :PROJECT_OK

:: Projekt noch nicht initialisiert
echo.
echo  EAS Projekt muss einmalig konfiguriert werden.
echo  Waehle "Create a new EAS project" wenn gefragt.
echo.
call eas init
if %ERRORLEVEL% neq 0 goto :PROJECT_FAIL
echo  [OK] EAS Projekt konfiguriert
goto :INSTALL_DEPS

:PROJECT_OK
echo  [OK] EAS Projekt bereits konfiguriert
goto :INSTALL_DEPS

:PROJECT_FAIL
echo  [FEHLER] Projekt-Konfiguration fehlgeschlagen.
pause
exit /b 1

:: ── 5. Dependencies installieren ──
:INSTALL_DEPS
echo.
echo  [..] Installiere Abhaengigkeiten...
call npm install --silent 2>nul
echo  [OK] Abhaengigkeiten installiert

:: ── 6. Output-Ordner ──
if not exist android mkdir android
set "APK_DEST=%CD%\android\app.apk"

:: Alte APK loeschen damit wir sicher wissen ob der neue Build geklappt hat
if exist "%APK_DEST%" del "%APK_DEST%"

:: ── 7. Build-Methode auswaehlen ──
echo.
echo  ========================================
echo   Wie soll die APK gebaut werden?
echo  ========================================
echo.
echo   1) Lokal bauen (2-5 Min, braucht Java)
echo   2) Expo Cloud (15-40 Min, kein Java)
echo.
set "BUILD_CHOICE="
set /p "BUILD_CHOICE=  Deine Wahl [1/2]: "

if "!BUILD_CHOICE!"=="1" goto :BUILD_LOCAL
goto :BUILD_CLOUD

:: ── 7a. LOKAL bauen (via WSL, da Windows kein --local unterstuetzt) ──
:BUILD_LOCAL
echo.
echo  [INFO] Lokaler Android-Build braucht Linux.
echo         Auf Windows wird dafuer WSL verwendet.
echo.

:: Check WSL
where wsl >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [FEHLER] WSL ist nicht installiert!
    echo.
    echo  Installation (PowerShell als Admin oeffnen):
    echo    wsl --install
    echo  Danach PC neu starten.
    echo.
    echo  Alternativ: Script neu starten, Option 2 waehlen.
    pause
    exit /b 1
)
echo  [OK] WSL vorhanden

:: Get WSL path for current directory
for /f "tokens=*" %%p in ('wsl wslpath -u "%CD%"') do set "WSL_PATH=%%p"

:: Check Node.js in WSL
wsl bash -c "command -v node" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo.
    echo  [FEHLER] Node.js fehlt in WSL!
    echo.
    echo  Oeffne ein WSL-Terminal und fuehre aus:
    echo    curl -fsSL https://deb.nodesource.com/setup_22.x ^| sudo -E bash -
    echo    sudo apt-get install -y nodejs
    echo    npm install -g eas-cli
    echo.
    echo  Danach dieses Script erneut starten.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('wsl bash -c "node -v"') do echo  [OK] Node.js in WSL: %%v

:: Check Java in WSL
wsl bash -c "command -v java" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo.
    echo  [FEHLER] Java fehlt in WSL!
    echo.
    echo  Oeffne ein WSL-Terminal und fuehre aus:
    echo    sudo apt-get install -y openjdk-17-jdk
    echo.
    echo  Danach dieses Script erneut starten.
    pause
    exit /b 1
)
echo  [OK] Java in WSL vorhanden

echo.
echo  ========================================
echo   Starte lokalen APK Build via WSL...
echo   (Das dauert ca. 2-5 Minuten)
echo  ========================================
echo.
echo   Beim ersten Mal wirst du evtl. nach
echo   Expo-Login gefragt und ob ein Keystore
echo   generiert werden soll - waehle Yes.
echo.

:: npm install in WSL (Linux braucht eigene native Binaries) + Build starten
wsl bash -c "cd '!WSL_PATH!' && npm install --silent 2>/dev/null && npx eas build -p android --profile preview --local --output android/app.apk"

:: Pruefen ob APK erstellt wurde
if exist "%APK_DEST%" goto :BUILD_SUCCESS
echo.
echo  [FEHLER] Lokaler Build via WSL fehlgeschlagen.
echo.
echo  Tipps:
echo   - Stelle sicher dass du in WSL bei Expo
echo     eingeloggt bist: eas login
echo   - Oder starte das Script erneut mit Option 2
echo.
goto :CLEANUP

:: ── 7b. CLOUD bauen ──
:BUILD_CLOUD
echo.
echo  ========================================
echo   Starte APK Build in der Expo Cloud...
echo   (Das dauert ca. 15-40 Minuten)
echo   Die APK wird danach automatisch geladen.
echo  ========================================
echo.
echo   Beim ersten Mal wirst du gefragt ob ein
echo   Keystore generiert werden soll - waehle Yes.
echo.

:: Build starten (non-interactive verhindert Emulator-Frage)
call eas build -p android --profile preview --non-interactive

:: ── 8. APK herunterladen ──
echo.
echo  [..] Suche Download-Link...

:: JSON Output in Temp-Datei speichern (for/f kann kein mehrzeiliges JSON)
set "TEMP_JSON=%TEMP%\eas_build_result.json"
call eas build:list --platform android --limit 1 --status finished --json > "%TEMP_JSON%" 2>nul

:: PowerShell liest JSON-Datei, extrahiert URL und laedt APK herunter
:: Hinweis: EAS gibt manchmal Text vor dem JSON aus, daher suchen wir die JSON-Array-Zeile
powershell -Command ^
  "$raw = Get-Content '%TEMP_JSON%' -Raw -ErrorAction SilentlyContinue; " ^
  "if (-not $raw) { Write-Host '  [FEHLER] Keine Build-Daten gefunden'; exit 1 }; " ^
  "$jsonStart = $raw.IndexOf('['); " ^
  "if ($jsonStart -lt 0) { Write-Host '  [FEHLER] Kein JSON in Build-Ausgabe gefunden'; exit 1 }; " ^
  "$json = $raw.Substring($jsonStart); " ^
  "$builds = $json | ConvertFrom-Json; " ^
  "$url = $builds[0].artifacts.buildUrl; " ^
  "if (-not $url) { Write-Host '  [FEHLER] Kein Download-Link im Build gefunden'; exit 1 }; " ^
  "Write-Host '  [OK] Download-Link:' $url; " ^
  "Write-Host '  [..] Lade APK herunter...'; " ^
  "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
  "Invoke-WebRequest -Uri $url -OutFile '%APK_DEST%' -UseBasicParsing; " ^
  "Write-Host '  [OK] Download abgeschlossen'"

if exist "%TEMP_JSON%" del "%TEMP_JSON%"

:: Pruefen ob APK heruntergeladen wurde
if exist "%APK_DEST%" goto :BUILD_SUCCESS
goto :NO_URL

:BUILD_SUCCESS
for %%F in ("%APK_DEST%") do set "APK_SIZE=%%~zF"
set /a APK_MB=!APK_SIZE! / 1048576

echo.
echo  ========================================
echo    APK erfolgreich erstellt und geladen!
echo  ========================================
echo.
echo  Datei:   %APK_DEST%
echo  Groesse: ca. %APK_MB% MB
echo.
echo  Die APK ist jetzt verfuegbar:
echo   - Desktop: Einstellungen ^> Handy App
echo   - Handy:   QR-Code scannen ^> Download
echo.
goto :CLEANUP

:NO_URL
echo.
echo  ========================================
echo   Build abgeschlossen, aber der Download-
echo   Link konnte nicht erkannt werden.
echo.
echo   Bitte gehe zu https://expo.dev und
echo   lade die APK manuell herunter.
echo   Speichere sie als:
echo   %APK_DEST%
echo  ========================================
goto :CLEANUP

:CLEANUP
echo.
pause
