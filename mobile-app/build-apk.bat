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
goto :INSTALL_DEPS

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
goto :INSTALL_DEPS

:LOGIN_FAIL
echo  [FEHLER] Login fehlgeschlagen. Bitte versuche es erneut.
pause
exit /b 1

:: ── 4. Dependencies installieren ──
:INSTALL_DEPS
echo.
echo  [..] Installiere Abhaengigkeiten...
call npm install --silent 2>nul
echo  [OK] Abhaengigkeiten installiert

:: ── 5. Output-Ordner ──
if not exist android mkdir android

:: ── 6. APK bauen ──
echo.
echo  ========================================
echo   Starte APK Build in der Expo Cloud...
echo   (Das dauert ca. 5-15 Minuten)
echo  ========================================
echo.

set "BUILD_LOG=%TEMP%\eas-build-output.txt"

:: Build starten und Output in Datei + auf Bildschirm zeigen
call eas build -p android --profile preview --non-interactive > "%BUILD_LOG%" 2>&1
set BUILD_EXIT=%ERRORLEVEL%

:: Output anzeigen
type "%BUILD_LOG%"

if %BUILD_EXIT% neq 0 goto :BUILD_FAILED

:: ── 7. Download-Link finden ──
echo.
echo  [..] Suche Download-Link...

set "APK_URL="

:: Suche nach expo.dev artifact URL im Log
for /f "usebackq tokens=*" %%a in ("%BUILD_LOG%") do (
    set "LINE=%%a"
    echo !LINE! | findstr /i "https://expo.dev/artifacts" >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        for %%w in (%%a) do (
            echo %%w | findstr /i "https://" >nul 2>&1
            if !ERRORLEVEL! equ 0 set "APK_URL=%%w"
        )
    )
)

set "APK_DEST=%CD%\android\app.apk"

if not defined APK_URL goto :NO_URL

:: ── 8. APK herunterladen ──
echo  [OK] Download-Link gefunden
echo  [..] Lade APK herunter...
echo       %APK_URL%
echo.

:: curl ist auf Windows 10/11 vorinstalliert
curl -L -o "%APK_DEST%" "%APK_URL%" 2>nul
if %ERRORLEVEL% neq 0 (
    :: Fallback: PowerShell
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%APK_URL%' -OutFile '%APK_DEST%'" 2>nul
)

if not exist "%APK_DEST%" goto :DOWNLOAD_FAIL

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
goto :CLEANUP

:BUILD_FAILED
echo.
echo  [FEHLER] Build fehlgeschlagen!
echo  Pruefe die Ausgabe oben fuer Details.
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

:DOWNLOAD_FAIL
echo  [FEHLER] Download fehlgeschlagen.
echo  Bitte lade manuell herunter:
echo  %APK_URL%
echo  Speichere als: %APK_DEST%
goto :CLEANUP

:CLEANUP
if exist "%BUILD_LOG%" del "%BUILD_LOG%" >nul 2>&1
echo.
pause
