import { useState, useEffect } from 'react';
import { Lock, Key, Save, CheckCircle, XCircle, AlertCircle, RefreshCw, GitBranch, ChevronDown, ExternalLink } from 'lucide-react';
import GitHubTokenModal from '../components/GitHubTokenModal';
import './DevSettings.css';

function DevSettings() {
  // Password protection
  const [password, setPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState('');

  // Google Credentials
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [credentialsSaving, setCredentialsSaving] = useState(false);
  const [credentialsStatus, setCredentialsStatus] = useState(null);
  const [credentialsError, setCredentialsError] = useState('');
  const [credentialsSuccess, setCredentialsSuccess] = useState(false);
  const [restarting, setRestarting] = useState(false);

  // GitHub Token
  const [showGitHubTokenModal, setShowGitHubTokenModal] = useState(false);
  const [githubTokenConfigured, setGithubTokenConfigured] = useState(false);

  // Branch Update
  const [gitInfo, setGitInfo] = useState(null);
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [branchError, setBranchError] = useState('');

  const [notification, setNotification] = useState(null);

  const DEV_PASSWORD = 'netrock!"§$%&';

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const handleLogin = () => {
    if (password === DEV_PASSWORD) {
      setAuthenticated(true);
      setAuthError('');
      loadAllData();
    } else {
      setAuthError('Falsches Passwort');
    }
  };

  const loadAllData = () => {
    checkCredentialsStatus();
    checkGitHubTokenStatus();
    loadGitInfo();
    loadBranches();
  };

  const checkCredentialsStatus = async () => {
    try {
      const response = await fetch('/api/auth/credentials/status');
      if (response.ok) {
        const data = await response.json();
        setCredentialsStatus(data);
      }
    } catch (error) {
      console.error('Error checking credentials:', error);
    }
  };

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
    } catch (error) {
      console.error('Error loading git info:', error);
    }
  };

  const loadBranches = async () => {
    setLoadingBranches(true);
    try {
      const response = await fetch(`/api/system/branches?password=${encodeURIComponent(DEV_PASSWORD)}`);
      if (response.ok) {
        const data = await response.json();
        setBranches(data.branches);
        setSelectedBranch(data.currentBranch);
      }
    } catch (error) {
      console.error('Error loading branches:', error);
    } finally {
      setLoadingBranches(false);
    }
  };

  const handleSaveCredentials = async () => {
    setCredentialsError('');
    setCredentialsSuccess(false);

    if (!clientId || !clientSecret) {
      setCredentialsError('Bitte beide Felder ausfüllen');
      return;
    }

    if (!clientId.endsWith('.apps.googleusercontent.com')) {
      setCredentialsError('Client ID muss mit ".apps.googleusercontent.com" enden');
      return;
    }

    setCredentialsSaving(true);

    try {
      const response = await fetch('/api/auth/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Fehler beim Speichern');
      }

      const data = await response.json();
      setCredentialsSuccess(true);

      if (data.restarting) {
        setRestarting(true);
        const waitForServer = async () => {
          const maxAttempts = 20;
          for (let i = 0; i < maxAttempts; i++) {
            await new Promise(r => setTimeout(r, 1500));
            try {
              const health = await fetch('/api/health');
              if (health.ok) {
                setRestarting(false);
                setCredentialsSaving(false);
                showNotification('Google Credentials gespeichert! Server wurde neu gestartet.');
                checkCredentialsStatus();
                return;
              }
            } catch {
              // Server still restarting
            }
          }
          setRestarting(false);
          setCredentialsSaving(false);
          setCredentialsError('Server antwortet nicht. Bitte manuell neu starten.');
        };
        waitForServer();
      } else {
        setCredentialsSaving(false);
        showNotification('Google Credentials gespeichert!');
        checkCredentialsStatus();
      }
    } catch (err) {
      setCredentialsError(err.message);
      setCredentialsSaving(false);
    }
  };

  const handleBranchUpdate = async () => {
    if (!selectedBranch) {
      setBranchError('Bitte einen Branch auswählen');
      return;
    }

    if (!window.confirm(`Server wird von Branch "${selectedBranch}" aktualisiert und neugestartet. Fortfahren?`)) {
      return;
    }

    setUpdating(true);
    setBranchError('');

    try {
      const response = await fetch('/api/system/update-branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: selectedBranch, password: DEV_PASSWORD })
      });

      if (response.ok) {
        showRestartMessage();
      } else {
        const data = await response.json();
        throw new Error(data.error || 'Branch-Update fehlgeschlagen');
      }
    } catch (err) {
      setBranchError('Branch-Update fehlgeschlagen: ' + err.message);
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
        <p>Bitte warten. Die Seite lädt automatisch neu, sobald der Server wieder verfügbar ist.</p>
      </div>
    `;
    document.body.appendChild(modal);

    const checkServer = async () => {
      try {
        const response = await fetch('/api/health');
        if (response.ok) {
          window.location.reload();
        }
      } catch {
        setTimeout(checkServer, 2000);
      }
    };

    setTimeout(checkServer, 5000);
  };

  // Not authenticated - show password form
  if (!authenticated) {
    return (
      <div className="dev-settings-page">
        <div className="dev-login-card">
          <div className="dev-login-icon">
            <Lock size={32} />
          </div>
          <h2>Entwickler-Zugang</h2>
          <p className="dev-login-description">
            Passwort eingeben, um auf die Entwickler-Einstellungen zuzugreifen.
          </p>
          <div className="dev-login-form">
            <div className="dev-input-group">
              <Lock size={16} className="dev-input-icon" />
              <input
                type="password"
                placeholder="Passwort eingeben"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setAuthError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                autoFocus
              />
            </div>
            {authError && <p className="dev-error">{authError}</p>}
            <button
              className="btn btn-primary dev-login-btn"
              onClick={handleLogin}
              disabled={!password}
            >
              <Lock size={16} />
              Anmelden
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Authenticated - show dev settings
  return (
    <div className="dev-settings-page">
      {notification && (
        <div className={`notification notification-${notification.type}`}>
          {notification.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
          {notification.message}
        </div>
      )}

      {/* Section 1: Google Credentials (Bilder) */}
      <div className="settings-section">
        <div className="dev-section-label">Bilder</div>
        <h2>Google Credentials</h2>
        <p className="section-description">
          OAuth 2.0 Client-ID und Secret für die Google Drive Synchronisation und die Handy-App.
          Diese Credentials werden sowohl für den Google-Login in der Software als auch für die Handy-App verwendet.
        </p>

        {credentialsStatus?.configured && (
          <div className="dev-status-ok">
            <CheckCircle size={16} />
            <span>Google Credentials konfiguriert</span>
          </div>
        )}

        <div className="dev-credentials-form">
          <div className="dev-help-box">
            <AlertCircle size={18} />
            <div>
              <strong>So bekommst du die Credentials:</strong>
              <ol>
                <li>Gehe zur <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">Google Cloud Console <ExternalLink size={12} /></a></li>
                <li>Erstelle ein Projekt oder wähle ein bestehendes</li>
                <li>Aktiviere die Google Drive API</li>
                <li>Erstelle eine OAuth 2.0 Client ID (Webanwendung)</li>
                <li>Kopiere Client ID und Client Secret hierher</li>
              </ol>
            </div>
          </div>

          <div className="dev-input-group">
            <label>Client ID</label>
            <div className="dev-input-row">
              <Key size={16} className="dev-input-icon" />
              <input
                type="text"
                placeholder="...apps.googleusercontent.com"
                value={clientId}
                onChange={(e) => setClientId(e.target.value.trim())}
                disabled={credentialsSaving}
              />
            </div>
          </div>

          <div className="dev-input-group">
            <label>Client Secret</label>
            <div className="dev-input-row">
              <Lock size={16} className="dev-input-icon" />
              <input
                type="password"
                placeholder="GOCSPX-..."
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value.trim())}
                disabled={credentialsSaving}
              />
            </div>
          </div>

          {credentialsError && (
            <div className="dev-error-box">
              <AlertCircle size={16} />
              {credentialsError}
            </div>
          )}

          {credentialsSuccess && !restarting && (
            <div className="dev-success-box">
              <CheckCircle size={16} />
              Credentials gespeichert!
            </div>
          )}

          {restarting && (
            <div className="dev-restarting-box">
              <RefreshCw size={16} className="spinning" />
              Server wird neu gestartet... Bitte warten.
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={handleSaveCredentials}
            disabled={credentialsSaving || !clientId || !clientSecret}
          >
            <Save size={16} />
            {credentialsSaving ? 'Wird gespeichert...' : 'Credentials speichern'}
          </button>
        </div>
      </div>

      {/* Section 2: App Credentials (Handy App) */}
      <div className="settings-section">
        <div className="dev-section-label">Handy App</div>
        <h2>App Credentials</h2>
        <p className="section-description">
          GitHub Personal Access Token für Git-Push-Operationen und automatische Updates.
        </p>

        <div className="dev-github-token">
          {githubTokenConfigured ? (
            <div className="dev-status-ok">
              <CheckCircle size={16} />
              <span>GitHub Token konfiguriert</span>
            </div>
          ) : (
            <div className="dev-status-warn">
              <Key size={16} />
              <span>Kein GitHub Token konfiguriert</span>
            </div>
          )}
          <button
            className="btn btn-primary"
            onClick={() => setShowGitHubTokenModal(true)}
          >
            <Key size={16} />
            {githubTokenConfigured ? 'Token ändern' : 'Token einrichten'}
          </button>
        </div>
      </div>

      {/* Section 3: Branch Update */}
      <div className="settings-section">
        <div className="dev-section-label">Update</div>
        <h2>Branch Update</h2>
        <p className="section-description">
          Wähle einen Branch aus, um direkt davon zu aktualisieren.
        </p>

        {gitInfo && (
          <div className="dev-git-info">
            <span>Aktueller Branch: <strong>{gitInfo.branch}</strong></span>
            {gitInfo.commit && gitInfo.commit !== 'N/A' && (
              <span>Commit: <code>{gitInfo.commit}</code></span>
            )}
          </div>
        )}

        <div className="dev-branch-form">
          <div className="form-group">
            <label>Branch auswählen</label>
            <div className="select-wrapper">
              <select
                className="select-input"
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                disabled={updating || loadingBranches}
              >
                <option value="">
                  {loadingBranches ? 'Lade Branches...' : '-- Branch wählen --'}
                </option>
                {branches.map(branch => (
                  <option key={branch} value={branch}>
                    {branch}{branch === gitInfo?.branch ? ' (aktuell)' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} className="select-icon" />
            </div>
          </div>

          {branchError && (
            <div className="dev-error-box">
              <AlertCircle size={16} />
              {branchError}
            </div>
          )}

          <div className="dev-branch-actions">
            <button
              className="btn btn-secondary"
              onClick={loadBranches}
              disabled={loadingBranches}
            >
              <RefreshCw size={16} className={loadingBranches ? 'spinning' : ''} />
              Aktualisieren
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
      </div>

      <GitHubTokenModal
        isOpen={showGitHubTokenModal}
        onClose={() => setShowGitHubTokenModal(false)}
        onSave={() => {
          setGithubTokenConfigured(true);
          showNotification('GitHub Token gespeichert!');
        }}
      />
    </div>
  );
}

export default DevSettings;
