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

    // Basic validation for GitHub token format
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
        <button
          className="github-token-modal-close"
          onClick={handleClose}
          disabled={loading}
        >
          <X size={24} />
        </button>

        <div className="github-token-modal-content">
          <div className="modal-header">
            <Key size={32} className="github-icon" />
            <h2>GitHub Personal Access Token</h2>
          </div>

          <p className="github-token-description">
            Um Git-Push-Operationen durchzuführen, benötigst du einen Personal Access Token von GitHub.
          </p>

          <div className="github-token-help-box">
            <AlertCircle size={20} />
            <div>
              <strong>So erstellst du einen Token:</strong>
              <ol>
                <li>Gehe zu GitHub Settings → Developer settings</li>
                <li>Wähle "Personal access tokens" → "Tokens (classic)"</li>
                <li>Klicke auf "Generate new token (classic)"</li>
                <li>Gib dem Token einen Namen (z.B. "Local Network App")</li>
                <li>Wähle mindestens den Scope: <code>repo</code></li>
                <li>Klicke "Generate token" und kopiere ihn</li>
              </ol>
              <p className="warning-note">
                ⚠️ Der Token wird nur einmal angezeigt! Speichere ihn sicher.
              </p>
            </div>
          </div>

          <div className="github-token-links">
            <a
              href="https://github.com/settings/tokens/new"
              target="_blank"
              rel="noopener noreferrer"
              className="github-token-link"
            >
              <ExternalLink size={18} />
              GitHub Token erstellen
            </a>
            <a
              href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="github-token-link secondary"
            >
              <ExternalLink size={18} />
              GitHub Dokumentation
            </a>
          </div>

          <form onSubmit={handleSubmit} className="github-token-form">
            <div className="form-group">
              <label htmlFor="token">
                Personal Access Token
                <span className="required">*</span>
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
              <small className="input-hint">
                Der Token beginnt mit "ghp_" oder "github_pat_"
              </small>
            </div>

            {error && (
              <div className="github-token-error">
                <AlertCircle size={18} />
                {error}
              </div>
            )}

            {success && (
              <div className="github-token-success">
                <CheckCircle size={18} />
                Token erfolgreich gespeichert!
              </div>
            )}

            <div className="github-token-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleClose}
                disabled={loading}
              >
                Abbrechen
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || success}
              >
                {loading ? (
                  <>
                    <Loader size={18} className="spinning" />
                    Speichern...
                  </>
                ) : success ? (
                  <>
                    <CheckCircle size={18} />
                    Gespeichert!
                  </>
                ) : (
                  <>
                    <Key size={18} />
                    Token speichern
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default GitHubTokenModal;
