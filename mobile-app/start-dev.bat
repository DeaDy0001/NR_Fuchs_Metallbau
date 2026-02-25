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

:: ── 3. Dev Server starten ──
echo.
echo  ========================================
echo   So testest du die App:
echo  ========================================
echo.
echo   1. Installiere "Expo Go" auf deinem
echo      Handy (Google Play Store)
echo.
echo   2. PC und Handy muessen im selben
echo      WLAN sein!
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

call npx expo start

pause
