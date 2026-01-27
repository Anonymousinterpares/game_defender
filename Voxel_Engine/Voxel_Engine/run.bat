@echo off
SETLOCAL

:: Check if Node.js is installed
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js is not installed! Please install it from https://nodejs.org/
    pause
    exit /b 1
)

:: Check if node_modules exists
if not exist "node_modules\" (
    echo node_modules not found. Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo Failed to install dependencies!
        pause
        exit /b 1
    )
)

:: Start the development server and open in browser
echo Starting Voxel Engine...
call npm run dev -- --open

if %errorlevel% neq 0 (
    echo Failed to start the server!
    pause
    exit /b 1
)

ENDLOCAL
