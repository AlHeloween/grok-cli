@echo off
setlocal enabledelayedexpansion

REM _build.cmd - Build and link grok-cli for Windows
REM This script installs dependencies, builds TypeScript, and links globally.

REM Change to script directory (so it works when called from elsewhere)
pushd "%~dp0"

if "%1"=="--help" goto help
if "%1"=="/?" goto help

echo.
echo [1/4] Checking for Bun...
where bun >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Bun not found in PATH.
    echo Install Bun from https://bun.sh
    goto cleanup_error
)
echo OK: Bun found.

echo.
echo [2/4] Installing dependencies...
bun install
if %errorlevel% neq 0 (
    echo ERROR: bun install failed.
    goto cleanup_error
)
echo OK: Dependencies installed.

echo.
echo [3/4] Building TypeScript...
bun run build
if %errorlevel% neq 0 (
    echo ERROR: bun run build failed.
    goto cleanup_error
)
echo OK: Build successful.

echo.
echo [4/4] Linking grok CLI globally...
bun link
if %errorlevel% neq 0 (
    echo ERROR: bun link failed.
    goto cleanup_error
)
echo OK: grok CLI linked globally.

echo.
echo SUCCESS: grok-cli built and linked.
echo Run "grok --help" to get started.
echo.
goto cleanup_success

:help
echo.
echo _build.cmd - Build and link grok-cli
echo.
echo Usage:
echo   _build.cmd [--help]
echo.
echo Steps performed:
echo   1. Check Bun is installed
echo   2. Install dependencies (bun install)
echo   3. Build TypeScript (bun run build)
echo   4. Link globally (bun link)
echo.
goto cleanup_success

:cleanup_error
popd
exit /b 1

:cleanup_success
popd
exit /b 0