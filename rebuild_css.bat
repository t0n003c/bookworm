@echo off
REM ── BookWorm: Rebuild Tailwind CSS ─────────────────────────────────────────
REM Run this any time you add new Tailwind classes in templates/ or static/js/
REM Output: static/css/tailwind.css  (commit this file)
REM
REM Requirements: tailwindcss.exe must exist in the project root.
REM Download it once from:
REM   https://generic.ci.artifacts.walmart.com/artifactory/github-releases-generic-release-remote/tailwindlabs/tailwindcss/releases/download/v3.4.17/tailwindcss-windows-x64.exe
REM   (rename the download to tailwindcss.exe)

if not exist tailwindcss.exe (
    echo [ERROR] tailwindcss.exe not found in project root.
    echo Download from Walmart Artifactory ^(see comment at top of this file^).
    exit /b 1
)

echo [1/1] Building Tailwind CSS...
tailwindcss.exe -c tailwind.config.js -i static\css\input.css -o static\css\tailwind.css --minify

if %ERRORLEVEL% neq 0 (
    echo [ERROR] Tailwind build failed.
    exit /b 1
)

echo.
echo Done! Commit static/css/tailwind.css with your next change.
