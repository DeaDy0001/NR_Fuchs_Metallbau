# 🔐 Google OAuth Setup Anleitung

Diese Anleitung erklärt, wie du die Google OAuth Integration für die Fuchs Metallbau App einrichtest.

## ✨ Warum OAuth?

Mit Google OAuth kannst du:
- ✅ **Einfach anmelden** - Nur ein Klick auf "Mit Google anmelden"
- ✅ **Dauerhaft eingeloggt bleiben** - Keine wiederholte Authentifizierung nötig
- ✅ **Dateien löschen** - Automatisches Löschen aus Drive nach Sync funktioniert!
- ✅ **Sicher** - Kein API Key nötig, OAuth ist sicherer

---

## 📋 Setup Schritte (ca. 5 Minuten)

### Schritt 1: Google Cloud Console öffnen

1. Gehe zu: https://console.cloud.google.com/
2. Melde dich mit deinem Google-Konto an

---

### Schritt 2: Neues Projekt erstellen (falls nötig)

1. Klicke oben links auf den Projekt-Dropdown
2. Klicke auf **"Neues Projekt"**
3. Name: `Fuchs Metallbau App` (oder beliebig)
4. Klicke **"Erstellen"**
5. Warte, bis das Projekt erstellt ist (~30 Sekunden)

---

### Schritt 3: Google Drive API aktivieren

1. Im Hauptmenü (☰) → **"APIs & Dienste"** → **"Aktivierte APIs & Dienste"**
2. Klicke **"+ APIs und Dienste aktivieren"**
3. Suche nach: **"Google Drive API"**
4. Klicke auf **"Google Drive API"**
5. Klicke **"Aktivieren"**

---

### Schritt 4: OAuth Zustimmungsbildschirm konfigurieren

1. Im Seitenmenü → **"OAuth-Zustimmungsbildschirm"**
2. Wähle **"Extern"** (für persönliche Nutzung)
3. Klicke **"Erstellen"**

**Schritt 4.1 - App-Informationen:**
- **App-Name:** `Fuchs Metallbau App`
- **Nutzer-Support-E-Mail:** Deine E-Mail-Adresse
- **E-Mail für Entwickler-Kontakt:** Deine E-Mail-Adresse
- Klicke **"Speichern und fortfahren"**

**Schritt 4.2 - Bereiche (Scopes):**
- Klicke **"Bereiche hinzufügen oder entfernen"**
- Suche nach: `drive` oder scrolle zu **"Google Drive API"**
- Wähle folgende Bereiche:
  - ✅ `.../auth/drive` (Vollzugriff auf Drive)
  - ✅ `.../auth/drive.file` (Dateien verwalten)
- Klicke **"Aktualisieren"**
- Klicke **"Speichern und fortfahren"**

**Schritt 4.3 - Testnutzer:**
- Klicke **"+ Nutzer hinzufügen"**
- Gib deine Google E-Mail-Adresse ein (das Konto, mit dem du dich anmelden willst)
- Klicke **"Hinzufügen"**
- Klicke **"Speichern und fortfahren"**

**Schritt 4.4 - Zusammenfassung:**
- Überprüfe die Einstellungen
- Klicke **"Zurück zum Dashboard"**

---

### Schritt 5: OAuth 2.0 Client ID erstellen

1. Im Seitenmenü → **"Anmeldedaten"**
2. Klicke **"+ Anmeldedaten erstellen"** → **"OAuth-Client-ID"**
3. **Anwendungstyp:** Wähle **"Webanwendung"**

**Konfiguration:**
- **Name:** `Fuchs Metallbau OAuth Client`
- **Autorisierte JavaScript-Ursprünge:**
  ```
  http://localhost:3001
  ```
- **Autorisierte Weiterleitungs-URIs:**
  ```
  http://localhost:3001/api/auth/google/callback
  ```

4. Klicke **"Erstellen"**

---

### Schritt 6: Client ID & Secret kopieren

Nach der Erstellung erscheint ein Popup mit:
- **Client-ID** (sieht aus wie: `123456789-abc123def456.apps.googleusercontent.com`)
- **Clientschlüssel** (sieht aus wie: `GOCSPX-abc123def456`)

**WICHTIG:** Kopiere beide Werte! Du brauchst sie gleich.

---

### Schritt 7: Credentials in .env Datei eintragen

1. Öffne die `.env` Datei im `backend` Ordner
2. Füge folgende Zeilen hinzu (ersetze die Werte mit deinen kopierten Credentials):

```env
# Google OAuth Credentials
GOOGLE_CLIENT_ID=deine-client-id-hier.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=dein-client-secret-hier
GOOGLE_REDIRECT_URI=http://localhost:3001/api/auth/google/callback
```

**Beispiel:**
```env
GOOGLE_CLIENT_ID=123456789-abc123def456.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-abc123def456xyz789
GOOGLE_REDIRECT_URI=http://localhost:3001/api/auth/google/callback
```

3. Speichere die Datei

---

### Schritt 8: Dependencies installieren

Öffne ein Terminal im `backend` Ordner und führe aus:

```bash
cd backend
npm install
```

Dies installiert das `googleapis` Package, das für OAuth benötigt wird.

---

### Schritt 9: Server neu starten

1. Stoppe den Server (falls er läuft): `Ctrl + C` im Terminal
2. Starte den Server neu:
   - **Windows:** Doppelklick auf `start.bat`
   - **Linux/Mac:**
     ```bash
     cd backend
     npm start
     ```

Du solltest folgende Meldung sehen:
```
✅ Found existing OAuth tokens
```
oder
```
ℹ️  No OAuth tokens found - please login via /api/auth/google
```

---

### Schritt 10: Mit Google anmelden! 🎉

1. Öffne die App im Browser: http://localhost:3000
2. Gehe zu **"Drive Einstellungen"**
3. Klicke auf **"Mit Google anmelden"**
4. Ein Popup-Fenster öffnet sich
5. Wähle dein Google-Konto
6. **Wichtig:** Es erscheint eine Warnung "Google hasn't verified this app"
   - Klicke auf **"Advanced"** (Erweitert)
   - Klicke auf **"Go to Fuchs Metallbau App (unsafe)"** (Zu Fuchs Metallbau App)
   - Dies ist normal, da die App im Test-Modus läuft
7. Erlaube den Zugriff auf Drive
8. Fertig! Du bist jetzt angemeldet ✅

---

## 🎯 Fertig!

Du bist jetzt mit Google OAuth angemeldet! Die Anmeldung bleibt dauerhaft gespeichert.

### Was jetzt funktioniert:
- ✅ Drive-Ordner synchronisieren
- ✅ Bilder automatisch herunterladen
- ✅ Bilder komprimieren
- ✅ Dateien aus Drive löschen (automatisch nach Sync)
- ✅ Automatisches Token-Refresh (du musst nicht neu anmelden)

### Wann musst du neu anmelden?
- Nur wenn du auf "Abmelden" klickst
- Oder nach ~30+ Tagen Inaktivität (Google Session Ablauf)

---

## 🔧 Troubleshooting

### Problem: "OAuth not configured" Fehler

**Lösung:** Überprüfe die `.env` Datei:
- Sind `GOOGLE_CLIENT_ID` und `GOOGLE_CLIENT_SECRET` korrekt eingetragen?
- Keine Leerzeichen vor oder nach den Werten?
- Server neu gestartet nach Änderung der `.env`?

---

### Problem: "Redirect URI mismatch" Fehler

**Lösung:**
1. Gehe zurück zur Google Cloud Console
2. **APIs & Dienste** → **Anmeldedaten**
3. Klicke auf deinen OAuth Client
4. Überprüfe **"Autorisierte Weiterleitungs-URIs"**
5. Muss exakt sein: `http://localhost:3001/api/auth/google/callback`
6. Keine zusätzlichen Slashes, keine HTTPS (außer in Production)

---

### Problem: "Access denied" nach Login

**Lösung:**
1. Gehe zur Google Cloud Console
2. **APIs & Dienste** → **OAuth-Zustimmungsbildschirm**
3. Scrolle zu **"Testnutzer"**
4. Füge deine E-Mail-Adresse hinzu, falls noch nicht vorhanden

---

### Problem: "Google Drive API has not been used..." Fehler

**Lösung:**
1. Gehe zur Google Cloud Console
2. **APIs & Dienste** → **Aktivierte APIs & Dienste**
3. Überprüfe, ob **"Google Drive API"** aktiviert ist
4. Falls nicht: Klicke **"+ APIs aktivieren"** → Suche "Google Drive API" → **"Aktivieren"**
5. Warte 1-2 Minuten, dann nochmal versuchen

---

## 🌐 Production Setup (später)

Wenn du die App auf einem Server deployen willst:

1. Ändere die **Redirect URI** in der Google Cloud Console:
   ```
   https://deine-domain.com/api/auth/google/callback
   ```

2. Update die `.env` auf dem Server:
   ```env
   GOOGLE_REDIRECT_URI=https://deine-domain.com/api/auth/google/callback
   ```

3. Verifiziere die App in der Google Cloud Console (optional):
   - **OAuth-Zustimmungsbildschirm** → **"App zur Verifizierung einreichen"**
   - Danach verschwindet die "unsafe app" Warnung

---

## 📞 Support

Bei Problemen oder Fragen:
- Überprüfe die Konsole im Terminal (Backend) auf Fehlermeldungen
- Überprüfe die Browser-Konsole (F12) auf Fehlermeldungen
- Stelle sicher, dass alle Schritte korrekt ausgeführt wurden

---

**Viel Erfolg! 🚀**
