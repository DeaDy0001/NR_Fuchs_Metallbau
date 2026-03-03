@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Fuchs Metallbau - APK Builder

echo.
echo  ========================================
echo    Fuchs Metallbau - APK Builder
echo  ========================================
echo.

REM ── 1. Node.js pruefen ──
where node >nul 2>&1
if !ERRORLEVEL! neq 0 goto :NO_NODE
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo  [OK] Node.js %NODE_VER%
goto :CHECK_EAS

:NO_NODE
echo  [FEHLER] Node.js ist nicht installiert!
echo  Download: https://nodejs.org
pause
exit /b 1

REM ── 2. EAS CLI pruefen ──
:CHECK_EAS
where eas >nul 2>&1
if !ERRORLEVEL! neq 0 goto :INSTALL_EAS
for /f "tokens=*" %%i in ('eas --version 2^>nul') do set EAS_VER=%%i
echo  [OK] EAS CLI %EAS_VER%
goto :CHECK_LOGIN

:INSTALL_EAS
echo  [..] EAS CLI wird installiert...
call npm install -g eas-cli
where eas >nul 2>&1
if !ERRORLEVEL! neq 0 goto :EAS_FAIL
echo  [OK] EAS CLI installiert
goto :CHECK_LOGIN

:EAS_FAIL
echo  [FEHLER] EAS CLI Installation fehlgeschlagen.
pause
exit /b 1

REM ── 3. Expo Login pruefen ──
:CHECK_LOGIN
echo.
echo  Pruefe Expo Login...
call eas whoami >nul 2>&1
if !ERRORLEVEL! neq 0 goto :DO_LOGIN
for /f "tokens=*" %%i in ('eas whoami 2^>nul') do set EAS_USER=%%i
echo  [OK] Eingeloggt als: %EAS_USER%
goto :CHECK_PROJECT

:DO_LOGIN
echo.
echo  Du musst dich bei Expo einloggen.
echo  Falls du noch keinen Account hast: https://expo.dev/signup
echo.
call eas login
if !ERRORLEVEL! neq 0 goto :LOGIN_FAIL
call eas whoami >nul 2>&1
if !ERRORLEVEL! neq 0 goto :LOGIN_FAIL
for /f "tokens=*" %%i in ('eas whoami 2^>nul') do set EAS_USER=%%i
echo  [OK] Eingeloggt als: %EAS_USER%
goto :CHECK_PROJECT

:LOGIN_FAIL
echo  [FEHLER] Login fehlgeschlagen. Bitte versuche es erneut.
pause
exit /b 1

REM ── 4. EAS Projekt pruefen/initialisieren ──
:CHECK_PROJECT
echo.
echo  Pruefe EAS Projekt-Konfiguration...

findstr /c:"projectId" app.json >nul 2>&1
if !ERRORLEVEL! equ 0 goto :PROJECT_OK

echo.
echo  EAS Projekt muss einmalig konfiguriert werden.
echo  Waehle "Create a new EAS project" wenn gefragt.
echo.
call eas init
REM Exit-Code von eas init ist unzuverlaessig, pruefen ob projectId jetzt da ist
findstr /c:"projectId" app.json >nul 2>&1
if !ERRORLEVEL! neq 0 goto :PROJECT_FAIL
echo  [OK] EAS Projekt konfiguriert
goto :INSTALL_DEPS

:PROJECT_OK
echo  [OK] EAS Projekt bereits konfiguriert
goto :INSTALL_DEPS

:PROJECT_FAIL
echo  [FEHLER] Projekt-Konfiguration fehlgeschlagen.
pause
exit /b 1

REM ── 5. Dependencies installieren ──
:INSTALL_DEPS
echo.
echo  [..] Installiere Abhaengigkeiten...
call npm install --silent 2>nul
echo  [OK] Abhaengigkeiten installiert

REM ── 6. Output-Ordner ──
if not exist android mkdir android
set "APK_DEST=%CD%\android\app.apk"
if exist "%APK_DEST%" del "%APK_DEST%"

REM ── 7. Build-Methode auswaehlen ──
echo.
echo  ========================================
echo   Wie soll die APK gebaut werden?
echo  ========================================
echo.
echo   1) Lokal bauen (2-5 Min, braucht WSL)
echo   2) Expo Cloud (15-40 Min, kein WSL)
echo.
set "BUILD_CHOICE="
set /p "BUILD_CHOICE=  Deine Wahl [1/2]: "

if "!BUILD_CHOICE!"=="1" goto :BUILD_LOCAL
goto :BUILD_CLOUD

REM ── 7a. LOKAL bauen via WSL ──
:BUILD_LOCAL
echo.
echo  [INFO] Lokaler Android-Build braucht Linux.
echo         Auf Windows wird dafuer WSL verwendet.
echo.

REM Pruefe ob WSL installiert ist
where wsl >nul 2>&1
if !ERRORLEVEL! neq 0 goto :NO_WSL

REM Pruefe ob Ubuntu in WSL vorhanden ist
wsl -d Ubuntu -e /bin/bash -c "echo ok" >nul 2>&1
if !ERRORLEVEL! neq 0 goto :NO_WSL_DISTRO

echo  [OK] WSL Ubuntu vorhanden

REM WSL-Pfad ermitteln
for /f "tokens=*" %%p in ('wsl -d Ubuntu -- wslpath -u "!CD!"') do set "WSL_PATH=%%p"

REM Pruefe Node.js in WSL
wsl -d Ubuntu -e /bin/bash -c "command -v node" >nul 2>&1
if !ERRORLEVEL! neq 0 goto :NO_WSL_NODE

for /f "tokens=*" %%v in ('wsl -d Ubuntu -e /bin/bash -c "node -v"') do echo  [OK] Node.js in WSL: %%v

REM Pruefe Java in WSL
wsl -d Ubuntu -e /bin/bash -c "command -v java" >nul 2>&1
if !ERRORLEVEL! neq 0 goto :NO_WSL_JAVA

echo  [OK] Java in WSL vorhanden

REM Pruefe EAS CLI in WSL
wsl -d Ubuntu -e /bin/bash -c "command -v eas" >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo  [..] EAS CLI in WSL wird installiert...
    wsl -d Ubuntu -e /bin/bash -c "npm install -g eas-cli"
    echo  [OK] EAS CLI in WSL installiert
)

REM Pruefe Yarn in WSL (wird von EAS Build benoetigt)
wsl -d Ubuntu -e /bin/bash -c "command -v yarn" >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo  [..] Yarn in WSL wird installiert...
    wsl -d Ubuntu -u root -e /bin/bash -c "npm install -g yarn"
    wsl -d Ubuntu -e /bin/bash -c "command -v yarn" >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo  [FEHLER] Yarn konnte nicht installiert werden.
        pause
        exit /b 1
    )
    echo  [OK] Yarn in WSL installiert
)

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

REM Schritt 1: npm install in WSL
echo  [1/2] Installiere Abhaengigkeiten in WSL...
echo        (Das kann beim ersten Mal 1-2 Min dauern)
wsl -d Ubuntu -e /bin/bash -c "cd '!WSL_PATH!' && npm install 2>&1"
echo  [OK] Abhaengigkeiten in WSL installiert
echo.

REM Schritt 2: EAS Build starten
echo  [2/2] Baue APK... (Ausgabe von EAS folgt unten)
echo  ----------------------------------------
wsl -d Ubuntu -e /bin/bash -c "cd '!WSL_PATH!' && eas build -p android --profile preview --local --output android/app.apk 2>&1"
echo  ----------------------------------------

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

:NO_WSL_DISTRO
echo  [FEHLER] Keine Linux-Distribution in WSL gefunden!
echo.
echo  Oeffne PowerShell als Admin und fuehre aus:
echo    wsl --install -d Ubuntu
echo  Danach PC neu starten.
echo.
echo  Alternativ: Script neu starten, Option 2 waehlen.
pause
exit /b 1

:NO_WSL
echo  [FEHLER] WSL ist nicht installiert!
echo.
echo  Installation (PowerShell als Admin oeffnen):
echo    wsl --install
echo  Danach PC neu starten.
echo.
echo  Alternativ: Script neu starten, Option 2 waehlen.
pause
exit /b 1

:NO_WSL_NODE
echo.
echo  [FEHLER] Node.js fehlt in WSL!
echo.
echo  [..] Installiere Node.js automatisch in WSL...
wsl -d Ubuntu -u root -e /bin/bash -c "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && apt-get update -qq && apt-get install -y curl ca-certificates gnupg"
wsl -d Ubuntu -u root -e /bin/bash -c "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs"
wsl -d Ubuntu -e /bin/bash -c "command -v node" >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo  [FEHLER] Automatische Installation fehlgeschlagen.
    echo.
    echo  Oeffne ein WSL-Terminal (wsl) und fuehre aus:
    echo    apt-get update ^&^& apt-get install -y curl
    echo    curl -fsSL https://deb.nodesource.com/setup_22.x ^| bash -
    echo    apt-get install -y nodejs
    echo.
    echo  Danach dieses Script erneut starten.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('wsl -d Ubuntu -e /bin/bash -c "node -v"') do echo  [OK] Node.js in WSL: %%v
goto :BUILD_LOCAL

:NO_WSL_JAVA
echo.
echo  [FEHLER] Java fehlt in WSL!
echo.
echo  [..] Installiere Java automatisch in WSL...
wsl -d Ubuntu -u root -e /bin/bash -c "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && apt-get update -qq && apt-get install -y openjdk-17-jdk"
wsl -d Ubuntu -e /bin/bash -c "command -v java" >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo  [FEHLER] Automatische Installation fehlgeschlagen.
    echo.
    echo  Oeffne ein WSL-Terminal (wsl) und fuehre aus:
    echo    apt-get update ^&^& apt-get install -y openjdk-17-jdk
    echo.
    echo  Danach dieses Script erneut starten.
    pause
    exit /b 1
)
echo  [OK] Java installiert
goto :BUILD_LOCAL

REM ── 7b. CLOUD bauen ──
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

call eas build -p android --profile preview --non-interactive

REM ── 8. APK herunterladen ──
echo.
echo  [..] Suche Download-Link...

set "TEMP_JSON=%TEMP%\eas_build_result.json"
call eas build:list --platform android --limit 1 --status finished --json > "%TEMP_JSON%" 2>nul

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
