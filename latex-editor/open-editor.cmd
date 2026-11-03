@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\Users\Jason\Documents\GitHub\Solar-System\latex-editor\start-editor.ps1" -ProjectFolder "%~dp0."
set "editorExitCode=%ERRORLEVEL%"
if not "%editorExitCode%"=="0" pause
exit /b %editorExitCode%
