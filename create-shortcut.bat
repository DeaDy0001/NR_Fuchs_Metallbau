@echo off
cd /d "%~dp0"
echo ========================================
echo   Fuchs Metallbau - Browser-Shortcut
echo   erstellen
echo ========================================
echo.

REM Step 1: Convert PNG to ICO if needed
if not exist "frontend\public\NR_Logo.ico" (
    echo [1/2] Erstelle Icon aus NR_Logo.png...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "Add-Type -AssemblyName System.Drawing; ^
        $img = [System.Drawing.Image]::FromFile('%~dp0frontend\public\NR_Logo.png'); ^
        $bmp = New-Object System.Drawing.Bitmap($img, 256, 256); ^
        $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon()); ^
        $stream = [System.IO.File]::Create('%~dp0frontend\public\NR_Logo.ico'); ^
        $icon.Save($stream); ^
        $stream.Close(); ^
        $icon.Dispose(); ^
        $bmp.Dispose(); ^
        $img.Dispose(); ^
        Write-Host '[OK] Icon erstellt: frontend\public\NR_Logo.ico'"
    if %ERRORLEVEL% NEQ 0 (
        echo [WARNUNG] Icon-Konvertierung fehlgeschlagen, Shortcut wird ohne Icon erstellt.
    )
) else (
    echo [1/2] Icon existiert bereits.
)
echo.

REM Step 2: Create "Fuchs Metallbau.url" in project root
echo [2/2] Erstelle Browser-Verknuepfung...

set "ICO_PATH=%~dp0frontend\public\NR_Logo.ico"

(
echo [InternetShortcut]
echo URL=http://localhost:3001
echo IconFile=%ICO_PATH%
echo IconIndex=0
) > "%~dp0Fuchs Metallbau.url"

echo.
echo [OK] "Fuchs Metallbau.url" wurde im Projektordner erstellt.

REM Step 3: Also create on desktop
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$desktop = [Environment]::GetFolderPath('Desktop'); ^
    $content = @\"`r`n[InternetShortcut]`r`nURL=http://localhost:3001`r`nIconFile=%ICO_PATH%`r`nIconIndex=0`r`n\"@; ^
    Set-Content -Path (Join-Path $desktop 'Fuchs Metallbau.url') -Value $content -Encoding ASCII; ^
    Write-Host '[OK] Auch auf dem Desktop erstellt: Fuchs Metallbau.url'"

echo.
echo ========================================
echo   Fertig!
echo.
echo   Doppelklick auf "Fuchs Metallbau.url"
echo   oeffnet die App im Browser.
echo.
echo   WICHTIG: Der Server muss laufen!
echo   ^(Zuerst start.bat ausfuehren^)
echo ========================================
echo.
pause
