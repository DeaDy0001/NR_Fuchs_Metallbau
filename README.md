# Fuchs Metallbau - Netzwerk Web-App

Eine lokale Webanwendung für die Verwaltung von Bildern und Projekten im Firmennetzwerk.

## Features

### 🎨 Design
- **Dark Mode** - Dunkles Theme mit blauen Akzenten
- **Responsive Sidebar** - Ein-/ausklappbare Menüleiste mit Icons
- **Anpassbares Logo** - Eigenes Logo in der Kopfzeile

### 📁 Drive
- **Google Drive Integration** - Öffentliche Ordner-Links einbinden
- **Bilderverwaltung** - Anzeige aller Bilder aus konfigurierten Pfaden
- **Ansichten** - Wechsel zwischen Kachel- und Listenansicht
- **Thumbnails** - Automatisch generierte Vorschaubilder
- **Bildbearbeitung** - Bilder umbenennen über großes Modal

### 📂 Projekte
- **Lokale Ordner** - Synchronisation mit lokalem Projektordner
- **Projekt-Infos** - Farben und Notizen zu jedem Projekt
- **Datenbank** - Infos werden separat gespeichert, Projektordner bleiben unverändert

## Technologie-Stack

### Backend
- **Node.js** + Express
- **PostgreSQL** - Datenbank mit optimierten Indizes
- **Sharp** - Bild-Processing und Thumbnail-Generierung

### Frontend
- **React 18** mit Vite
- **React Router** - Client-seitiges Routing
- **Lucide React** - Icon-Bibliothek

## Voraussetzungen

- **Node.js** (v16 oder höher) - [Download](https://nodejs.org/)
- **PostgreSQL** (v12 oder höher) - [Download](https://www.postgresql.org/download/)

## Installation & Start

### Windows Server

1. **PostgreSQL konfigurieren**
   - PostgreSQL installieren und starten
   - Datenbank erstellen: `CREATE DATABASE fuchs_metallbau;`
   - Optional: Credentials in `backend/.env` anpassen

2. **Server starten**
   ```cmd
   start.bat
   ```

Die `start.bat` Datei führt automatisch folgende Schritte aus:
- Prüft Node.js und PostgreSQL
- Installiert alle Dependencies (Backend + Frontend)
- Initialisiert die Datenbank
- Baut das Frontend
- Startet den Server

3. **App öffnen**
   - Öffne Browser: `http://localhost:3001`
   - Oder von anderem PC im Netzwerk: `http://<SERVER-IP>:3001`

### Manuelle Installation

```bash
# Backend
cd backend
npm install
node src/utils/initDatabase.js
npm start

# Frontend (in neuem Terminal)
cd frontend
npm install
npm run build
```

## Konfiguration

### Datenbank (backend/.env)
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=fuchs_metallbau
DB_USER=postgres
DB_PASSWORD=postgres
```

### Port ändern (backend/.env)
```env
PORT=3001
```

## Verwendung

### 1. Logo hochladen
1. Einstellungen öffnen (⚙️ Icon oben rechts)
2. Logo hochladen (JPG, PNG, SVG, WebP)
3. Logo wird in der Kopfzeile angezeigt

### 2. Drive einrichten
1. **Drive > Einstellungen**
2. Google Drive Ordner-Links hinzufügen
   - Links zu öffentlichen Ordnern verwenden
   - Mehrere Pfade möglich
3. **Drive > Bilder**
4. Auf "Aktualisieren" klicken
5. Bilder durchsuchen, umbenennen, in verschiedenen Ansichten anzeigen

### 3. Projekte einrichten
1. **Projekte > Einstellungen**
2. Lokalen Projektordner auswählen (z.B. `C:\Projekte`)
3. "Projekte synchronisieren" klicken
4. **Projekte > Projekte**
5. Projekten Farben zuweisen und Notizen hinzufügen

## Datenbankstruktur

- **settings** - App-Einstellungen (Logo, Theme)
- **drive_paths** - Konfigurierte Google Drive Pfade
- **drive_images** - Bild-Metadaten mit Thumbnails
- **project_settings** - Projekt-Ordner Konfiguration
- **projects** - Projekt-Informationen (Farbe, Notizen)

## Performance

Die App ist für große Datenmengen optimiert:
- **Indizierte Datenbank-Queries** - Schnelle Suche auch bei vielen Einträgen
- **Pagination** - Effizientes Laden großer Listen
- **Thumbnail-Cache** - Vorschaubilder werden generiert und gecacht
- **PostgreSQL** - Hochperformante Datenbank

## Entwicklung

### Backend Development
```bash
cd backend
npm run dev  # Startet mit Nodemon (Auto-Reload)
```

### Frontend Development
```bash
cd frontend
npm run dev  # Startet Dev-Server auf Port 3000
```

### Datenbank neu initialisieren
```bash
cd backend
node src/utils/initDatabase.js
```

## API Endpoints

### Settings
- `GET /api/settings` - Einstellungen abrufen
- `PUT /api/settings` - Einstellungen aktualisieren
- `POST /api/settings/logo` - Logo hochladen
- `DELETE /api/settings/logo` - Logo löschen

### Drive
- `GET /api/drive/settings` - Drive-Pfade abrufen
- `POST /api/drive/settings/path` - Pfad hinzufügen
- `DELETE /api/drive/settings/path/:id` - Pfad löschen
- `GET /api/drive/images` - Bilder abrufen
- `PUT /api/drive/images/:id/rename` - Bild umbenennen
- `POST /api/drive/images/refresh` - Bilder aktualisieren

### Projects
- `GET /api/projects/settings` - Projekt-Einstellungen
- `POST /api/projects/settings/path` - Projekt-Pfad setzen
- `GET /api/projects` - Projekte abrufen
- `PUT /api/projects/:id` - Projekt aktualisieren
- `POST /api/projects/sync` - Projekte synchronisieren

## Netzwerkzugriff

Um die App im lokalen Netzwerk verfügbar zu machen:

1. Windows Firewall-Regel erstellen für Port 3001
2. Server-IP herausfinden: `ipconfig`
3. Von anderen PCs zugreifen: `http://<SERVER-IP>:3001`

## Troubleshooting

### Port bereits belegt
```bash
# Port in backend/.env ändern
PORT=3002
```

### PostgreSQL-Verbindungsfehler
- PostgreSQL-Dienst starten
- Credentials in `backend/.env` prüfen
- Datenbank existiert: `CREATE DATABASE fuchs_metallbau;`

### Frontend Build-Fehler
```bash
cd frontend
rm -rf node_modules
npm install
npm run build
```

## Lizenz

Internes Projekt für Fuchs Metallbau

## Support

Bei Fragen oder Problemen, bitte Issue erstellen oder Entwickler kontaktieren.
