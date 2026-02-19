import { useState } from 'react';
import { X, ExternalLink, AlertCircle, CheckCircle, Loader, RefreshCw } from 'lucide-react';
import './CredentialsModal.css';

function CredentialsModal({ isOpen, onClose, onSave }) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [restarting, setRestarting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (!clientId || !clientSecret) {
      setError('Bitte fülle beide Felder aus');
      return;
    }

    // Basic validation
    if (!clientId.endsWith('.apps.googleusercontent.com')) {
      setError('Client ID muss mit ".apps.googleusercontent.com" enden');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/auth/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          clientSecret
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Fehler beim Speichern');
      }

      const data = await response.json();
      setSuccess(true);

      if (data.restarting) {
        // Server is restarting - wait for it to come back
        setRestarting(true);

        const waitForServer = async () => {
          const maxAttempts = 20;
          for (let i = 0; i < maxAttempts; i++) {
            await new Promise(r => setTimeout(r, 1500));
            try {
              const health = await fetch('/api/health');
              if (health.ok) {
                setRestarting(false);
                onSave?.();
                onClose();
                return;
              }
            } catch {
              // Server still restarting
            }
          }
          // Timeout - server didn't come back
          setRestarting(false);
          setError('Server antwortet nicht. Bitte manuell neu starten.');
        };

        waitForServer();
      } else {
        setTimeout(() => {
          onSave?.();
          onClose();
        }, 2000);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setClientId('');
      setClientSecret('');
      setError('');
      setSuccess(false);
      onClose();
    }
  };

  return (
    <div className="credentials-modal-overlay" onClick={handleClose}>
      <div className="credentials-modal" onClick={(e) => e.stopPropagation()}>
        <button
          className="credentials-modal-close"
          onClick={handleClose}
          disabled={loading}
        >
          <X size={24} />
        </button>

        <div className="credentials-modal-content">
          <h2>🔐 Google OAuth Credentials</h2>

          <p className="credentials-description">
            Um die Google Drive Synchronisation zu nutzen, benötigst du OAuth 2.0 Credentials aus der Google Cloud Console.
          </p>

          <div className="credentials-help-box">
            <AlertCircle size={20} />
            <div>
              <strong>So bekommst du die Credentials:</strong>
              <ol>
                <li>Gehe zur Google Cloud Console</li>
                <li>Erstelle ein neues Projekt oder wähle ein bestehendes</li>
                <li>Aktiviere die Google Drive API</li>
                <li>Erstelle OAuth 2.0 Client ID (Webanwendung)</li>
                <li>Kopiere Client ID und Client Secret hierher</li>
              </ol>
            </div>
          </div>

          <div className="credentials-links">
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noopener noreferrer"
              className="credentials-link"
            >
              <ExternalLink size={18} />
              Google Cloud Console öffnen
            </a>
            <div className="credentials-link-row">
              <a
                href="/GOOGLE_OAUTH_SETUP.md"
                target="_blank"
                rel="noopener noreferrer"
                className="credentials-link secondary"
              >
                <ExternalLink size={18} />
                Setup-Anleitung
              </a>
              <a
                href="/TROUBLESHOOTING_OAUTH.md"
                target="_blank"
                rel="noopener noreferrer"
                className="credentials-link secondary"
              >
                <ExternalLink size={18} />
                Troubleshooting
              </a>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="credentials-form">
            <div className="form-group">
              <label htmlFor="clientId">
                Client ID
                <span className="required">*</span>
              </label>
              <input
                id="clientId"
                type="text"
                className="input"
                placeholder="123456789-abc...xyz.apps.googleusercontent.com"
                value={clientId}
                onChange={(e) => setClientId(e.target.value.trim())}
                disabled={loading || success}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="clientSecret">
                Client Secret
                <span className="required">*</span>
              </label>
              <input
                id="clientSecret"
                type="password"
                className="input"
                placeholder="GOCSPX-..."
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value.trim())}
                disabled={loading || success}
                required
              />
            </div>

            {error && (
              <div className="credentials-error">
                <AlertCircle size={18} />
                {error}
              </div>
            )}

            {success && !restarting && (
              <div className="credentials-success">
                <CheckCircle size={18} />
                Credentials erfolgreich gespeichert!
              </div>
            )}

            {restarting && (
              <div className="credentials-restarting">
                <RefreshCw size={18} className="spinning" />
                Server wird neu gestartet... Bitte warten.
              </div>
            )}

            <div className="credentials-actions">
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
                  'Speichern'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default CredentialsModal;
