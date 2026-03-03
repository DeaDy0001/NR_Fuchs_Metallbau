@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Fuchs Metallbau - Entwicklungsserver

echo.
echo  ========================================
echo    Fuchs Metallbau - Dev Server
echo  ========================================
echo.

:: ── 1. Node.js pruefen ──
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [FEHLER] Node.js ist nicht installiert!
    echo  Download: https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo  [OK] Node.js %NODE_VER%

:: ── 2. Startmodus auswaehlen ──
echo.
echo  ========================================
echo   Wie moechtest du entwickeln?
echo  ========================================
echo.
echo   1) Expo Go (Handy)
echo      App auf dem Handy testen via QR-Code
echo.
echo   2) Lokal (WSL)
echo      Dev-Server in WSL starten
echo      (fuer lokale Builds / Linux-Umgebung)
echo.
set "DEV_CHOICE="
set /p "DEV_CHOICE=  Deine Wahl [1/2]: "

if "!DEV_CHOICE!"=="2" goto :START_WSL
goto :START_EXPO

:: ══════════════════════════════════════════
::  Option 2: Lokal via WSL
:: ══════════════════════════════════════════
:START_WSL
echo.
echo  Pruefe WSL...

:: Check ob WSL installiert ist
where wsl >nul 2>&1
if %ERRORLEVEL% neq 0 (
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
    echo  [INFO] Ohne WSL wird Expo Go gestartet.
    goto :START_EXPO
)
echo  [OK] WSL vorhanden

:: WSL path ermitteln
for /f "tokens=*" %%p in ('wsl wslpath -u "%CD%"') do set "WSL_PATH=%%p"

:: Check Node.js in WSL
wsl bash -c "command -v node" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo.
    echo  [FEHLER] Node.js fehlt in WSL!
    echo.
    echo  Soll Node.js in WSL installiert werden?
    set "INSTALL_NODE="
    set /p "INSTALL_NODE=  Installieren? [j/n]: "
    if /i "!INSTALL_NODE!"=="j" (
        echo.
        echo  [..] Installiere Node.js in WSL...
        wsl bash -c "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
        wsl bash -c "command -v node" >nul 2>&1
        if %ERRORLEVEL% neq 0 (
            echo  [FEHLER] Installation fehlgeschlagen.
            echo  Bitte manuell in WSL installieren.
            pause
            exit /b 1
        )
        echo  [OK] Node.js installiert
    ) else (
        echo.
        echo  [INFO] Ohne Node.js in WSL wird Expo Go gestartet.
        goto :START_EXPO
    )
)
for /f "tokens=*" %%v in ('wsl bash -c "node -v"') do echo  [OK] Node.js in WSL: %%v

:: Abhaengigkeiten in WSL installieren + Dev Server starten
echo.
echo  ========================================
echo   Starte Dev Server via WSL...
echo  ========================================
echo.
echo   Aenderungen am Code werden sofort
echo   auf dem Handy sichtbar (Live Reload)
echo.
echo   Zum Beenden: Strg+C druecken
echo  ========================================
echo.

wsl bash -c "cd '!WSL_PATH!' && npm install --silent 2>/dev/null && npx expo start"

pause
exit /b 0

:: ══════════════════════════════════════════
::  Option 1: Expo Go (Handy)
:: ══════════════════════════════════════════
:START_EXPO

:: ── Abhaengigkeiten installieren ──
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

:: ── Netzwerk-Adapter auswaehlen ──
echo.
echo  ========================================
echo   Netzwerk-Adapter auswaehlen
echo  ========================================
echo.
echo  Dein PC hat mehrere Netzwerkanschluesse.
echo  Waehle den, ueber den dein Handy den PC
echo  erreichen kann (gleiches WLAN/Netzwerk).
echo.

:: Use a temp file to collect IPs (avoids nested variable issues)
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

:: Add tunnel option
set /a IP_COUNT+=1
echo   !IP_COUNT!^) Tunnel-Modus
echo      ^(Oeffentlicher Tunnel - funktioniert immer^)
echo.

:: User selection
set "CHOICE="
set /p "CHOICE=  Deine Wahl [1-!IP_COUNT!]: "

if "!CHOICE!"=="" set "CHOICE=1"

:: Check if tunnel was selected
if "!CHOICE!"=="!IP_COUNT!" (
    echo.
    echo  [OK] Tunnel-Modus gewaehlt
    set "EXPO_ARGS=--tunnel"
    goto :start_server
)

:: Get selected IP using call trick for nested variables
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

:: ── Dev Server starten ──
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

pause
