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

:: ── 2. Abhaengigkeiten installieren ──
if not exist node_modules (
    echo  [..] Installiere Abhaengigkeiten...
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo  [FEHLER] npm install fehlgeschlagen!
        pause
        exit /b 1
    )
    echo  [OK] Abhaengigkeiten installiert
) else (
    echo  [OK] Abhaengigkeiten vorhanden
)

:: ── 3. Netzwerk-Adapter auswaehlen ──
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

:: ── 4. Dev Server starten ──
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
