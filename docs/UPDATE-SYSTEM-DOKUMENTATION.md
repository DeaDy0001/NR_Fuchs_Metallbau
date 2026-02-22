# Update-System - Komplette Dokumentation

> Selbst-aktualisierendes System für Node.js/React-Apps auf lokalen Netzwerk-Servern.
> Ermöglicht Updates direkt aus der Web-App heraus - per Git-Tags (Versionen) oder Git-Branches (Entwickler).

---

## Inhaltsverzeichnis

1. [Architektur-Überblick](#1-architektur-überblick)
2. [Voraussetzungen](#2-voraussetzungen)
3. [Backend: API-Endpunkte](#3-backend-api-endpunkte)
4. [Backend: System-Controller](#4-backend-system-controller)
5. [Backend: GitHub-Token-Verwaltung](#5-backend-github-token-verwaltung)
6. [Backend: Server-Konfiguration](#6-backend-server-konfiguration)
7. [Frontend: Update-Settings-Seite](#7-frontend-update-settings-seite)
8. [Frontend: Update-Benachrichtigung](#8-frontend-update-benachrichtigung)
9. [Frontend: GitHub-Token-Modal](#9-frontend-github-token-modal)
10. [Start-Script (Windows)](#10-start-script-windows)
11. [CSS/Design](#11-cssdesign)
12. [Mögliche Probleme & Lösungen](#12-mögliche-probleme--lösungen)
13. [Anpassung für andere Projekte](#13-anpassung-für-andere-projekte)

---

## 1. Architektur-Überblick

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                         │
│                                                                 │
│  ┌──────────────────┐  ┌─────────────────┐  ┌───────────────┐  │
│  │ UpdateSettings   │  │ UpdateNotifi-   │  │ GitHubToken-  │  │
│  │ (Hauptseite)     │  │ cation (Banner) │  │ Modal         │  │
│  └────────┬─────────┘  └───────┬─────────┘  └──────┬────────┘  │
│           │                    │                    │            │
└───────────┼────────────────────┼────────────────────┼────────────┘
            │ fetch()            │ fetch()            │ fetch()
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                     BACKEND (Express.js)                        │
│                                                                 │
│  /api/system/git-info      GET    → Aktuelle Git-Info           │
│  /api/system/tags          GET    → Verfügbare Versionen        │
│  /api/system/branches      GET    → Branches (passwortgeschützt)│
│  /api/system/version       GET    → Update-Check vs. GitHub     │
│  /api/system/update        POST   → Update von main             │
│  /api/system/update-version POST  → Update auf bestimmten Tag   │
│  /api/system/update-branch POST   → Update von Branch (Dev)     │
│  /api/github/token         POST   → Token speichern             │
│  /api/github/token/status  GET    → Token-Status prüfen         │
│  /api/github/token         DELETE → Token entfernen             │
│  /api/health               GET    → Health-Check                │
│                                                                 │
│  Update-Ablauf:                                                 │
│  1. Response senden → 2. git stash → 3. git fetch               │
│  4. git checkout → 5. npm install → 6. npm run build            │
│  7. process.exit(100) → start.bat erkennt Code 100 → Neustart  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼ process.exit(100)
┌─────────────────────────────────────────────────────────────────┐
│                    START-SCRIPT (start.bat)                      │
│                                                                 │
│  :server_loop                                                   │
│    node src/server.js                                           │
│    if EXIT_CODE == 100 → goto server_loop (Neustart)            │
│    sonst → Script beenden                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Ablauf eines Updates:
1. User klickt "Version installieren" / "Von Branch aktualisieren"
2. Frontend sendet POST an Backend
3. Backend sendet sofort `{ success: true }` zurück
4. Backend führt nach 1s Delay die Git-Operationen aus
5. Frontend zeigt Restart-Modal mit Spinner
6. Backend beendet sich mit `process.exit(100)`
7. `start.bat` erkennt Exit-Code 100 und startet Server neu
8. Frontend pollt `/api/health` alle 2s
9. Sobald Server wieder da ist → `window.location.reload()`

---

## 2. Voraussetzungen

- **Node.js** (v18+)
- **Git** (auf dem Server installiert)
- **GitHub Repository** (öffentlich oder mit Token für private Repos)
- **SQLite-Datenbank** mit einer `settings`-Tabelle (für Token-Speicherung)
- **Windows** (für start.bat) oder **Linux** (start.sh analog)

### Datenbank-Schema (SQLite):
```sql
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  github_token TEXT,
  -- ... andere Settings
);

-- Initiale Zeile:
INSERT OR IGNORE INTO settings (id) VALUES (1);
```

### npm Dependencies (Backend):
```json
{
  "dependencies": {
    "axios": "^1.6.2",
    "express": "^4.18.2",
    "better-sqlite3": "^11.7.0",
    "fs-extra": "^11.2.0"
  }
}
```

### npm Dependencies (Frontend):
```json
{
  "dependencies": {
    "lucide-react": "^0.295.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.21.0"
  }
}
```

---

## 3. Backend: API-Endpunkte

### Datei: `backend/src/routes/system.js`

```javascript
const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');

// Get current version and check for updates
router.get('/version', systemController.getLatestVersion);

// Trigger update from GitHub (main branch)
router.post('/update', systemController.triggerUpdate);

// Trigger update from specific branch (developer only)
router.post('/update-branch', systemController.triggerBranchUpdate);

// Get git info (branch, commit, etc.)
router.get('/git-info', systemController.getGitInfo);

// Get all tags (versions)
router.get('/tags', systemController.getTags);

// Get all remote branches (developer only, requires password)
router.get('/branches', systemController.getBranches);

// Trigger update to a specific version (tag)
router.post('/update-version', systemController.triggerVersionUpdate);

module.exports = router;
```

### Registrierung in `server.js`:
```javascript
app.use('/api/system', require('./routes/system'));
app.use('/api/github', require('./routes/github'));

// Health check - WICHTIG für den Restart-Check!
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

---

## 4. Backend: System-Controller

### Datei: `backend/src/controllers/systemController.js`

```javascript
const axios = require('axios');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

// === ANPASSEN: GitHub Repository Info ===
const GITHUB_OWNER = 'DeaDy0001';
const GITHUB_REPO = 'NR_Fuchs_Metallbau';

// === ANPASSEN: Entwickler-Passwort ===
const DEV_PASSWORD = 'netrock!';

/**
 * Get current version from package.json
 */
const getCurrentVersion = () => {
  const packagePath = path.join(__dirname, '../../package.json');
  const packageJson = require(packagePath);
  return packageJson.version;
};

/**
 * Compare two semantic versions
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
const compareVersions = (v1, v2) => {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;

    if (part1 > part2) return 1;
    if (part1 < part2) return -1;
  }

  return 0;
};

/**
 * Get latest version from GitHub releases
 * Vergleicht aktuelle Version mit dem neuesten GitHub Release
 */
const getLatestVersion = async (req, res) => {
  try {
    const currentVersion = getCurrentVersion();

    const response = await axios.get(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'My-App-Update-Checker'
        }
      }
    );

    const latestRelease = response.data;
    const latestVersion = latestRelease.tag_name.replace(/^v/, '');

    res.json({
      currentVersion,
      latestVersion,
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      releaseNotes: latestRelease.body,
      releaseName: latestRelease.name,
      publishedAt: latestRelease.published_at,
      downloadUrl: latestRelease.html_url
    });
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return res.json({
        currentVersion: getCurrentVersion(),
        latestVersion: null,
        updateAvailable: false,
        message: 'Keine Releases verfügbar'
      });
    }

    console.error('Error fetching latest version:', error.message);
    res.status(500).json({
      error: 'Failed to check for updates',
      currentVersion: getCurrentVersion()
    });
  }
};

/**
 * Get current Git commit info
 */
const getGitInfo = (req, res) => {
  try {
    const projectRoot = path.join(__dirname, '../../..');

    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot })
      .toString().trim();

    const commit = execSync('git rev-parse --short HEAD', { cwd: projectRoot })
      .toString().trim();

    const commitMessage = execSync('git log -1 --pretty=%B', { cwd: projectRoot })
      .toString().trim();

    const commitDate = execSync('git log -1 --pretty=%cd --date=iso', { cwd: projectRoot })
      .toString().trim();

    res.json({
      branch,
      commit,
      commitMessage,
      commitDate,
      version: getCurrentVersion()
    });
  } catch (error) {
    console.error('Error getting git info:', error);
    res.status(500).json({
      error: 'Failed to get git info',
      version: getCurrentVersion()
    });
  }
};

/**
 * Trigger update from main branch
 * Zieht die neuesten Änderungen von main, installiert Dependencies, baut Frontend
 */
const triggerUpdate = async (req, res) => {
  try {
    const projectRoot = path.join(__dirname, '../../..');

    // WICHTIG: Response sofort senden, da Connection beim Restart verloren geht
    res.json({
      success: true,
      message: 'Update wird durchgeführt. Server startet neu...'
    });

    // Update nach kurzem Delay ausführen (damit Response sicher gesendet wird)
    setTimeout(async () => {
      try {
        console.log('Starting update process...');

        // 1. Lokale Änderungen stashen
        try { execSync('git stash', { cwd: projectRoot }); }
        catch (e) { /* Ignore if nothing to stash */ }

        // 2. Fetch + Pull von main
        execSync('git fetch origin main', { cwd: projectRoot });
        execSync('git pull origin main', { cwd: projectRoot });

        // 3. Dependencies installieren
        execSync('npm install', { cwd: path.join(projectRoot, 'backend') });
        execSync('npm install', { cwd: path.join(projectRoot, 'frontend') });

        // 4. Frontend bauen
        execSync('npm run build', { cwd: path.join(projectRoot, 'frontend') });

        console.log('Update completed! Restarting server...');

        // 5. Server neu starten (Exit Code 100 → start.bat/sh startet Server erneut)
        process.exit(100);
      } catch (error) {
        console.error('Update failed:', error.message);
        process.exit(1);
      }
    }, 1000);
  } catch (error) {
    console.error('Error triggering update:', error);
    res.status(500).json({ error: 'Failed to trigger update', details: error.message });
  }
};

/**
 * Get all tags (versions) from remote repository
 */
const getTags = async (req, res) => {
  try {
    const projectRoot = path.join(__dirname, '../../..');

    // Fetch tags (ignoriere Fehler falls offline)
    try { execSync('git fetch origin --tags', { cwd: projectRoot }); }
    catch (e) { /* Continue offline */ }

    // Tags sortiert nach Version (neuste zuerst)
    const tagsOutput = execSync(
      'git tag --sort=-version:refname',
      { cwd: projectRoot }
    ).toString().trim();

    const tags = tagsOutput
      ? tagsOutput.split('\n').map(tag => {
          let date = '';
          try {
            date = execSync(`git log -1 --format=%cd --date=iso "${tag}"`, { cwd: projectRoot })
              .toString().trim();
          } catch (e) { /* ignore */ }

          let message = '';
          try {
            message = execSync(`git tag -l -n1 "${tag}"`, { cwd: projectRoot })
              .toString().trim().replace(tag, '').trim();
          } catch (e) { /* ignore */ }

          return { name: tag, date, message };
        })
      : [];

    res.json({ tags, currentVersion: getCurrentVersion() });
  } catch (error) {
    console.error('Error fetching tags:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Versionen' });
  }
};

/**
 * Get all remote branches (requires dev password)
 */
const getBranches = async (req, res) => {
  try {
    const { password } = req.query;

    if (!password || password !== DEV_PASSWORD) {
      return res.status(403).json({ error: 'Falsches Entwickler-Passwort' });
    }

    const projectRoot = path.join(__dirname, '../../..');

    // Fetch + prune (lösche lokale Referenzen zu gelöschten Remote-Branches)
    try { execSync('git fetch origin --prune', { cwd: projectRoot }); }
    catch (e) { /* Continue offline */ }

    const branchesOutput = execSync(
      'git branch -r --format="%(refname:short)"',
      { cwd: projectRoot }
    ).toString().trim();

    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot })
      .toString().trim();

    const branches = branchesOutput
      ? branchesOutput
          .split('\n')
          .map(b => b.trim())
          .filter(b => b && !b.includes('HEAD'))
          .map(b => b.replace('origin/', ''))
      : [];

    res.json({ branches, currentBranch });
  } catch (error) {
    console.error('Error fetching branches:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Branches' });
  }
};

/**
 * Trigger update to a specific version (tag)
 */
const triggerVersionUpdate = async (req, res) => {
  try {
    const { tag } = req.body;

    if (!tag) {
      return res.status(400).json({ error: 'Version ist erforderlich' });
    }

    const projectRoot = path.join(__dirname, '../../..');

    res.json({
      success: true,
      message: `Update auf Version "${tag}" wird durchgeführt. Server startet neu...`
    });

    setTimeout(async () => {
      try {
        console.log(`Starting version update to "${tag}"...`);

        // 1. Stash
        try { execSync('git stash', { cwd: projectRoot }); }
        catch (e) { /* ignore */ }

        // 2. Fetch tags
        execSync('git fetch origin --tags', { cwd: projectRoot });

        // 3. Checkout main und pull (damit wir einen sauberen Stand haben)
        execSync('git checkout main', { cwd: projectRoot });
        execSync('git pull origin main', { cwd: projectRoot });

        // 4. Checkout des spezifischen Tags
        execSync(`git checkout "${tag}"`, { cwd: projectRoot });

        // 5. Dependencies
        execSync('npm install', { cwd: path.join(projectRoot, 'backend') });
        execSync('npm install', { cwd: path.join(projectRoot, 'frontend') });

        // 6. Frontend bauen
        execSync('npm run build', { cwd: path.join(projectRoot, 'frontend') });

        console.log(`Version update to "${tag}" completed! Restarting...`);
        process.exit(100);
      } catch (error) {
        console.error('Version update failed:', error.message);
        process.exit(1);
      }
    }, 1000);
  } catch (error) {
    console.error('Error triggering version update:', error);
    res.status(500).json({ error: 'Fehler beim Versions-Update' });
  }
};

/**
 * Trigger update from specific branch (developer only)
 */
const triggerBranchUpdate = async (req, res) => {
  try {
    const { branch, password } = req.body;

    if (!branch || !password) {
      return res.status(400).json({ error: 'Branch und Passwort erforderlich' });
    }

    if (password !== DEV_PASSWORD) {
      return res.status(403).json({ error: 'Falsches Entwickler-Passwort' });
    }

    const projectRoot = path.join(__dirname, '../../..');

    res.json({
      success: true,
      message: `Update von Branch "${branch}" wird durchgeführt. Server startet neu...`
    });

    setTimeout(async () => {
      try {
        console.log(`Starting branch update from "${branch}"...`);

        // 1. Stash
        try { execSync('git stash', { cwd: projectRoot }); }
        catch (e) { /* ignore */ }

        // 2. Fetch alle Branches
        execSync('git fetch origin', { cwd: projectRoot });

        // 3. Zum Branch wechseln
        execSync(`git checkout ${branch}`, { cwd: projectRoot });

        // 4. Pull
        execSync(`git pull origin ${branch}`, { cwd: projectRoot });

        // 5. Dependencies
        execSync('npm install', { cwd: path.join(projectRoot, 'backend') });
        execSync('npm install', { cwd: path.join(projectRoot, 'frontend') });

        // 6. Frontend bauen
        execSync('npm run build', { cwd: path.join(projectRoot, 'frontend') });

        console.log(`Branch update from "${branch}" completed! Restarting...`);
        process.exit(100);
      } catch (error) {
        console.error('Branch update failed:', error.message);
        process.exit(1);
      }
    }, 1000);
  } catch (error) {
    console.error('Error triggering branch update:', error);
    res.status(500).json({ error: 'Failed to trigger branch update', details: error.message });
  }
};

module.exports = {
  getLatestVersion,
  triggerUpdate,
  triggerBranchUpdate,
  triggerVersionUpdate,
  getGitInfo,
  getTags,
  getBranches
};
```

---

## 5. Backend: GitHub-Token-Verwaltung

### Datei: `backend/src/routes/github.js`

> Speichert GitHub Personal Access Token in DB + `.env`-Datei.
> Wird benötigt für private Repositories oder Push-Operationen.

```javascript
const express = require('express');
const router = express.Router();
const db = require('../config/database'); // better-sqlite3 Instance

/**
 * POST /api/github/token - Token speichern
 */
router.post('/token', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token ist erforderlich' });
    }

    // Format-Validierung
    if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
      return res.status(400).json({
        error: 'Ungültiges Token-Format. Token sollte mit "ghp_" oder "github_pat_" beginnen'
      });
    }

    // In DB speichern
    db.prepare('UPDATE settings SET github_token = ? WHERE id = 1').run(token);

    // Auch in .env speichern (für Persistenz über DB-Resets hinaus)
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '../../../.env');

    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    const envLines = envContent.split('\n');
    const tokenLineIndex = envLines.findIndex(line => line.startsWith('GITHUB_TOKEN='));

    if (tokenLineIndex !== -1) {
      envLines[tokenLineIndex] = `GITHUB_TOKEN=${token}`;
    } else {
      envLines.push(`GITHUB_TOKEN=${token}`);
    }

    fs.writeFileSync(envPath, envLines.join('\n'));

    res.json({ success: true, message: 'GitHub Token erfolgreich gespeichert' });
  } catch (error) {
    console.error('Error saving GitHub token:', error);
    res.status(500).json({ error: 'Fehler beim Speichern des Tokens' });
  }
});

/**
 * GET /api/github/token/status - Prüfen ob Token konfiguriert ist
 */
router.get('/token/status', async (req, res) => {
  try {
    const setting = db.prepare('SELECT github_token FROM settings WHERE id = 1').get();
    res.json({ configured: !!setting && !!setting.github_token });
  } catch (error) {
    console.error('Error checking GitHub token status:', error);
    res.status(500).json({ error: 'Fehler beim Prüfen des Token-Status' });
  }
});

/**
 * DELETE /api/github/token - Token entfernen
 */
router.delete('/token', async (req, res) => {
  try {
    db.prepare('UPDATE settings SET github_token = NULL WHERE id = 1').run();

    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '../../../.env');

    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, 'utf8');
      const envLines = envContent.split('\n').filter(line => !line.startsWith('GITHUB_TOKEN='));
      fs.writeFileSync(envPath, envLines.join('\n'));
    }

    res.json({ success: true, message: 'GitHub Token wurde entfernt' });
  } catch (error) {
    console.error('Error removing GitHub token:', error);
    res.status(500).json({ error: 'Fehler beim Entfernen des Tokens' });
  }
});

module.exports = router;
```

---

## 6. Backend: Server-Konfiguration

### In `server.js` die Routes registrieren + Health-Check:

```javascript
const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

// Routes registrieren
app.use('/api/system', require('./routes/system'));
app.use('/api/github', require('./routes/github'));

// Health check - KRITISCH für den Restart-Check im Frontend!
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Frontend aus dem Build-Ordner servieren
const frontendDist = path.join(__dirname, '../../frontend/dist');
const fs = require('fs');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

---

## 7. Frontend: Update-Settings-Seite

### Datei: `frontend/src/pages/UpdateSettings.jsx`

```jsx
import { useState, useEffect } from 'react';
import { Download, RefreshCw, AlertCircle, GitBranch, Lock, Tag,
         ChevronDown, Key, CheckCircle } from 'lucide-react';
import GitHubTokenModal from '../components/GitHubTokenModal';
import './UpdateSettings.css';

function UpdateSettings() {
  const [gitInfo, setGitInfo] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');

  // Version update (Tags)
  const [tags, setTags] = useState([]);
  const [selectedTag, setSelectedTag] = useState('');
  const [currentVersion, setCurrentVersion] = useState('');
  const [loadingTags, setLoadingTags] = useState(false);

  // Branch update (Developer)
  const [devPassword, setDevPassword] = useState('');
  const [devAuthenticated, setDevAuthenticated] = useState(false);
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [showBranchUpdate, setShowBranchUpdate] = useState(false);

  // GitHub Token (Developer)
  const [showGitHubTokenModal, setShowGitHubTokenModal] = useState(false);
  const [githubTokenConfigured, setGithubTokenConfigured] = useState(false);

  useEffect(() => {
    loadGitInfo();
    loadTags();
  }, []);

  useEffect(() => {
    if (devAuthenticated) checkGitHubTokenStatus();
  }, [devAuthenticated]);

  const checkGitHubTokenStatus = async () => {
    try {
      const response = await fetch('/api/github/token/status');
      if (response.ok) {
        const data = await response.json();
        setGithubTokenConfigured(data.configured);
      }
    } catch (error) {
      console.error('Error checking GitHub token status:', error);
    }
  };

  const loadGitInfo = async () => {
    try {
      const response = await fetch('/api/system/git-info');
      if (response.ok) {
        const data = await response.json();
        setGitInfo(data);
      }
    } catch (err) {
      console.error('Error loading git info:', err);
    }
  };

  const loadTags = async () => {
    setLoadingTags(true);
    try {
      const response = await fetch('/api/system/tags');
      if (response.ok) {
        const data = await response.json();
        setTags(data.tags);
        setCurrentVersion(data.currentVersion);
      }
    } catch (err) {
      console.error('Error loading tags:', err);
    } finally {
      setLoadingTags(false);
    }
  };

  const handleDevLogin = async () => {
    if (!devPassword) { setError('Bitte Passwort eingeben'); return; }

    setLoadingBranches(true);
    setError('');

    try {
      const response = await fetch(
        `/api/system/branches?password=${encodeURIComponent(devPassword)}`
      );
      if (response.ok) {
        const data = await response.json();
        setBranches(data.branches);
        setSelectedBranch(data.currentBranch);
        setDevAuthenticated(true);
      } else {
        const data = await response.json();
        setError(data.error || 'Authentifizierung fehlgeschlagen');
      }
    } catch (err) {
      setError('Fehler beim Laden der Branches');
    } finally {
      setLoadingBranches(false);
    }
  };

  const handleVersionUpdate = async () => {
    if (!selectedTag) { setError('Bitte eine Version auswählen'); return; }
    if (!window.confirm(`Server wird auf Version "${selectedTag}" aktualisiert. Fortfahren?`)) return;

    setUpdating(true);
    setError('');

    try {
      const response = await fetch('/api/system/update-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: selectedTag })
      });

      if (response.ok) {
        showRestartMessage();
      } else {
        const data = await response.json();
        throw new Error(data.error || 'Versions-Update fehlgeschlagen');
      }
    } catch (err) {
      setError('Versions-Update fehlgeschlagen: ' + err.message);
      setUpdating(false);
    }
  };

  const handleBranchUpdate = async () => {
    if (!selectedBranch) { setError('Bitte einen Branch auswählen'); return; }
    if (!window.confirm(`Server wird von Branch "${selectedBranch}" aktualisiert. Fortfahren?`)) return;

    setUpdating(true);
    setError('');

    try {
      const response = await fetch('/api/system/update-branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: selectedBranch, password: devPassword })
      });

      if (response.ok) {
        showRestartMessage();
      } else {
        const data = await response.json();
        throw new Error(data.error || 'Branch-Update fehlgeschlagen');
      }
    } catch (err) {
      setError('Branch-Update fehlgeschlagen: ' + err.message);
      setUpdating(false);
    }
  };

  /**
   * Zeigt ein Fullscreen-Modal mit Spinner und pollt /api/health
   * bis der Server nach dem Restart wieder verfügbar ist
   */
  const showRestartMessage = () => {
    const modal = document.createElement('div');
    modal.className = 'update-restart-modal';
    modal.innerHTML = `
      <div class="update-restart-content">
        <div class="spinner"></div>
        <h2>Server wird aktualisiert...</h2>
        <p>Bitte warten. Die Seite lädt automatisch neu.</p>
      </div>
    `;
    document.body.appendChild(modal);

    const checkServer = async () => {
      try {
        const response = await fetch('/api/health');
        if (response.ok) window.location.reload();
      } catch {
        setTimeout(checkServer, 2000); // Alle 2 Sekunden prüfen
      }
    };

    setTimeout(checkServer, 5000); // Erst 5s warten bevor erster Check
  };

  return (
    <div className="update-settings-page">
      {/* Aktuelle Installation Info */}
      {gitInfo && (
        <div className="settings-section">
          <h2>Aktuelle Installation</h2>
          <div className="git-info">
            <div className="info-row">
              <span className="info-label">Version:</span>
              <span className="info-value">{gitInfo.version}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Branch:</span>
              <span className="info-value">{gitInfo.branch}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Commit:</span>
              <span className="info-value">{gitInfo.commit}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Letztes Update:</span>
              <span className="info-value">
                {new Date(gitInfo.commitDate).toLocaleString('de-DE')}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Versions-Update (Tags von main) */}
      <div className="settings-section">
        <h2>Versions-Update</h2>
        <p className="section-description">
          Wähle eine veröffentlichte Version aus, um darauf zu aktualisieren.
        </p>

        <div className="update-form">
          <div className="form-group">
            <label>Version auswählen</label>
            <div className="select-wrapper">
              <select
                className="select-input"
                value={selectedTag}
                onChange={(e) => setSelectedTag(e.target.value)}
                disabled={loadingTags || updating}
              >
                <option value="">
                  {loadingTags ? 'Lade Versionen...'
                    : tags.length === 0 ? 'Keine Versionen verfügbar'
                    : '-- Version wählen --'}
                </option>
                {tags.map(tag => (
                  <option key={tag.name} value={tag.name}>
                    {tag.name}
                    {tag.name === `v${currentVersion}` || tag.name === currentVersion
                      ? ' (aktuell)' : ''}
                    {tag.date ? ` - ${new Date(tag.date).toLocaleDateString('de-DE')}` : ''}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} className="select-icon" />
            </div>
          </div>

          <div className="update-actions">
            <button className="btn btn-secondary" onClick={loadTags} disabled={loadingTags}>
              <RefreshCw size={16} className={loadingTags ? 'spinning' : ''} />
              Aktualisieren
            </button>
            <button
              className="btn btn-primary"
              onClick={handleVersionUpdate}
              disabled={updating || !selectedTag}
            >
              <Download size={16} />
              {updating ? 'Wird aktualisiert...' : 'Version installieren'}
            </button>
          </div>
        </div>
      </div>

      {/* Branch Update (Entwickler - passwortgeschützt) */}
      <div className="settings-section developer-section">
        <div className="section-header-with-toggle">
          <h2>Branch Update (Entwickler)</h2>
          <button
            className="toggle-btn"
            onClick={() => setShowBranchUpdate(!showBranchUpdate)}
          >
            <Lock size={16} />
            {showBranchUpdate ? 'Verbergen' : 'Anzeigen'}
          </button>
        </div>

        {showBranchUpdate && (
          <>
            {!devAuthenticated ? (
              <div className="branch-update-form">
                <p className="section-description">
                  Passwort eingeben, um auf verfügbare Branches zuzugreifen.
                </p>
                <div className="form-group">
                  <label>Entwickler-Passwort</label>
                  <div className="input-with-icon">
                    <Lock size={16} />
                    <input
                      type="password"
                      placeholder="Passwort eingeben"
                      value={devPassword}
                      onChange={(e) => setDevPassword(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleDevLogin()}
                    />
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  onClick={handleDevLogin}
                  disabled={loadingBranches || !devPassword}
                >
                  <Lock size={16} />
                  {loadingBranches ? 'Lade...' : 'Anmelden'}
                </button>
              </div>
            ) : (
              <div className="branch-update-form">
                <p className="section-description">
                  Wähle einen Branch aus, um direkt davon zu aktualisieren.
                </p>
                <div className="form-group">
                  <label>Branch auswählen</label>
                  <div className="select-wrapper">
                    <select
                      className="select-input"
                      value={selectedBranch}
                      onChange={(e) => setSelectedBranch(e.target.value)}
                      disabled={updating}
                    >
                      <option value="">-- Branch wählen --</option>
                      {branches.map(branch => (
                        <option key={branch} value={branch}>
                          {branch}{branch === gitInfo?.branch ? ' (aktuell)' : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={16} className="select-icon" />
                  </div>
                </div>

                <div className="update-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setDevAuthenticated(false);
                      setDevPassword('');
                      setBranches([]);
                    }}
                  >
                    <Lock size={16} />
                    Abmelden
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleBranchUpdate}
                    disabled={updating || !selectedBranch}
                  >
                    <GitBranch size={16} />
                    {updating ? 'Wird aktualisiert...' : 'Von Branch aktualisieren'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* GitHub Token Konfiguration (nur für Entwickler sichtbar) */}
      {devAuthenticated && (
        <div className="settings-section developer-section">
          <h2>GitHub Token Konfiguration</h2>
          <p className="section-description">
            Konfiguriere deinen GitHub Personal Access Token.
          </p>
          <div className="github-token-status">
            {githubTokenConfigured ? (
              <div className="token-configured">
                <CheckCircle size={20} />
                <span>Token konfiguriert</span>
              </div>
            ) : (
              <div className="token-not-configured">
                <Key size={20} />
                <span>Kein Token konfiguriert</span>
              </div>
            )}
            <button
              className="btn btn-primary"
              onClick={() => setShowGitHubTokenModal(true)}
            >
              <Key size={18} />
              {githubTokenConfigured ? 'Token ändern' : 'Token einrichten'}
            </button>
          </div>
        </div>
      )}

      {/* Fehler-Anzeige */}
      {error && (
        <div className="error-message">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      <GitHubTokenModal
        isOpen={showGitHubTokenModal}
        onClose={() => setShowGitHubTokenModal(false)}
        onSave={() => setGithubTokenConfigured(true)}
      />
    </div>
  );
}

export default UpdateSettings;
```

---

## 8. Frontend: Update-Benachrichtigung

### Datei: `frontend/src/components/UpdateNotification.jsx`

> Zeigt einen Banner unten rechts an, wenn ein neues Update verfügbar ist.
> Prüft beim Start und dann stündlich.

```jsx
import { useState, useEffect } from 'react';
import { Download, X, RefreshCw, ExternalLink, AlertCircle } from 'lucide-react';
import './UpdateNotification.css';

function UpdateNotification() {
  const [updateInfo, setUpdateInfo] = useState(null);
  const [show, setShow] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    checkForUpdates();
    const interval = setInterval(checkForUpdates, 60 * 60 * 1000); // Stündlich
    return () => clearInterval(interval);
  }, []);

  const checkForUpdates = async () => {
    try {
      const response = await fetch('/api/system/version');
      if (response.ok) {
        const data = await response.json();
        setUpdateInfo(data);
        if (data.updateAvailable && !dismissed) setShow(true);
      }
    } catch (error) {
      console.error('Error checking for updates:', error);
    }
  };

  const handleUpdate = async () => {
    if (!window.confirm('Server wird aktualisiert und neugestartet. Fortfahren?')) return;

    setUpdating(true);
    setError('');

    try {
      const response = await fetch('/api/system/update', { method: 'POST' });
      if (response.ok) {
        setShow(false);
        showRestartMessage(); // Gleiche Funktion wie in UpdateSettings
      } else {
        throw new Error('Update fehlgeschlagen');
      }
    } catch (error) {
      setError('Update konnte nicht durchgeführt werden: ' + error.message);
      setUpdating(false);
    }
  };

  const showRestartMessage = () => {
    const modal = document.createElement('div');
    modal.className = 'update-restart-modal';
    modal.innerHTML = `
      <div class="update-restart-content">
        <div class="spinner"></div>
        <h2>Server wird aktualisiert...</h2>
        <p>Bitte warten. Die Seite lädt automatisch neu.</p>
      </div>
    `;
    document.body.appendChild(modal);

    const checkServer = async () => {
      try {
        const response = await fetch('/api/health');
        if (response.ok) window.location.reload();
      } catch {
        setTimeout(checkServer, 2000);
      }
    };
    setTimeout(checkServer, 5000);
  };

  if (!show || !updateInfo?.updateAvailable) return null;

  return (
    <div className="update-notification">
      <div className="update-notification-content">
        <div className="update-notification-header">
          <Download size={24} className="update-icon" />
          <div>
            <h3>Update verfügbar</h3>
            <p className="update-version">
              Version {updateInfo.currentVersion} → {updateInfo.latestVersion}
            </p>
          </div>
          <button className="update-close-btn" onClick={() => { setShow(false); setDismissed(true); }}>
            <X size={20} />
          </button>
        </div>

        {updateInfo.releaseName && (
          <div className="update-release-name">{updateInfo.releaseName}</div>
        )}

        {updateInfo.releaseNotes && (
          <div className="update-notes">
            <strong>Änderungen:</strong>
            <div className="update-notes-content">{updateInfo.releaseNotes}</div>
          </div>
        )}

        {error && (
          <div className="update-error">
            <AlertCircle size={18} />
            {error}
          </div>
        )}

        <div className="update-actions">
          <a href={updateInfo.downloadUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
            <ExternalLink size={18} />
            Auf GitHub ansehen
          </a>
          <button className="btn btn-primary" onClick={handleUpdate} disabled={updating}>
            {updating ? (
              <><RefreshCw size={18} className="spinning" /> Wird aktualisiert...</>
            ) : (
              <><Download size={18} /> Jetzt aktualisieren</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default UpdateNotification;
```

---

## 9. Frontend: GitHub-Token-Modal

### Datei: `frontend/src/components/GitHubTokenModal.jsx`

```jsx
import { useState } from 'react';
import { X, ExternalLink, AlertCircle, CheckCircle, Loader, Key } from 'lucide-react';
import './GitHubTokenModal.css';

function GitHubTokenModal({ isOpen, onClose, onSave }) {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (!token) {
      setError('Bitte gib einen GitHub Token ein');
      return;
    }

    // Format-Validierung
    if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
      setError('GitHub Token sollte mit "ghp_" oder "github_pat_" beginnen');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/github/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Fehler beim Speichern des Tokens');
      }

      setSuccess(true);
      setTimeout(() => {
        onSave?.();
        onClose();
        setToken('');
        setError('');
        setSuccess(false);
      }, 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setToken('');
      setError('');
      setSuccess(false);
      onClose();
    }
  };

  return (
    <div className="github-token-modal-overlay" onClick={handleClose}>
      <div className="github-token-modal" onClick={(e) => e.stopPropagation()}>
        <button className="github-token-modal-close" onClick={handleClose} disabled={loading}>
          <X size={24} />
        </button>

        <div className="github-token-modal-content">
          <div className="modal-header">
            <Key size={32} className="github-icon" />
            <h2>GitHub Personal Access Token</h2>
          </div>

          <p className="github-token-description">
            Um Git-Push-Operationen durchzuführen, benötigst du einen Personal Access Token.
          </p>

          <div className="github-token-help-box">
            <AlertCircle size={20} />
            <div>
              <strong>So erstellst du einen Token:</strong>
              <ol>
                <li>Gehe zu GitHub Settings → Developer settings</li>
                <li>Wähle "Personal access tokens" → "Tokens (classic)"</li>
                <li>Klicke auf "Generate new token (classic)"</li>
                <li>Gib dem Token einen Namen</li>
                <li>Wähle mindestens den Scope: <code>repo</code></li>
                <li>Klicke "Generate token" und kopiere ihn</li>
              </ol>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="github-token-form">
            <div className="form-group">
              <label htmlFor="token">
                Personal Access Token <span className="required">*</span>
              </label>
              <input
                id="token"
                type="password"
                className="input"
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={token}
                onChange={(e) => setToken(e.target.value.trim())}
                disabled={loading || success}
                required
                autoComplete="off"
              />
            </div>

            {error && (
              <div className="github-token-error">
                <AlertCircle size={18} />{error}
              </div>
            )}
            {success && (
              <div className="github-token-success">
                <CheckCircle size={18} />Token erfolgreich gespeichert!
              </div>
            )}

            <div className="github-token-actions">
              <button type="button" className="btn btn-secondary" onClick={handleClose} disabled={loading}>
                Abbrechen
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading || success}>
                {loading ? <><Loader size={18} className="spinning" /> Speichern...</>
                  : success ? <><CheckCircle size={18} /> Gespeichert!</>
                  : <><Key size={18} /> Token speichern</>}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default GitHubTokenModal;
```

---

## 10. Start-Script (Windows)

### Datei: `start.bat`

> Der **kritische Teil** ist die `:server_loop` am Ende.
> `process.exit(100)` im Backend führt dazu, dass das Script den Server automatisch neu startet.

```batch
@echo off
cd /d "%~dp0"
echo ========================================
echo   Meine App - Server Start
echo ========================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js ist nicht installiert!
    pause
    exit /b 1
)

REM Install backend dependencies
echo [1/4] Installiere Backend Dependencies...
cd backend
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Backend Installation fehlgeschlagen!
    cd ..
    pause
    exit /b 1
)
cd ..

REM Install frontend dependencies
echo [2/4] Installiere Frontend Dependencies...
cd frontend
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Frontend Installation fehlgeschlagen!
    cd ..
    pause
    exit /b 1
)
cd ..

REM Build frontend
echo [3/4] Baue Frontend...
cd frontend
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Frontend Build fehlgeschlagen!
    cd ..
    pause
    exit /b 1
)
cd ..

REM Start backend server with auto-restart on exit code 100
echo [4/4] Starte Server...
echo   Erreichbar unter: http://localhost:3001
echo   STRG+C zum Beenden
echo.

cd backend

:server_loop
call node src/server.js
set EXIT_CODE=%ERRORLEVEL%

if %EXIT_CODE% EQU 100 (
    echo.
    echo   Server wird neu gestartet...
    echo.
    timeout /t 1 /nobreak >nul
    goto server_loop
)

cd ..
pause
```

### Linux-Variante (`start.sh`):
```bash
#!/bin/bash
cd "$(dirname "$0")"

echo "========================================="
echo "  Meine App - Server Start"
echo "========================================="

# Install dependencies
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

# Build frontend
cd frontend && npm run build && cd ..

# Start with auto-restart loop
cd backend
while true; do
    node src/server.js
    EXIT_CODE=$?
    if [ $EXIT_CODE -ne 100 ]; then
        echo "Server stopped with exit code $EXIT_CODE"
        break
    fi
    echo "Server wird neu gestartet..."
    sleep 1
done
```

---

## 11. CSS/Design

### `UpdateSettings.css` (Vollständig)

```css
.update-settings-page {
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
}

.settings-section {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
}

.settings-section h2 {
  font-size: 1.25rem;
  margin-bottom: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.section-description {
  color: var(--text-secondary);
  margin-bottom: 1rem;
  font-size: 0.9rem;
}

/* Git Info Box */
.git-info {
  background-color: var(--bg-tertiary);
  padding: 1rem;
  border-radius: 0.375rem;
}

.info-row {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
}

.info-label {
  font-weight: 500;
  color: var(--text-secondary);
}

.info-value {
  color: var(--text-primary);
  font-family: 'Courier New', monospace;
}

/* Entwickler-Bereich (gelber Rahmen) */
.developer-section {
  border: 2px solid #fbbf24;
}

.section-header-with-toggle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.toggle-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: #fbbf24;
  color: #78350f;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.toggle-btn:hover {
  background: #f59e0b;
}

/* Formulare */
.update-form,
.branch-update-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-weight: 500;
  color: var(--text-primary);
}

.input-with-icon {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
  transition: border-color 0.2s;
}

.input-with-icon:focus-within {
  border-color: var(--accent-primary);
}

.input-with-icon svg {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.input-with-icon input {
  border: none;
  outline: none;
  flex: 1;
  font-size: 1rem;
  background: transparent;
  color: var(--text-primary);
}

/* Select Dropdown */
.select-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.select-input {
  width: 100%;
  padding: 0.625rem 2.5rem 0.625rem 0.875rem;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
  color: var(--text-primary);
  font-size: 0.9rem;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  transition: border-color 0.2s;
}

.select-input:focus {
  outline: none;
  border-color: var(--accent-primary);
}

.select-input option {
  background-color: var(--bg-secondary);
  color: var(--text-primary);
}

.select-icon {
  position: absolute;
  right: 0.75rem;
  color: var(--text-secondary);
  pointer-events: none;
}

/* Buttons */
.update-actions {
  display: flex;
  gap: 1rem;
  margin-top: 1rem;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  border: none;
  border-radius: 0.375rem;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background-color: var(--accent-primary);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background-color: var(--accent-hover);
}

.btn-secondary {
  background-color: var(--bg-hover);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover:not(:disabled) {
  background-color: var(--bg-tertiary);
}

/* Fehler-Meldung */
.error-message {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background-color: rgba(220, 38, 38, 0.15);
  color: #fca5a5;
  padding: 1rem;
  border-radius: 0.375rem;
  border: 1px solid rgba(220, 38, 38, 0.3);
}

/* Restart-Modal (Fullscreen Overlay mit Spinner) */
.update-restart-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.update-restart-content {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  padding: 3rem;
  border-radius: 0.75rem;
  text-align: center;
  max-width: 500px;
}

.update-restart-content h2 {
  margin-top: 1rem;
  margin-bottom: 1rem;
  color: var(--text-primary);
}

.update-restart-content p {
  color: var(--text-secondary);
  line-height: 1.6;
}

.spinner {
  width: 50px;
  height: 50px;
  margin: 0 auto;
  border: 4px solid var(--bg-tertiary);
  border-top: 4px solid var(--accent-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.spinning {
  animation: spin 1s linear infinite;
}

/* GitHub Token Status */
.github-token-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.token-configured,
.token-not-configured {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  border-radius: 0.375rem;
  font-size: 0.9rem;
  font-weight: 500;
}

.token-configured {
  background-color: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: #86efac;
}

.token-not-configured {
  background-color: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #fca5a5;
}
```

### CSS-Variablen (benötigt):
```css
/* Beispiel für Dark Theme - in deiner globalen CSS-Datei definieren */
:root {
  --bg-primary: #0f172a;
  --bg-secondary: #1e293b;
  --bg-tertiary: #334155;
  --bg-hover: #475569;
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --border-color: #475569;
  --accent-primary: #3b82f6;
  --accent-hover: #2563eb;
}
```

---

## 12. Mögliche Probleme & Lösungen

### Problem 1: `process.exit(100)` wird nicht als Restart erkannt
**Ursache:** Das Start-Script prüft den Exit-Code nicht.
**Lösung:** Sicherstellen, dass `start.bat` die `:server_loop` Logik hat (siehe Abschnitt 10).

### Problem 2: Git-Operationen schlagen fehl (Permission Denied)
**Ursache:** Kein SSH-Key oder Token konfiguriert für private Repos.
**Lösung:** GitHub Token über das Token-Modal konfigurieren. Dann in Git-URL einsetzen:
```javascript
// Vor dem fetch/pull den Token in die URL einsetzen:
const token = db.prepare('SELECT github_token FROM settings WHERE id = 1').get()?.github_token;
if (token) {
  execSync(`git remote set-url origin https://${token}@github.com/${GITHUB_OWNER}/${GITHUB_REPO}.git`, { cwd: projectRoot });
}
```

### Problem 3: Frontend zeigt "Server wird aktualisiert" endlos
**Ursache:** Der Server kommt nicht wieder hoch (z.B. weil `npm install` oder `npm run build` fehlschlägt).
**Lösung:**
- Logs im Terminal prüfen
- `process.exit(1)` im catch-Block (statt 100) verhindert Endlos-Restarts
- Manuell auf dem Server nachschauen und ggf. `npm install` / `npm run build` manuell ausführen

### Problem 4: `git stash` verliert lokale Änderungen
**Ursache:** `git stash` speichert Änderungen, aber sie werden nicht wiederhergestellt.
**Lösung:** Das ist beabsichtigt - auf einem Produktions-Server sollte es keine lokalen Änderungen geben. Falls doch:
```bash
git stash list    # Gespeicherte Stashes anzeigen
git stash pop     # Letzten Stash wiederherstellen
```

### Problem 5: Detached HEAD nach Version-Update
**Ursache:** `git checkout "v1.0.0"` wechselt in den "detached HEAD" Zustand.
**Lösung:** Das ist normal! Die App funktioniert trotzdem. Wenn man zurück zu einem Branch will:
```bash
git checkout main
```

### Problem 6: `git fetch` schlägt fehl wegen fehlendem Internet
**Ursache:** Server hat keine Internetverbindung.
**Lösung:** Alle `execSync('git fetch ...')` Aufrufe sind in try/catch gewrappt. Die Tags-/Branches-Liste zeigt dann nur die lokal bekannten Einträge.

### Problem 7: `npm install` schlägt bei nativen Modulen fehl (z.B. better-sqlite3)
**Ursache:** Fehlende Build-Tools (Python, C++ Compiler) auf Windows.
**Lösung:** Bei Node.js Installation "Automatically install the necessary tools" aktivieren, oder:
```bash
npm install --global windows-build-tools
```

### Problem 8: Response wird nicht gesendet bevor Server sich beendet
**Ursache:** `process.exit(100)` wird zu schnell aufgerufen.
**Lösung:** Der 1-Sekunden `setTimeout` stellt sicher, dass die Response gesendet wird. Falls nötig, erhöhe auf 2000ms.

### Problem 9: Mehrere User lösen gleichzeitig ein Update aus
**Ursache:** Kein Lock-Mechanismus.
**Lösung:** Einen einfachen Lock implementieren:
```javascript
let updateInProgress = false;

const triggerUpdate = async (req, res) => {
  if (updateInProgress) {
    return res.status(409).json({ error: 'Ein Update läuft bereits' });
  }
  updateInProgress = true;
  // ... rest of update logic
};
```

### Problem 10: Sicherheitsbedenken - Passwort im Klartext
**Ursache:** Das Entwickler-Passwort ist hardcoded im Controller.
**Lösung:** Passwort in `.env` Datei auslagern:
```javascript
// .env
DEV_PASSWORD=mein_sicheres_passwort

// Controller
const DEV_PASSWORD = process.env.DEV_PASSWORD || 'default_password';
```

### Problem 11: Passwort wird als Query-Parameter gesendet (sichtbar in Logs)
**Ursache:** `GET /api/system/branches?password=xxx` zeigt das PW in Server-Logs.
**Lösung:** Auf POST umstellen oder als Header senden:
```javascript
// Frontend:
const response = await fetch('/api/system/branches', {
  headers: { 'X-Dev-Password': devPassword }
});

// Backend:
const password = req.headers['x-dev-password'];
```

---

## 13. Anpassung für andere Projekte

### Checkliste:
1. **`systemController.js`**: `GITHUB_OWNER` und `GITHUB_REPO` anpassen
2. **`systemController.js`**: `DEV_PASSWORD` anpassen (besser: in `.env`)
3. **`package.json`**: `version` Feld pflegen (Semantic Versioning)
4. **Datenbank**: `settings` Tabelle mit `github_token` Spalte anlegen
5. **`server.js`**: Routes registrieren + Health-Check Endpoint
6. **`start.bat` / `start.sh`**: Die `:server_loop` / `while true` Logik einbauen
7. **Frontend**: `UpdateSettings` und `UpdateNotification` als React-Komponenten einbinden
8. **CSS**: CSS-Variablen an dein Theme anpassen
9. **npm**: `lucide-react`, `axios`, `better-sqlite3`, `fs-extra` installieren

### Minimale Integration (nur Versions-Update):
Wenn du nur das Tag-basierte Update brauchst, benötigst du:
- Backend: `getGitInfo`, `getTags`, `triggerVersionUpdate`, Health-Endpoint
- Frontend: `UpdateSettings` (ohne den Branch-Update-Teil)
- Start-Script: Die Exit-Code-100-Loop
- Kein GitHub-Token nötig (falls öffentliches Repo)

### Projektstruktur:
```
mein-projekt/
├── start.bat                    ← Start-Script mit Restart-Loop
├── backend/
│   ├── package.json             ← version: "1.0.0"
│   └── src/
│       ├── server.js            ← Express + Health-Check
│       ├── config/
│       │   └── database.js      ← SQLite Connection
│       ├── routes/
│       │   ├── system.js        ← System-Routes
│       │   └── github.js        ← Token-Routes
│       └── controllers/
│           └── systemController.js  ← Update-Logik
├── frontend/
│   ├── package.json
│   └── src/
│       ├── pages/
│       │   ├── UpdateSettings.jsx
│       │   └── UpdateSettings.css
│       └── components/
│           ├── UpdateNotification.jsx
│           ├── UpdateNotification.css
│           ├── GitHubTokenModal.jsx
│           └── GitHubTokenModal.css
└── .env                         ← GITHUB_TOKEN, DEV_PASSWORD
```
