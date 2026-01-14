#!/bin/bash
#
# start_autonomous.sh - Startet Gemini CLI im vollautonomen Modus
#
# Flags erkannt:
#   --yolo                    Automatisch alle Aktionen akzeptieren
#   --approval-mode yolo      Gleicher Effekt
#   --allowed-tools           Spezifische Tools ohne Bestätigung
#

set -e

# Farben
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== Gemini Autonomous Mode ===${NC}"
echo ""

# Prüfe ob gemini installiert ist
if ! command -v gemini &> /dev/null; then
    echo -e "${YELLOW}ERROR: gemini CLI nicht gefunden${NC}"
    echo "Installation: npm install -g @anthropic-ai/gemini-cli"
    exit 1
fi

# Verfügbare Modi
echo "Verfügbare Startmodi:"
echo "  1) YOLO Mode (--yolo) - Alle Tools auto-approved"
echo "  2) Auto-Edit Mode (--approval-mode auto_edit) - Nur Edit-Tools auto-approved"
echo "  3) Specific Tool (--allowed-tools delegate_coding_task)"
echo ""

# Standard: YOLO Mode mit delegate_coding_task explizit erlaubt
echo -e "${GREEN}Starte Gemini mit: --yolo --allowed-tools delegate_coding_task${NC}"
echo ""

exec gemini --yolo --allowed-tools delegate_coding_task "$@"
