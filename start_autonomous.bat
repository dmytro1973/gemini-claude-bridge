@echo off
REM start_autonomous.bat - Startet Gemini CLI im vollautonomen Modus
REM
REM Verwendung:
REM   start_autonomous.bat
REM   start_autonomous.bat "Deine Aufgabe"

echo === Gemini Autonomous Mode ===
echo.
echo Flags: --yolo --allowed-tools delegate_coding_task
echo.

gemini --yolo --allowed-tools delegate_coding_task %*
