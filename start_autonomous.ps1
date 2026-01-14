#
# start_autonomous.ps1 - Startet Gemini CLI im vollautonomen Modus (Windows)
#
# Verwendung:
#   .\start_autonomous.ps1
#   .\start_autonomous.ps1 "Deine Aufgabe hier"
#

param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$Args
)

Write-Host "=== Gemini Autonomous Mode ===" -ForegroundColor Green
Write-Host ""

# Prüfe ob gemini installiert ist
$geminiPath = Get-Command gemini -ErrorAction SilentlyContinue
if (-not $geminiPath) {
    Write-Host "ERROR: gemini CLI nicht gefunden" -ForegroundColor Red
    Write-Host "Installation: npm install -g @google/gemini-cli"
    exit 1
}

Write-Host "Flags:" -ForegroundColor Yellow
Write-Host "  --yolo                 = Alle Tools auto-approved"
Write-Host "  --allowed-tools        = Spezifische Tools erlauben"
Write-Host ""
Write-Host "Starte Gemini mit: --yolo --allowed-tools delegate_coding_task" -ForegroundColor Green
Write-Host ""

# Starte Gemini im YOLO-Modus
& gemini --yolo --allowed-tools delegate_coding_task @Args
