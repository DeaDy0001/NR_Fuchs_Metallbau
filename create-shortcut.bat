@echo off
cd /d "%~dp0"
echo ========================================
echo   Desktop-Verknuepfung erstellen
echo   Fuchs Metallbau Server
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
        echo [WARNUNG] Icon-Konvertierung fehlgeschlagen, verwende Standard-Icon.
    )
) else (
    echo [1/2] Icon existiert bereits.
)
echo.

REM Step 2: Create desktop shortcut
echo [2/2] Erstelle Desktop-Verknuepfung...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$WshShell = New-Object -ComObject WScript.Shell; ^
    $desktop = $WshShell.SpecialFolders('Desktop'); ^
    $shortcut = $WshShell.CreateShortcut($desktop + '\Fuchs Metallbau Server.lnk'); ^
    $shortcut.TargetPath = '%~dp0start.bat'; ^
    $shortcut.WorkingDirectory = '%~dp0'; ^
    $shortcut.Description = 'Fuchs Metallbau - Lokaler Server starten'; ^
    $shortcut.WindowStyle = 1; ^
    $icoPath = '%~dp0frontend\public\NR_Logo.ico'; ^
    if (Test-Path $icoPath) { $shortcut.IconLocation = $icoPath + ',0' }; ^
    $shortcut.Save(); ^
    Write-Host '[OK] Verknuepfung erstellt auf dem Desktop: Fuchs Metallbau Server'"

echo.
echo ========================================
echo   Fertig!
echo   Auf dem Desktop liegt jetzt die
echo   Verknuepfung "Fuchs Metallbau Server"
echo   mit dem NR Logo als Icon.
echo ========================================
echo.
pause
