# 🔧 OAuth Troubleshooting Guide

## Problem: "The OAuth client was not found" (Fehler 401)

Dieser Fehler tritt auf, wenn die OAuth Client ID nicht in der Google Cloud Console existiert oder falsch konfiguriert ist.

---

## ✅ Checkliste zum Beheben:

### 1. **Prüfe in Google Cloud Console**

Gehe zu: https://console.cloud.google.com/apis/credentials

#### ✓ OAuth Client ID existiert?
- [ ] Es gibt einen OAuth 2.0 Client mit Typ "Webanwendung"
- [ ] Der Name ist z.B. "Fuchs Metallbau OAuth Client"

#### ✓ Client ID ist korrekt?
- [ ] Kopiere die Client ID aus Google Cloud Console
- [ ] Vergleiche mit der ID die du eingegeben hast
- [ ] Format: `123456789-abc...xyz.apps.googleusercontent.com`

#### ✓ Client Secret ist korrekt?
- [ ] Kopiere das Client Secret aus Google Cloud Console
- [ ] Format: `GOCSPX-...` (beginnt mit GOCSPX)

---

### 2. **Redirect URI konfiguriert?** ⚠️ WICHTIG!

In Google Cloud Console → Anmeldedaten → Dein OAuth Client:

#### **Autorisierte Weiterleitungs-URIs:**
```
http://localhost:3001/api/auth/google/callback
```

**GENAU SO** muss es eingetragen sein!

#### Häufige Fehler:
- ❌ `http://localhost:3001` (ohne `/api/auth/google/callback`)
- ❌ `https://localhost:3001/...` (https statt http)
- ❌ `http://127.0.0.1:3001/...` (127.0.0.1 statt localhost)

**Nur diese URI ist erlaubt:**
```
http://localhost:3001/api/auth/google/callback
```

---

### 3. **Google Drive API aktiviert?**

Gehe zu: https://console.cloud.google.com/apis/library

1. Suche nach: **"Google Drive API"**
2. Klicke darauf
3. Stelle sicher: **"API aktiviert"** (grüner Status)

---

### 4. **Testnutzer hinzugefügt?** (Für externe Apps)

Wenn deine App im **Test-Modus** ist:

Gehe zu: https://console.cloud.google.com/apis/credentials/consent

#### OAuth-Zustimmungsbildschirm → Testnutzer:
- [ ] Deine Google E-Mail-Adresse ist als Testnutzer hinzugefügt
- [ ] **NICHT** `privat@netrock.at` (wenn das nicht dein Account ist)

**So hinzufügen:**
1. Scrolle runter zu "Testnutzer"
2. Klicke "+ Nutzer hinzufügen"
3. Gib DEINE E-Mail-Adresse ein (mit der du dich anmelden willst)
4. Speichern

---

### 5. **Richtiges Google Cloud Projekt ausgewählt?**

Oben links in der Google Cloud Console:

- [ ] Projekt-Name ist korrekt (z.B. "Fuchs Metallbau App")
- [ ] Nicht versehentlich ein anderes Projekt ausgewählt

---

## 🔄 Schritt-für-Schritt: Neues OAuth Client erstellen

Falls nichts hilft, erstelle einen neuen OAuth Client:

### 1. Google Cloud Console öffnen
https://console.cloud.google.com/apis/credentials

### 2. Klicke "+ Anmeldedaten erstellen"
→ **OAuth-Client-ID**

### 3. Konfiguration:
- **Anwendungstyp:** Webanwendung
- **Name:** Fuchs Metallbau OAuth Client

### 4. Autorisierte JavaScript-Ursprünge:
```
http://localhost:3001
```

### 5. Autorisierte Weiterleitungs-URIs:
```
http://localhost:3001/api/auth/google/callback
```

### 6. Erstellen

### 7. Credentials kopieren:
- ✅ Client ID: `123456789-abc...xyz.apps.googleusercontent.com`
- ✅ Client Secret: `GOCSPX-...`

### 8. In Fuchs Metallbau App eintragen:
1. Öffne: `http://localhost:3001`
2. Klicke: "Credentials konfigurieren"
3. Füge die Werte ein
4. Speichern

### 9. Backend-Log prüfen:
```
✅ OAuth credentials saved successfully
```

### 10. Erneut anmelden:
- Klicke: "Mit Google anmelden"
- Wähle das **RICHTIGE** Google-Konto
- Erlaube Zugriff

---

## 🐛 Debug: Backend-Log prüfen

Schaue in die Backend-Konsole nach Fehlern:

```bash
cd backend
npm run dev
```

**Erwartete Logs:**
```
✅ OAuth credentials saved successfully
✅ Found existing OAuth tokens
```

**Fehler-Logs:**
```
❌ Error saving credentials: ...
⚠️ OAuth not configured
```

---

## 📞 Immer noch Probleme?

1. **Prüfe `.env` Datei:**
   ```bash
   D:\MCP_Projekte\NR_Fuchs_Metallbau\backend\.env
   ```

   **Sollte enthalten:**
   ```
   GOOGLE_CLIENT_ID=DEINE_ECHTE_CLIENT_ID.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=DEIN_ECHTES_SECRET
   GOOGLE_REDIRECT_URI=http://localhost:3001/api/auth/google/callback
   ```

2. **Teste Credentials manuell:**
   - Kopiere Client ID aus `.env`
   - Suche danach in Google Cloud Console
   - Existiert sie?

3. **Erstelle neues Projekt:**
   - Manchmal hilft es, ein komplett neues Google Cloud Projekt zu erstellen
   - Folge der Anleitung in `GOOGLE_OAUTH_SETUP.md`

---

## ✅ Erfolgreich wenn:

```
✅ Backend-Log: "OAuth credentials saved successfully"
✅ Frontend: "🔐 Google Login erforderlich" (nicht mehr "Credentials fehlen")
✅ Nach "Mit Google anmelden": Google Login-Screen erscheint
✅ Nach erfolgreicher Anmeldung: "✅ Mit Google angemeldet"
```

---

**Viel Erfolg!** 🚀
