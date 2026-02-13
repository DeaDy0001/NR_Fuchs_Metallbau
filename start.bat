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
    pause
    exit /b 1
)

echo [INFO] Node.js gefunden:
node --version
echo.

REM Install backend dependencies
echo [1/5] Installiere Backend Dependencies...
cd backend
if not exist node_modules (
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Backend Installation fehlgeschlagen!
        pause
        exit /b 1
    )
) else (
    echo [INFO] Backend Dependencies bereits installiert
)
cd ..
echo.

REM Install frontend dependencies
echo [2/5] Installiere Frontend Dependencies...
cd frontend
if not exist node_modules (
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Frontend Installation fehlgeschlagen!
        pause
        exit /b 1
    )
) else (
    echo [INFO] Frontend Dependencies bereits installiert
)
cd ..
echo.

REM Initialize database
echo [3/5] Initialisiere SQLite Datenbank...
cd backend
call node src/utils/initDatabase.js
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Datenbank-Initialisierung fehlgeschlagen!
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
echo
echo   Drücke STRG+C zum Beenden
echo ========================================
echo.

cd backend
call npm start

pause
