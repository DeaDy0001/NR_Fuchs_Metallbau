#!/bin/bash
# ===========================================
# Fuchs Metallbau - APK Build Script
# ===========================================
# Baut die Android APK und kopiert sie in den
# Server-Ordner für den Download.
#
# Voraussetzungen:
#   1. Node.js >= 18
#   2. EAS CLI: npm install -g eas-cli
#   3. Expo Account: eas login
#
# Nutzung:
#   cd mobile-app
#   chmod +x build-apk.sh
#   ./build-apk.sh
# ===========================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

APK_DEST="$SCRIPT_DIR/android/app.apk"

echo "==========================================="
echo "  Fuchs Metallbau - APK Builder"
echo "==========================================="
echo ""

# Check if eas-cli is installed
if ! command -v eas &> /dev/null; then
  echo "EAS CLI ist nicht installiert."
  echo "Installiere mit: npm install -g eas-cli"
  echo ""
  read -p "Jetzt installieren? (j/n) " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Jj]$ ]]; then
    npm install -g eas-cli
  else
    echo "Abgebrochen."
    exit 1
  fi
fi

# Check if logged in
echo "Prüfe EAS Login..."
if ! eas whoami &> /dev/null 2>&1; then
  echo "Du bist nicht bei EAS eingeloggt."
  echo "Bitte logge dich ein:"
  eas login
fi

# Install dependencies
echo ""
echo "Installiere Abhängigkeiten..."
npm install

# Build APK locally or in the cloud
echo ""
echo "Wie soll die APK gebaut werden?"
echo "  1) Lokal bauen (benötigt Android SDK/Java)"
echo "  2) In der Cloud bauen (Expo Server, kein SDK nötig)"
echo ""
read -p "Auswahl (1/2): " -n 1 -r BUILD_CHOICE
echo ""

mkdir -p android

if [[ $BUILD_CHOICE == "1" ]]; then
  echo ""
  echo "Starte lokalen Build..."
  echo "(Dies kann 5-15 Minuten dauern)"
  echo ""

  # Local build outputs directly to a file
  eas build -p android --profile preview --local --output "$APK_DEST"

else
  echo ""
  echo "Starte Cloud Build..."
  echo "(Dies kann 5-20 Minuten dauern)"
  echo ""

  # Cloud build - need to download after
  BUILD_OUTPUT=$(eas build -p android --profile preview --non-interactive 2>&1)
  echo "$BUILD_OUTPUT"

  # Extract the download URL from build output
  APK_URL=$(echo "$BUILD_OUTPUT" | grep -oP 'https://expo\.dev/artifacts/eas/[^\s]+\.apk' || true)

  if [ -n "$APK_URL" ]; then
    echo ""
    echo "Lade APK herunter..."
    curl -L -o "$APK_DEST" "$APK_URL"
  else
    echo ""
    echo "APK URL konnte nicht automatisch erkannt werden."
    echo "Bitte lade die APK manuell von der Expo-Website herunter"
    echo "und kopiere sie nach: $APK_DEST"
    exit 1
  fi
fi

if [ -f "$APK_DEST" ]; then
  APK_SIZE=$(du -h "$APK_DEST" | cut -f1)
  echo ""
  echo "==========================================="
  echo "  APK erfolgreich gebaut!"
  echo "  Größe: $APK_SIZE"
  echo "  Pfad:  $APK_DEST"
  echo ""
  echo "  Die APK ist jetzt über die Software"
  echo "  unter Einstellungen > Handy App"
  echo "  herunterladbar."
  echo "==========================================="
else
  echo ""
  echo "Fehler: APK wurde nicht erstellt."
  exit 1
fi
