@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Fuchs Metallbau - APK Builder

echo.
echo  ╔═══════════════════════════════════════════╗
echo  ║     Fuchs Metallbau - APK Builder         ║
echo  ╚═══════════════════════════════════════════╝
echo.

:: ─────────────────────────────────────────────
:: 1. Prüfe ob Node.js installiert ist
:: ─────────────────────────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [FEHLER] Node.js ist nicht installiert!
    echo  Bitte installiere Node.js von: https://nodejs.org
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo  [OK] Node.js %NODE_VERSION% gefunden

:: ─────────────────────────────────────────────
:: 2. Prüfe/Installiere EAS CLI
:: ─────────────────────────────────────────────
where eas >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [..] EAS CLI wird installiert...
    call npm install -g eas-cli >nul 2>&1
    where eas >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo  [FEHLER] EAS CLI konnte nicht installiert werden.
        pause
        exit /b 1
    )
)
for /f "tokens=*" %%i in ('eas --version 2^>nul') do set EAS_VERSION=%%i
echo  [OK] EAS CLI %EAS_VERSION% gefunden

:: ─────────────────────────────────────────────
:: 3. Prüfe EAS Login
:: ─────────────────────────────────────────────
echo.
echo  Pruefe Expo Login...
eas whoami >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo.
    echo  Du musst dich bei Expo einloggen.
    echo  Falls du noch keinen Account hast: https://expo.dev/signup
    echo.
    call eas login
    echo.
    eas whoami >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo  [FEHLER] Login fehlgeschlagen.
        pause
        exit /b 1
    )
)
for /f "tokens=*" %%i in ('eas whoami 2^>nul') do set EAS_USER=%%i
echo  [OK] Eingeloggt als: %EAS_USER%

:: ─────────────────────────────────────────────
:: 4. Dependencies installieren
:: ─────────────────────────────────────────────
echo.
echo  [..] Installiere Abhaengigkeiten...
call npm install --silent 2>nul
echo  [OK] Abhaengigkeiten installiert

:: ─────────────────────────────────────────────
:: 5. Output-Ordner erstellen
:: ─────────────────────────────────────────────
if not exist android mkdir android

:: ─────────────────────────────────────────────
:: 6. APK bauen
:: ─────────────────────────────────────────────
echo.
echo  ═══════════════════════════════════════════
echo   Starte APK Build...
echo   (Das dauert ca. 5-15 Minuten)
echo  ═══════════════════════════════════════════
echo.

:: Baue die APK und fange den Output ab um die URL zu finden
set "BUILD_LOG=%TEMP%\eas-build-log.txt"
call eas build -p android --profile preview --non-interactive 2>&1 | tee %BUILD_LOG% 2>nul
if not exist "%BUILD_LOG%" (
    call eas build -p android --profile preview --non-interactive > "%BUILD_LOG%" 2>&1
    type "%BUILD_LOG%"
)

:: ─────────────────────────────────────────────
:: 7. APK Download-Link suchen und herunterladen
:: ─────────────────────────────────────────────
echo.
echo  [..] Suche Download-Link...

:: Suche nach der Artifact-URL im Build-Log
set "APK_URL="
for /f "tokens=*" %%a in ('findstr /i "expo.dev/artifacts" "%BUILD_LOG%" 2^>nul') do (
    set "LINE=%%a"
    for %%u in (!LINE!) do (
        echo %%u | findstr /i "https://expo.dev/artifacts" >nul 2>&1
        if !ERRORLEVEL! equ 0 set "APK_URL=%%u"
    )
)

if not defined APK_URL (
    :: Alternativ: versuche über eas build:list den letzten Build zu finden
    echo  [..] Versuche letzten Build zu finden...
    for /f "tokens=*" %%a in ('eas build:list --platform android --limit 1 --non-interactive --json 2^>nul') do (
        set "BUILD_JSON=%%a"
    )
)

set "APK_DEST=%CD%\android\app.apk"

if defined APK_URL (
    echo  [OK] Download-Link gefunden
    echo  [..] Lade APK herunter...

    :: Versuche mit curl
    where curl >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        curl -L -o "%APK_DEST%" "%APK_URL%" 2>nul
    ) else (
        :: Fallback: PowerShell
        powershell -Command "Invoke-WebRequest -Uri '%APK_URL%' -OutFile '%APK_DEST%'" 2>nul
    )

    if exist "%APK_DEST%" (
        for %%F in ("%APK_DEST%") do set "APK_SIZE=%%~zF"
        set /a APK_MB=!APK_SIZE! / 1048576
        echo.
        echo  ╔═══════════════════════════════════════════╗
        echo  ║          APK erfolgreich erstellt!         ║
        echo  ╚═══════════════════════════════════════════╝
        echo.
        echo  Datei:    %APK_DEST%
        echo  Groesse:  ca. !APK_MB! MB
        echo.
        echo  Die APK ist jetzt ueber die Desktop-Software
        echo  verfuegbar: Einstellungen ^> Handy App
        echo.
        echo  Oder direkt auf dem Handy oeffnen:
        echo  QR-Code scannen ^> APK herunterladen
        echo.
    ) else (
        echo  [FEHLER] APK konnte nicht heruntergeladen werden.
        echo  Bitte lade sie manuell herunter:
        echo  %APK_URL%
        echo.
        echo  Und speichere sie als:
        echo  %APK_DEST%
        echo.
    )
) else (
    echo.
    echo  ══════════════════════════════════════════════
    echo   APK-URL konnte nicht automatisch erkannt
    echo   werden. Bitte mache folgendes:
    echo.
    echo   1. Gehe zu https://expo.dev
    echo   2. Oeffne dein Projekt "fuchs-metallbau"
    echo   3. Klicke auf den letzten Build
    echo   4. Lade die APK herunter
    echo   5. Speichere sie als:
    echo      %APK_DEST%
    echo  ══════════════════════════════════════════════
    echo.
)

:: Aufräumen
if exist "%BUILD_LOG%" del "%BUILD_LOG%" >nul 2>&1

pause
