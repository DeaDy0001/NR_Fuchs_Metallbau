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

:: Collect all IPv4 addresses
set "IP_COUNT=0"

:: Use PowerShell to get clean IP list with adapter names
for /f "tokens=1,* delims=|" %%a in ('powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.InterfaceAlias -notmatch 'Loopback' } | ForEach-Object { $_.IPAddress + '|' + $_.InterfaceAlias }"') do (
    set /a IP_COUNT+=1
    set "IP_!IP_COUNT!=%%a"
    set "NAME_!IP_COUNT!=%%b"
    echo   !IP_COUNT!^) %%a
    echo      ^(%%b^)
    echo.
)

if !IP_COUNT! equ 0 (
    echo  [WARNUNG] Keine Netzwerk-IPs gefunden!
    echo  Starte trotzdem mit Standard-IP...
    echo.
    goto :start_server
)

:: Add tunnel option
set /a IP_COUNT+=1
set "IP_!IP_COUNT!=tunnel"
set "NAME_!IP_COUNT!=Oeffentlicher Tunnel (wenn nichts anderes geht)"
echo   !IP_COUNT!^) Tunnel-Modus
echo      ^(Oeffentlicher Tunnel - funktioniert immer^)
echo.

:: User selection
set "CHOICE=0"
set /p "CHOICE=  Deine Wahl [1-!IP_COUNT!]: "

:: Validate input
if "!CHOICE!"=="" (
    echo  Keine Auswahl - verwende erste IP
    set "CHOICE=1"
)
if !CHOICE! lss 1 set "CHOICE=1"
if !CHOICE! gtr !IP_COUNT! set "CHOICE=!IP_COUNT!"

set "SELECTED_IP=!IP_!CHOICE!!"
set "SELECTED_NAME=!NAME_!CHOICE!!"

echo.
if "!SELECTED_IP!"=="tunnel" (
    echo  [OK] Tunnel-Modus gewaehlt
    set "EXPO_EXTRA_ARGS=--tunnel"
) else (
    echo  [OK] Verwende !SELECTED_IP! ^(!SELECTED_NAME!^)
    set "REACT_NATIVE_PACKAGER_HOSTNAME=!SELECTED_IP!"
    set "EXPO_EXTRA_ARGS="
)

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
echo   - In diesem Fenster siehst du Logs
echo     vom Metro Bundler (Build-Fehler)
echo.
echo   - Handy schuetteln = Dev-Menu oeffnen
echo     dort "Debug Remote JS" waehlen
echo.
echo   - Taste 'j' druecken = Chrome Debugger
echo     (zeigt console.log im Browser)
echo.
echo   Zum Beenden: Strg+C druecken
echo  ========================================
echo.

call npx expo start %EXPO_EXTRA_ARGS%

pause
