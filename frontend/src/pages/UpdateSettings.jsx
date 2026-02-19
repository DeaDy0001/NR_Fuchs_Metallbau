import { useState, useEffect } from 'react';
import { Download, RefreshCw, AlertCircle, GitBranch, Lock } from 'lucide-react';
import './UpdateSettings.css';

function UpdateSettings() {
  const [versionInfo, setVersionInfo] = useState(null);
  const [gitInfo, setGitInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');

  // Branch update
  const [branchName, setBranchName] = useState('');
  const [devPassword, setDevPassword] = useState('');
  const [showBranchUpdate, setShowBranchUpdate] = useState(false);

  useEffect(() => {
    loadVersionInfo();
    loadGitInfo();
  }, []);

  const loadVersionInfo = async () => {
    try {
      const response = await fetch('/api/system/version');
      if (response.ok) {
        const data = await response.json();
        setVersionInfo(data);
      }
    } catch (error) {
      console.error('Error loading version info:', error);
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

  const handleCheckForUpdates = async () => {
    setLoading(true);
    setError('');
    try {
      await loadVersionInfo();
      await loadGitInfo();
    } catch (error) {
      setError('Fehler beim Prüfen auf Updates');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!window.confirm('Server wird aktualisiert und neugestartet. Fortfahren?')) {
      return;
    }

    setUpdating(true);
    setError('');

    try {
      const response = await fetch('/api/system/update', {
        method: 'POST'
      });

      if (response.ok) {
        showRestartMessage();
      } else {
        throw new Error('Update fehlgeschlagen');
      }
    } catch (error) {
      setError('Update konnte nicht durchgeführt werden: ' + error.message);
      setUpdating(false);
    }
  };

  const handleBranchUpdate = async () => {
    if (!branchName || !devPassword) {
      setError('Bitte Branch-Name und Passwort eingeben');
      return;
    }

    if (devPassword !== 'netrock!') {
      setError('Falsches Entwickler-Passwort');
      return;
    }

    if (!window.confirm(`Server wird von Branch "${branchName}" aktualisiert und neugestartet. Fortfahren?`)) {
      return;
    }

    setUpdating(true);
    setError('');

    try {
      const response = await fetch('/api/system/update-branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: branchName, password: devPassword })
      });

      if (response.ok) {
        showRestartMessage();
      } else {
        const data = await response.json();
        throw new Error(data.error || 'Branch-Update fehlgeschlagen');
      }
    } catch (error) {
      setError('Branch-Update konnte nicht durchgeführt werden: ' + error.message);
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

  return (
    <div className="update-settings-page">
      <div className="page-header">
        <h1>Update Einstellungen</h1>
      </div>

      {/* Version Info */}
      <div className="settings-section">
        <h2>Version</h2>
        {versionInfo ? (
          <div className="version-info">
            <div className="info-row">
              <span className="info-label">Aktuelle Version:</span>
              <span className="info-value">{versionInfo.currentVersion}</span>
            </div>
            {versionInfo.latestVersion && (
              <div className="info-row">
                <span className="info-label">Neueste Version:</span>
                <span className="info-value">{versionInfo.latestVersion}</span>
              </div>
            )}
            {versionInfo.updateAvailable && (
              <div className="update-available-badge">
                <Download size={16} />
                Update verfügbar
              </div>
            )}
          </div>
        ) : (
          <div className="loading-state">Lade Versionsinformationen...</div>
        )}
      </div>

      {/* Git Info */}
      {gitInfo && (
        <div className="settings-section">
          <h2>Git Information</h2>
          <div className="git-info">
            <div className="info-row">
              <span className="info-label">Branch:</span>
              <span className="info-value">{gitInfo.branch}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Commit:</span>
              <span className="info-value">{gitInfo.commit}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Commit Message:</span>
              <span className="info-value">{gitInfo.commitMessage}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Commit Datum:</span>
              <span className="info-value">{new Date(gitInfo.commitDate).toLocaleString('de-DE')}</span>
            </div>
          </div>
        </div>
      )}

      {/* Standard Update */}
      <div className="settings-section">
        <h2>Auf Updates prüfen</h2>
        <p className="section-description">
          Prüft auf neue Versionen im main-Branch des GitHub-Repositories
        </p>

        <div className="update-actions">
          <button
            className="btn btn-secondary"
            onClick={handleCheckForUpdates}
            disabled={loading}
          >
            <RefreshCw size={18} className={loading ? 'spinning' : ''} />
            {loading ? 'Prüfe...' : 'Jetzt prüfen'}
          </button>

          {versionInfo?.updateAvailable && (
            <button
              className="btn btn-primary"
              onClick={handleUpdate}
              disabled={updating}
            >
              <Download size={18} />
              {updating ? 'Wird aktualisiert...' : 'Jetzt aktualisieren'}
            </button>
          )}
        </div>

        {versionInfo?.releaseNotes && (
          <div className="release-notes">
            <h3>Release Notes:</h3>
            <pre>{versionInfo.releaseNotes}</pre>
          </div>
        )}
      </div>

      {/* Branch Update (Developer) */}
      <div className="settings-section developer-section">
        <div className="section-header-with-toggle">
          <h2>Branch Update (Entwickler)</h2>
          <button
            className="toggle-btn"
            onClick={() => setShowBranchUpdate(!showBranchUpdate)}
          >
            <Lock size={18} />
            {showBranchUpdate ? 'Verbergen' : 'Anzeigen'}
          </button>
        </div>

        {showBranchUpdate && (
          <>
            <p className="section-description">
              Aktualisiert von einem spezifischen Branch (nur für Entwickler)
            </p>

            <div className="branch-update-form">
              <div className="form-group">
                <label>Branch Name</label>
                <div className="input-with-icon">
                  <GitBranch size={18} />
                  <input
                    type="text"
                    placeholder="z.B. feature/new-feature"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    className="input"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Entwickler-Passwort</label>
                <div className="input-with-icon">
                  <Lock size={18} />
                  <input
                    type="password"
                    placeholder="Passwort eingeben"
                    value={devPassword}
                    onChange={(e) => setDevPassword(e.target.value)}
                    className="input"
                  />
                </div>
              </div>

              <button
                className="btn btn-primary"
                onClick={handleBranchUpdate}
                disabled={updating || !branchName || !devPassword}
              >
                <GitBranch size={18} />
                {updating ? 'Wird aktualisiert...' : 'Von Branch aktualisieren'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="error-message">
          <AlertCircle size={18} />
          {error}
        </div>
      )}
    </div>
  );
}

export default UpdateSettings;
