import { useState, useEffect } from 'react';
import { Download, RefreshCw, AlertCircle, ChevronDown, FileText, Calendar, ExternalLink } from 'lucide-react';
import './UpdateSettings.css';

function UpdateSettings({ onCheckForUpdates, initialVersion }) {
  const [gitInfo, setGitInfo] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');

  // Version update (Tags)
  const [tags, setTags] = useState([]);
  const [selectedTag, setSelectedTag] = useState('');
  const [currentVersion, setCurrentVersion] = useState('');
  const [loadingTags, setLoadingTags] = useState(false);

  // Release notes
  const [releases, setReleases] = useState([]);

  useEffect(() => {
    loadGitInfo();
    loadTags();
    loadReleases();
  }, []);

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

        // Auto-select version from prop (e.g. when opened from update badge)
        if (initialVersion) {
          const matchingTag = data.tags.find(t => t.name === initialVersion);
          if (matchingTag) {
            setSelectedTag(matchingTag.name);
          }
        } else if (data.currentVersion) {
          // Pre-select the current version in the dropdown
          const currentTag = data.tags.find(t =>
            t.name === `v${data.currentVersion}` || t.name === data.currentVersion
          );
          if (currentTag) {
            setSelectedTag(currentTag.name);
          }
        }
      }
    } catch (err) {
      console.error('Error loading tags:', err);
    } finally {
      setLoadingTags(false);
    }

    // Trigger update check to refresh badge in header
    if (onCheckForUpdates) {
      onCheckForUpdates();
    }
  };

  const loadReleases = async () => {
    try {
      const response = await fetch('/api/system/releases');
      if (response.ok) {
        const data = await response.json();
        setReleases(data.releases || []);
      }
    } catch (err) {
      console.error('Error loading releases:', err);
    }
  };

  // Get the release matching the selected tag
  const getSelectedRelease = () => {
    if (!selectedTag) return null;
    return releases.find(r => r.tagName === selectedTag);
  };

  // Simple markdown-like rendering for release notes
  const renderReleaseBody = (body) => {
    if (!body) return null;

    return body.split('\n').map((line, i) => {
      // Headers
      if (line.startsWith('### ')) {
        return <h4 key={i} className="release-body-h3">{line.replace('### ', '')}</h4>;
      }
      if (line.startsWith('## ')) {
        return <h3 key={i} className="release-body-h2">{line.replace('## ', '')}</h3>;
      }
      // List items
      if (line.startsWith('- ') || line.startsWith('* ')) {
        return <li key={i} className="release-body-li">{line.replace(/^[-*] /, '')}</li>;
      }
      // Bold text handling
      if (line.includes('**')) {
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        return (
          <p key={i} className="release-body-p">
            {parts.map((part, j) =>
              part.startsWith('**') && part.endsWith('**')
                ? <strong key={j}>{part.slice(2, -2)}</strong>
                : part
            )}
          </p>
        );
      }
      // Empty lines
      if (line.trim() === '') {
        return <div key={i} className="release-body-spacer" />;
      }
      // Normal text
      return <p key={i} className="release-body-p">{line}</p>;
    });
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
              <span className="info-value version-highlight">{gitInfo.version}</span>
            </div>
            {gitInfo.buildDate && (
              <div className="info-row">
                <span className="info-label">Build-Datum:</span>
                <span className="info-value">{new Date(gitInfo.buildDate).toLocaleString('de-DE')}</span>
              </div>
            )}
            {gitInfo.branch !== 'unknown' && gitInfo.branch !== 'release' && (
              <div className="info-row">
                <span className="info-label">Branch:</span>
                <span className="info-value">{gitInfo.branch}</span>
              </div>
            )}
            {gitInfo.commit && gitInfo.commit !== 'N/A' && (
              <div className="info-row">
                <span className="info-label">Commit:</span>
                <span className="info-value">{gitInfo.commit}</span>
              </div>
            )}
            {gitInfo.commitMessage && gitInfo.commitMessage !== 'Keine Git-Informationen verfügbar' && (
              <div className="info-row">
                <span className="info-label">{gitInfo.isRelease ? 'Release-Informationen:' : 'Letzte Änderung:'}</span>
                <span className="info-value commit-message">
                  {gitInfo.isRelease ? (
                    <div className="release-notes-preview">
                      {renderReleaseBody(gitInfo.releaseNotes)}
                    </div>
                  ) : (
                    gitInfo.commitMessage.split('\n')[0]
                  )}
                </span>
              </div>
            )}
            {gitInfo.commitDate && (
              <div className="info-row">
                <span className="info-label">Letztes Update:</span>
                <span className="info-value">{new Date(gitInfo.commitDate).toLocaleString('de-DE')}</span>
              </div>
            )}
            {gitInfo.source === 'build-info-release' && (
              <div className="info-row release-badge">
                <span className="release-indicator">📦 Release Build</span>
              </div>
            )}
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

          {/* Release Notes for selected version */}
          {getSelectedRelease() && (
            <div className="release-notes-card">
              <div className="release-notes-header">
                <div className="release-notes-title">
                  <FileText size={18} />
                  <h3>{getSelectedRelease().name}</h3>
                </div>
                <div className="release-notes-meta">
                  {getSelectedRelease().publishedAt && (
                    <span className="release-date">
                      <Calendar size={14} />
                      {new Date(getSelectedRelease().publishedAt).toLocaleDateString('de-DE', {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric'
                      })}
                    </span>
                  )}
                  {getSelectedRelease().htmlUrl && (
                    <a
                      href={getSelectedRelease().htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="release-github-link"
                    >
                      <ExternalLink size={14} />
                      GitHub
                    </a>
                  )}
                </div>
              </div>
              {getSelectedRelease().body ? (
                <div className="release-notes-body">
                  {renderReleaseBody(getSelectedRelease().body)}
                </div>
              ) : (
                <p className="release-notes-empty">Keine Release-Notes vorhanden.</p>
              )}
            </div>
          )}
        </div>
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
