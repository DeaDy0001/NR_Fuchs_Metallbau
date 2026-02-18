@echo off
echo ========================================
echo   Fuchs Metallbau - Server Start
echo ========================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js ist nicht installiert!
    echo Bitte installieren Sie Node.js von: https://nodejs.org/
    echo Waehlen Sie bei der Installation "Automatically install the necessary tools" aus!
    pause
    exit /b 1
)

echo [INFO] Node.js gefunden:
node --version
echo.

REM Check if native build tools are needed (for better-sqlite3)
REM Only check if node_modules doesn't exist yet (first install)
if not exist "backend\node_modules\better-sqlite3\build" (
    echo [INFO] Pruefe Build-Tools fuer native Module...

    REM Check if Python is available
    where python >nul 2>nul
    if %ERRORLEVEL% NEQ 0 (
        where python3 >nul 2>nul
        if %ERRORLEVEL% NEQ 0 (
            echo.
            echo [WARNUNG] Python wurde nicht gefunden!
            echo           Python wird fuer native Module (better-sqlite3) benoetigt.
            echo.
            echo           Automatische Installation wird versucht...
            echo           (Erfordert Administrator-Rechte)
            echo.

            REM Try to install windows-build-tools via npm (includes Python)
            echo [INFO] Installiere Windows Build Tools (Python + C++ Compiler)...
            echo        Dies kann einige Minuten dauern...
            echo.
            call npm install --global windows-build-tools 2>nul
            if %ERRORLEVEL% NEQ 0 (
                echo.
                echo [INFO] Automatische Installation fehlgeschlagen.
                echo        Bitte installiere die Build-Tools manuell:
                echo.
                echo   OPTION 1 - Node.js neu installieren:
                echo     1. Deinstalliere Node.js
                echo     2. Installiere Node.js v22 LTS von https://nodejs.org/
                echo     3. WICHTIG: Setze den Haken bei
                echo        "Automatically install the necessary tools"
                echo     4. Starte dieses Script erneut
                echo.
                echo   OPTION 2 - Visual Studio Build Tools:
                echo     1. Lade herunter: https://visualstudio.microsoft.com/visual-cpp-build-tools/
                echo     2. Installiere "Desktop development with C++"
                echo     3. Installiere Python 3 von https://www.python.org/downloads/
                echo     4. Starte dieses Script erneut
                echo.
                pause
                exit /b 1
            )
        )
    )
    echo [OK] Build-Tools verfuegbar.
    echo.
)

REM Install backend dependencies
echo [1/5] Installiere/Aktualisiere Backend Dependencies...
cd backend
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Backend Installation fehlgeschlagen!
    echo.
    echo   Dies liegt vermutlich an fehlenden Build-Tools fuer better-sqlite3.
    echo.
    echo   LOESUNG - Node.js neu installieren mit Build-Tools:
    echo     1. Deinstalliere die aktuelle Node.js Version
    echo     2. Lade Node.js LTS herunter: https://nodejs.org/
    echo     3. Bei der Installation: Setze den Haken bei
    echo        "Automatically install the necessary tools"
    echo     4. Nach der Installation: PC neu starten
    echo     5. Starte dieses Script erneut
    echo.
    cd ..
    pause
    exit /b 1
)
cd ..
echo.

REM Install frontend dependencies
echo [2/5] Installiere/Aktualisiere Frontend Dependencies...
cd frontend
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Frontend Installation fehlgeschlagen!
    cd ..
    pause
    exit /b 1
)
cd ..
echo.

REM Initialize database
echo [3/5] Initialisiere SQLite Datenbank...
cd backend
call node src/utils/initDatabase.js
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Datenbank-Initialisierung fehlgeschlagen!
    cd ..
    pause
    exit /b 1
)
cd ..
echo.

REM Build frontend
echo [4/5] Baue Frontend...
cd frontend
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Frontend Build fehlgeschlagen!
    cd ..
    pause
    exit /b 1
)
cd ..
echo.

REM Start backend server
echo [5/5] Starte Server...
echo.
echo ========================================
echo   Server startet...
echo   Erreichbar unter: http://localhost:3001
echo.
echo   Druecke STRG+C zum Beenden
echo ========================================
echo.

cd backend
call npm start

pause
