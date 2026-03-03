@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Fuchs Metallbau - Entwicklungsumgebung

echo.
echo  ========================================
echo    Fuchs Metallbau - Dev Tools
echo  ========================================
echo.

REM ── 1. Node.js pruefen ──
where node >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo  [FEHLER] Node.js ist nicht installiert!
    echo  Download: https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo  [OK] Node.js %NODE_VER%

REM ── 2. Was moechtest du tun? ──
echo.
echo  ========================================
echo   Was moechtest du tun?
echo  ========================================
echo.
echo   1) Testen mit Expo Go (Handy)
echo      App auf dem Handy testen via QR-Code
echo.
echo   2) APK bauen - Expo Cloud
echo      Build in der Cloud (15-40 Min)
echo.
echo   3) APK bauen - Lokal (WSL)
echo      Lokaler Build via WSL (2-5 Min)
echo.
set "MAIN_CHOICE="
set /p "MAIN_CHOICE=  Deine Wahl [1/2/3]: "

if "!MAIN_CHOICE!"=="2" goto :SETUP_BUILD
if "!MAIN_CHOICE!"=="3" goto :SETUP_BUILD
goto :START_EXPO

REM ══════════════════════════════════════════
REM  Gemeinsame Build-Vorbereitung (Option 2+3)
REM ══════════════════════════════════════════
:SETUP_BUILD

REM EAS CLI pruefen
where eas >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo  [..] EAS CLI wird installiert...
    call npm install -g eas-cli
    where eas >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo  [FEHLER] EAS CLI Installation fehlgeschlagen.
        pause
        exit /b 1
    )
    echo  [OK] EAS CLI installiert
) else (
    for /f "tokens=*" %%i in ('eas --version 2^>nul') do set EAS_VER=%%i
    echo  [OK] EAS CLI !EAS_VER!
)

REM Expo Login pruefen
echo.
echo  Pruefe Expo Login...
call eas whoami >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo.
    echo  Du musst dich bei Expo einloggen.
    echo  Falls du noch keinen Account hast: https://expo.dev/signup
    echo.
    call eas login
    if !ERRORLEVEL! neq 0 (
        echo  [FEHLER] Login fehlgeschlagen.
        pause
        exit /b 1
    )
    call eas whoami >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo  [FEHLER] Login fehlgeschlagen.
        pause
        exit /b 1
    )
)
for /f "tokens=*" %%i in ('eas whoami 2^>nul') do set EAS_USER=%%i
echo  [OK] Eingeloggt als: !EAS_USER!

REM EAS Projekt pruefen
echo.
echo  Pruefe EAS Projekt-Konfiguration...
findstr /c:"projectId" app.json >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo.
    echo  EAS Projekt muss einmalig konfiguriert werden.
    echo  Waehle "Create a new EAS project" wenn gefragt.
    echo.
    call eas init
    REM Exit-Code von eas init ist unzuverlaessig, pruefen ob projectId jetzt da ist
    findstr /c:"projectId" app.json >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo  [FEHLER] Projekt-Konfiguration fehlgeschlagen.
        pause
        exit /b 1
    )
    echo  [OK] EAS Projekt konfiguriert
) else (
    echo  [OK] EAS Projekt bereits konfiguriert
)

REM Dependencies installieren
echo.
echo  [..] Installiere Abhaengigkeiten...
call npm install --silent 2>nul
echo  [OK] Abhaengigkeiten installiert

REM Output-Ordner
if not exist android mkdir android
set "APK_DEST=%CD%\android\app.apk"
if exist "%APK_DEST%" del "%APK_DEST%"

REM Zur gewaehlten Build-Methode springen
if "!MAIN_CHOICE!"=="3" goto :BUILD_LOCAL
goto :BUILD_CLOUD

REM ══════════════════════════════════════════
REM  Option 3: APK lokal bauen via WSL
REM ══════════════════════════════════════════
:BUILD_LOCAL
echo.
echo  [INFO] Lokaler Android-Build braucht Linux.
echo         Auf Windows wird dafuer WSL verwendet.
echo.

REM Pruefe ob WSL installiert ist
where wsl >nul 2>&1
if !ERRORLEVEL! neq 0 goto :WSL_NOT_FOUND

REM Pruefe ob Ubuntu in WSL vorhanden ist
wsl -d Ubuntu -e /bin/bash -c "echo ok" >nul 2>&1
if !ERRORLEVEL! neq 0 goto :WSL_NO_DISTRO

echo  [OK] WSL Ubuntu vorhanden

REM WSL-Pfad ermitteln
for /f "tokens=*" %%p in ('wsl -d Ubuntu -- wslpath -u "!CD!"') do set "WSL_PATH=%%p"

REM Pruefe Node.js in WSL
wsl -d Ubuntu -e /bin/bash -c "command -v node" >nul 2>&1
if !ERRORLEVEL! neq 0 goto :WSL_NO_NODE

for /f "tokens=*" %%v in ('wsl -d Ubuntu -e /bin/bash -c "node -v"') do echo  [OK] Node.js in WSL: %%v

REM Pruefe Java in WSL
wsl -d Ubuntu -e /bin/bash -c "command -v java" >nul 2>&1
if !ERRORLEVEL! neq 0 goto :WSL_NO_JAVA

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
goto :DONE

:WSL_NO_DISTRO
echo  [FEHLER] Keine Linux-Distribution in WSL gefunden!
echo.
echo  Soll Ubuntu in WSL installiert werden?
echo  (Braucht Admin-Rechte, ca. 1-2 GB Download)
echo.
set "INSTALL_DISTRO="
set /p "INSTALL_DISTRO=  Ubuntu installieren? [j/n]: "
if /i "!INSTALL_DISTRO!"=="j" (
    echo.
    echo  [..] Starte Ubuntu-Installation...
    echo  (Ein Admin-Fenster wird sich oeffnen)
    echo.
    powershell -Command "Start-Process cmd -ArgumentList '/c wsl --install -d Ubuntu && pause' -Verb RunAs"
    echo.
    echo  Nach der Installation: PC neu starten,
    echo  dann dieses Script erneut ausfuehren.
    pause
    exit /b 0
)
echo.
echo  [INFO] Ohne Linux-Distribution kein lokaler Build. Wechsle zu Cloud-Build...
goto :BUILD_CLOUD

:WSL_NOT_FOUND
echo  [FEHLER] WSL ist nicht installiert!
echo.
echo  Soll WSL jetzt installiert werden?
echo  (Braucht Admin-Rechte, PC-Neustart danach noetig)
echo.
set "INSTALL_WSL="
set /p "INSTALL_WSL=  WSL installieren? [j/n]: "
if /i "!INSTALL_WSL!"=="j" (
    echo.
    echo  [..] Starte WSL-Installation...
    echo  (Ein Admin-Fenster wird sich oeffnen)
    echo.
    powershell -Command "Start-Process cmd -ArgumentList '/c wsl --install && pause' -Verb RunAs"
    echo.
    echo  Nach der Installation: PC neu starten,
    echo  dann dieses Script erneut ausfuehren.
    pause
    exit /b 0
)
echo.
echo  [INFO] Ohne WSL kein lokaler Build. Wechsle zu Cloud-Build...
goto :BUILD_CLOUD

:WSL_NO_NODE
echo.
echo  [FEHLER] Node.js fehlt in WSL!
echo.
echo  Soll Node.js in WSL installiert werden?
set "INSTALL_NODE="
set /p "INSTALL_NODE=  Installieren? [j/n]: "
if /i "!INSTALL_NODE!"=="j" (
    echo.
    echo  [..] Installiere Grundpakete in WSL...
    wsl -d Ubuntu -u root -e /bin/bash -c "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && apt-get update -qq && apt-get install -y curl ca-certificates gnupg"
    echo  [..] Installiere Node.js in WSL...
    wsl -d Ubuntu -u root -e /bin/bash -c "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs"
    wsl -d Ubuntu -e /bin/bash -c "command -v node" >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo  [FEHLER] Installation fehlgeschlagen.
        echo.
        echo  Versuche manuell in WSL:
        echo    wsl
        echo    apt-get update ^&^& apt-get install -y nodejs npm
        pause
        exit /b 1
    )
    echo  [OK] Node.js installiert
    goto :BUILD_LOCAL
)
echo.
echo  [INFO] Ohne Node.js kein lokaler Build. Wechsle zu Cloud-Build...
goto :BUILD_CLOUD

:WSL_NO_JAVA
echo.
echo  [FEHLER] Java fehlt in WSL!
echo.
echo  Soll Java in WSL installiert werden?
set "INSTALL_JAVA="
set /p "INSTALL_JAVA=  Installieren? [j/n]: "
if /i "!INSTALL_JAVA!"=="j" (
    echo.
    echo  [..] Installiere Java in WSL (kann etwas dauern)...
    wsl -d Ubuntu -u root -e /bin/bash -c "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH && apt-get update -qq && apt-get install -y openjdk-17-jdk"
    wsl -d Ubuntu -e /bin/bash -c "command -v java" >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo  [FEHLER] Installation fehlgeschlagen.
        echo.
        echo  Versuche manuell in WSL:
        echo    wsl
        echo    apt-get update ^&^& apt-get install -y openjdk-17-jdk
        pause
        exit /b 1
    )
    echo  [OK] Java installiert
    goto :BUILD_LOCAL
)
echo.
echo  [INFO] Ohne Java kein lokaler Build. Wechsle zu Cloud-Build...
goto :BUILD_CLOUD

REM ══════════════════════════════════════════
REM  Option 2: APK bauen in Expo Cloud
REM ══════════════════════════════════════════
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

REM APK herunterladen
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
goto :DONE

REM ══════════════════════════════════════════
REM  Build erfolgreich (Option 2+3)
REM ══════════════════════════════════════════
:BUILD_SUCCESS
for %%F in ("%APK_DEST%") do set "APK_SIZE=%%~zF"
set /a APK_MB=!APK_SIZE! / 1048576

echo.
echo  ========================================
echo    APK erfolgreich erstellt!
echo  ========================================
echo.
echo  Datei:   %APK_DEST%
echo  Groesse: ca. %APK_MB% MB
echo.
echo  Die APK ist jetzt verfuegbar:
echo   - Desktop: Einstellungen ^> Handy App
echo   - Handy:   QR-Code scannen ^> Download
echo.
goto :DONE

REM ══════════════════════════════════════════
REM  Option 1: Testen mit Expo Go (Handy)
REM ══════════════════════════════════════════
:START_EXPO

REM Abhaengigkeiten installieren
set "NEEDS_INSTALL=0"
if not exist "node_modules\expo" set "NEEDS_INSTALL=1"
if not exist "node_modules\expo-navigation-bar" set "NEEDS_INSTALL=1"
if not exist "node_modules\babel-preset-expo" set "NEEDS_INSTALL=1"
if not exist "node_modules\expo-auth-session" set "NEEDS_INSTALL=1"
if not exist "node_modules\expo-web-browser" set "NEEDS_INSTALL=1"
if not exist "node_modules\expo-crypto" set "NEEDS_INSTALL=1"
if not exist "node_modules\expo-clipboard" set "NEEDS_INSTALL=1"
if not exist "node_modules\expo-location" set "NEEDS_INSTALL=1"
if not exist "node_modules\react-native-webview" set "NEEDS_INSTALL=1"

if "!NEEDS_INSTALL!"=="1" (
    echo  [..] Installiere Abhaengigkeiten...
    call npm install
    if not exist "node_modules\expo" (
        echo.
        echo  [FEHLER] npm install fehlgeschlagen!
        echo  Versuche: npm install --legacy-peer-deps
        echo.
        call npm install --legacy-peer-deps
        if not exist "node_modules\expo" (
            echo  [FEHLER] Installation fehlgeschlagen!
            pause
            exit /b 1
        )
    )
    echo  [OK] Abhaengigkeiten installiert
) else (
    echo  [OK] Abhaengigkeiten vorhanden
)

REM Netzwerk-Adapter auswaehlen
echo.
echo  ========================================
echo   Netzwerk-Adapter auswaehlen
echo  ========================================
echo.
echo  Dein PC hat mehrere Netzwerkanschluesse.
echo  Waehle den, ueber den dein Handy den PC
echo  erreichen kann (gleiches WLAN/Netzwerk).
echo.

set "TEMPFILE=%TEMP%\expo_ips.txt"
powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.InterfaceAlias -notmatch 'Loopback' } | Select-Object IPAddress,InterfaceAlias | ForEach-Object { $_.IPAddress + '|' + $_.InterfaceAlias } | Out-File -Encoding ascii '%TEMPFILE%'"

set "IP_COUNT=0"
for /f "tokens=1,2 delims=|" %%a in (%TEMPFILE%) do (
    set /a IP_COUNT+=1
    set "IP_!IP_COUNT!=%%a"
    set "NAME_!IP_COUNT!=%%b"
    echo   !IP_COUNT!^) %%a
    echo      ^(%%b^)
    echo.
)

set /a IP_COUNT+=1
echo   !IP_COUNT!^) Tunnel-Modus
echo      ^(Oeffentlicher Tunnel - funktioniert immer^)
echo.

set "CHOICE="
set /p "CHOICE=  Deine Wahl [1-!IP_COUNT!]: "

if "!CHOICE!"=="" set "CHOICE=1"

if "!CHOICE!"=="!IP_COUNT!" (
    echo.
    echo  [OK] Tunnel-Modus gewaehlt
    set "EXPO_ARGS=--tunnel"
    goto :start_server
)

call set "SELECTED_IP=%%IP_!CHOICE!%%"
call set "SELECTED_NAME=%%NAME_!CHOICE!%%"

if "!SELECTED_IP!"=="" (
    echo  [WARNUNG] Ungueltige Auswahl, verwende erste IP
    set "SELECTED_IP=!IP_1!"
    set "SELECTED_NAME=!NAME_1!"
)

echo.
echo  [OK] Verwende !SELECTED_IP! ^(!SELECTED_NAME!^)
set "REACT_NATIVE_PACKAGER_HOSTNAME=!SELECTED_IP!"
set "EXPO_ARGS="

:start_server
echo.
echo  ========================================
echo   So testest du die App:
echo  ========================================
echo.
echo   1. Installiere "Expo Go" auf deinem
echo      Handy (Google Play Store)
echo.
echo   2. PC und Handy muessen im selben
echo      WLAN/Netzwerk sein!
echo.
echo   3. Scanne den QR-Code unten mit der
echo      Handy-Kamera oder der Expo Go App
echo.
echo   4. Aenderungen am Code werden sofort
echo      auf dem Handy sichtbar (Live Reload)
echo.
echo  ========================================
echo   DEBUGGING bei Fehlern:
echo  ========================================
echo.
echo   Alle App-Logs erscheinen HIER in
echo   diesem Fenster! Achte auf rote
echo   Fehlermeldungen nach dem Start.
echo.
echo   Zum Beenden: Strg+C druecken
echo  ========================================
echo.

call npx expo start %EXPO_ARGS%

:DONE
echo.
pause
