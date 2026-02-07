@echo off
title ODP+ Installer

:: ============================================
::  ODP+ One-Click Installer for Windows
::  Just double-click this file to get started!
:: ============================================

echo.
echo  ===================================================
echo            ODP+ Easy Installer
echo       Dance with friends online!
echo  ===================================================
echo.

:: ============================================
::  STEP 1: Check for Node.js
:: ============================================
echo  [Step 1/3] Checking if Node.js is installed...
echo.

:: Simple approach: just try to run node and see what version we get
for /f "tokens=*" %%v in ('node -v 2^>nul') do set "NODE_VERSION=%%v"

if not defined NODE_VERSION (
    echo  [X] Node.js is NOT installed or not in PATH.
    echo.
    echo  Please install Node.js from: https://nodejs.org/
    echo  After installing, restart your terminal and run this again.
    echo.
    pause
    exit /b 1
)

echo  [OK] Node.js found: %NODE_VERSION%
echo.

:: ============================================
::  STEP 2: Install dependencies
:: ============================================
echo  [Step 2/3] Installing dependencies...
echo      (This may take a minute on first run)
echo.

call npm install
if errorlevel 1 (
    echo.
    echo  [X] Failed to install dependencies.
    echo      Please check your internet connection and try again.
    pause
    exit /b 1
)
echo.
echo  [OK] Dependencies installed!
echo.

:: ============================================
::  STEP 3: Build the extension
:: ============================================
echo  [Step 3/3] Building ODP+ extension...
echo.

call npm run build
if errorlevel 1 (
    echo.
    echo  [X] Build failed. Please report this issue.
    pause
    exit /b 1
)
echo.
echo  [OK] Build complete!
echo.

:: ============================================
::  SUCCESS!
:: ============================================
echo.
echo  ===================================================
echo           SUCCESS! ODP+ is ready!
echo  ===================================================
echo.
echo  Now add the extension to your browser:
echo.
echo  For Chrome/Edge/Brave:
echo    1. Open chrome://extensions (or edge://extensions)
echo    2. Turn ON "Developer mode" (top right)
echo    3. Click "Load unpacked"
echo    4. Select the "dist" folder that just opened
echo.
echo  For Firefox:
echo    1. Open about:debugging#/runtime/this-firefox
echo    2. Click "Load Temporary Add-on"
echo    3. Select "manifest.json" inside the "dist" folder
echo.

:: Open the dist folder
start "" "%~dp0dist"

echo  Press any key to close this window...
pause >nul
