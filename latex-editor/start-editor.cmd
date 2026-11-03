@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-editor.ps1" %*
set "editorExitCode=%ERRORLEVEL%"
if not "%editorExitCode%"=="0" pause
exit /b %editorExitCode%
