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

:: ── 7. APK bauen und automatisch herunterladen ──
echo.
echo  ========================================
echo   Starte APK Build in der Expo Cloud...
echo   (Das dauert ca. 5-15 Minuten)
echo   Die APK wird automatisch heruntergeladen.
echo  ========================================
echo.
echo   Beim ersten Mal wirst du gefragt ob ein
echo   Keystore generiert werden soll - waehle Yes.
echo.

:: Build starten mit --output fuer automatischen Download
call eas build -p android --profile preview --non-interactive --output "%APK_DEST%"
set BUILD_EXIT=%ERRORLEVEL%

:: Pruefen ob APK heruntergeladen wurde
if exist "%APK_DEST%" goto :BUILD_SUCCESS

:: Fallback: Wenn --output nicht geklappt hat, manuell herunterladen
echo.
echo  [..] APK nicht direkt heruntergeladen, versuche Fallback...
echo  [..] Suche Download-Link...

set "APK_URL="

:: Letzten erfolgreichen Build per JSON abfragen
for /f "usebackq tokens=*" %%a in (`eas build:list --platform android --limit 1 --status finished --json 2^>nul`) do (
    set "JSON_OUT=%%a"
)

:: URL aus JSON extrahieren (artifacts.buildUrl)
if defined JSON_OUT (
    for /f "tokens=*" %%u in ('powershell -Command "try { ($env:JSON_OUT | ConvertFrom-Json)[0].artifacts.buildUrl } catch { '' }" 2^>nul') do (
        if not "%%u"=="" set "APK_URL=%%u"
    )
)

if not defined APK_URL goto :NO_URL

:: APK herunterladen
echo  [OK] Download-Link gefunden
echo  [..] Lade APK herunter...
echo       %APK_URL%
echo.

curl -L -o "%APK_DEST%" "%APK_URL%" 2>nul
if exist "%APK_DEST%" goto :BUILD_SUCCESS

:: Powershell Fallback
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%APK_URL%' -OutFile '%APK_DEST%'" 2>nul
if exist "%APK_DEST%" goto :BUILD_SUCCESS
goto :DOWNLOAD_FAIL

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

:DOWNLOAD_FAIL
echo  [FEHLER] Download fehlgeschlagen.
echo  Bitte lade manuell herunter:
echo  %APK_URL%
echo  Speichere als: %APK_DEST%
goto :CLEANUP

:CLEANUP
echo.
pause
