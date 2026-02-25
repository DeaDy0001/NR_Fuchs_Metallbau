@echo off
chcp 65001 >nul
echo ===========================================
echo   Fuchs Metallbau - APK Builder
echo ===========================================
echo.

:: Check if eas-cli is installed
where eas >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo EAS CLI ist nicht installiert.
    echo Installiere mit: npm install -g eas-cli
    echo.
    set /p INSTALL="Jetzt installieren? (j/n): "
    if /i "%INSTALL%"=="j" (
        npm install -g eas-cli
    ) else (
        echo Abgebrochen.
        exit /b 1
    )
)

:: Check if logged in
echo Pruefe EAS Login...
eas whoami >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Du bist nicht bei EAS eingeloggt.
    echo Bitte logge dich ein:
    eas login
)

:: Install dependencies
echo.
echo Installiere Abhaengigkeiten...
call npm install

:: Create android directory
if not exist android mkdir android

:: Build APK in the cloud
echo.
echo Starte Cloud Build...
echo (Dies kann 5-20 Minuten dauern)
echo.
echo Nach dem Build wird ein Download-Link angezeigt.
echo Lade die APK herunter und kopiere sie nach:
echo   %CD%\android\app.apk
echo.
echo Dann ist die APK ueber die Desktop-Software
echo unter Einstellungen ^> Handy App herunterladbar.
echo.

eas build -p android --profile preview

echo.
echo ===========================================
echo   WICHTIG: Lade die APK vom angezeigten
echo   Link herunter und speichere sie als:
echo   %CD%\android\app.apk
echo ===========================================
pause
