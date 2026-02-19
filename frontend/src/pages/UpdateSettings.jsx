import { useState, useEffect } from 'react';
import { Download, RefreshCw, AlertCircle, GitBranch, Lock, Tag, ChevronDown, Key, CheckCircle } from 'lucide-react';
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
    // Load GitHub token status when developer is authenticated
    if (devAuthenticated) {
      checkGitHubTokenStatus();
    }
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
    if (!devPassword) {
      setError('Bitte Passwort eingeben');
      return;
    }

    setLoadingBranches(true);
    setError('');

    try {
      const response = await fetch(`/api/system/branches?password=${encodeURIComponent(devPassword)}`);
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
    if (!selectedTag) {
      setError('Bitte eine Version auswählen');
      return;
    }

    if (!window.confirm(`Server wird auf Version "${selectedTag}" aktualisiert und neugestartet. Fortfahren?`)) {
      return;
    }

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
    if (!selectedBranch) {
      setError('Bitte einen Branch auswählen');
      return;
    }

    if (!window.confirm(`Server wird von Branch "${selectedBranch}" aktualisiert und neugestartet. Fortfahren?`)) {
      return;
    }

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
      {/* Git Info */}
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
              <span className="info-value">{new Date(gitInfo.commitDate).toLocaleString('de-DE')}</span>
            </div>
          </div>
        </div>
      )}

      {/* Version Update (Tags from main) */}
      <div className="settings-section">
        <h2>Versions-Update</h2>
        <p className="section-description">
          Wähle eine veröffentlichte Version aus, um darauf zu aktualisieren. Versionen werden vom main-Branch bereitgestellt.
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
                  {loadingTags ? 'Lade Versionen...' : tags.length === 0 ? 'Keine Versionen verfügbar' : '-- Version wählen --'}
                </option>
                {tags.map(tag => (
                  <option key={tag.name} value={tag.name}>
                    {tag.name}{tag.name === `v${currentVersion}` || tag.name === currentVersion ? ' (aktuell)' : ''}
                    {tag.date ? ` - ${new Date(tag.date).toLocaleDateString('de-DE')}` : ''}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} className="select-icon" />
            </div>
          </div>

          <div className="update-actions">
            <button
              className="btn btn-secondary"
              onClick={loadTags}
              disabled={loadingTags}
            >
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

      {/* Branch Update (Developer) */}
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

      {/* GitHub Token Configuration (Developer only) */}
      {devAuthenticated && (
        <div className="settings-section developer-section">
          <h2>GitHub Token Konfiguration</h2>
          <p className="section-description">
            Konfiguriere deinen GitHub Personal Access Token für Git-Push-Operationen.
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

      {/* Error Display */}
      {error && (
        <div className="error-message">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      <GitHubTokenModal
        isOpen={showGitHubTokenModal}
        onClose={() => setShowGitHubTokenModal(false)}
        onSave={() => {
          setGithubTokenConfigured(true);
        }}
      />
    </div>
  );
}

export default UpdateSettings;
