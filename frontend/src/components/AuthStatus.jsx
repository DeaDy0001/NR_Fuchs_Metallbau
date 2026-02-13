import { useState, useEffect } from 'react';
import { LogIn, LogOut, CheckCircle, AlertCircle, Settings as SettingsIcon } from 'lucide-react';
import CredentialsModal from './CredentialsModal';
import './AuthStatus.css';

function AuthStatus() {
  const [authStatus, setAuthStatus] = useState(null);
  const [credentialsConfigured, setCredentialsConfigured] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);

  useEffect(() => {
    checkCredentials();
    checkAuthStatus();

    // Listen for auth success from popup window
    const handleMessage = (event) => {
      if (event.data.type === 'AUTH_SUCCESS') {
        console.log('Auth success received from popup');
        checkAuthStatus();
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const checkCredentials = async () => {
    try {
      const response = await fetch('/api/auth/credentials/status');
      if (response.ok) {
        const data = await response.json();
        setCredentialsConfigured(data.configured);
      }
    } catch (error) {
      console.error('Failed to check credentials:', error);
      setCredentialsConfigured(false);
    }
  };

  const checkAuthStatus = async () => {
    try {
      const response = await fetch('/api/auth/status');
      if (response.ok) {
        const data = await response.json();
        setAuthStatus(data);
      }
    } catch (error) {
      console.error('Failed to check auth status:', error);
      setAuthStatus({ authenticated: false, error: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = () => {
    // Open auth URL in popup window
    const width = 600;
    const height = 700;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    window.open(
      '/api/auth/google',
      'Google Login',
      `width=${width},height=${height},left=${left},top=${top}`
    );
  };

  const handleLogout = async () => {
    if (!confirm('Möchtest du dich wirklich abmelden?')) return;

    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (response.ok) {
        setAuthStatus({ authenticated: false });
      }
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const handleCredentialsSaved = () => {
    setCredentialsConfigured(true);
    checkAuthStatus();
  };

  if (loading || credentialsConfigured === null) {
    return (
      <div className="auth-status-card auth-status-loading">
        <div className="auth-spinner"></div>
        <span>Prüfe Authentifizierung...</span>
      </div>
    );
  }

  // Show credentials configuration if not configured
  if (!credentialsConfigured) {
    return (
      <>
        <div className="auth-status-card auth-status-error">
          <div className="auth-status-icon">
            <AlertCircle size={24} />
          </div>
          <div className="auth-status-content">
            <h3>⚠️ Google Credentials fehlen</h3>
            <p>
              Um die Google Drive Synchronisation zu nutzen, müssen zuerst OAuth 2.0 Credentials konfiguriert werden.
            </p>
            <p className="auth-note">
              <strong>Hinweis:</strong> Dies ist nur einmalig bei der ersten Installation notwendig!
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setShowCredentialsModal(true)}
          >
            <SettingsIcon size={18} />
            Credentials konfigurieren
          </button>
        </div>

        <CredentialsModal
          isOpen={showCredentialsModal}
          onClose={() => setShowCredentialsModal(false)}
          onSave={handleCredentialsSaved}
        />
      </>
    );
  }

  if (!authStatus) {
    return null;
  }

  if (authStatus.authenticated) {
    return (
      <div className="auth-status-card auth-status-success">
        <div className="auth-status-icon">
          <CheckCircle size={24} />
        </div>
        <div className="auth-status-content">
          <h3>✅ Mit Google angemeldet</h3>
          <p>{authStatus.message}</p>
          {authStatus.expiresIn && (
            <p className="auth-expires">Token läuft ab in {authStatus.expiresIn} Minuten</p>
          )}
        </div>
        <div className="auth-status-actions">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowCredentialsModal(true)}
            title="Credentials ändern"
          >
            <SettingsIcon size={16} />
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
            <LogOut size={16} />
            Abmelden
          </button>
        </div>

        <CredentialsModal
          isOpen={showCredentialsModal}
          onClose={() => setShowCredentialsModal(false)}
          onSave={handleCredentialsSaved}
        />
      </div>
    );
  }

  return (
    <>
      <div className="auth-status-card auth-status-warning">
        <div className="auth-status-icon">
          <AlertCircle size={24} />
        </div>
        <div className="auth-status-content">
          <h3>🔐 Google Login erforderlich</h3>
          <p>Melde dich mit deinem Google-Konto an, um Drive zu synchronisieren.</p>
          <p className="auth-note">
            <strong>Hinweis:</strong> Du musst nur einmal anmelden. Deine Anmeldung bleibt dauerhaft gespeichert!
          </p>
        </div>
        <div className="auth-status-actions">
          <button
            className="btn btn-secondary"
            onClick={() => setShowCredentialsModal(true)}
            title="Credentials ändern"
          >
            <SettingsIcon size={18} />
          </button>
          <button className="btn btn-primary" onClick={handleLogin}>
            <LogIn size={18} />
            Mit Google anmelden
          </button>
        </div>
      </div>

      <CredentialsModal
        isOpen={showCredentialsModal}
        onClose={() => setShowCredentialsModal(false)}
        onSave={handleCredentialsSaved}
      />
    </>
  );
}

export default AuthStatus;
