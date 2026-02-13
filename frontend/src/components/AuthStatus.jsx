import { useState, useEffect } from 'react';
import { LogIn, LogOut, CheckCircle, AlertCircle } from 'lucide-react';
import './AuthStatus.css';

function AuthStatus() {
  const [authStatus, setAuthStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

  if (loading) {
    return (
      <div className="auth-status-card auth-status-loading">
        <div className="auth-spinner"></div>
        <span>Prüfe Authentifizierung...</span>
      </div>
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
        <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
          <LogOut size={16} />
          Abmelden
        </button>
      </div>
    );
  }

  return (
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
      <button className="btn btn-primary" onClick={handleLogin}>
        <LogIn size={18} />
        Mit Google anmelden
      </button>
    </div>
  );
}

export default AuthStatus;
