import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './LoginPage.css';

export default function LoginPage({ isSetup }) {
  const { refetch } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Magic link auto-login: check ?magic=<token> in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('magic');
    if (!token) return;

    // Remove token from URL immediately
    window.history.replaceState({}, '', window.location.pathname);

    setLoading(true);
    setError('');
    fetch(`/api/auth/user/magic?token=${encodeURIComponent(token)}`)
      .then(res => res.json().then(d => ({ ok: res.ok, d })))
      .then(({ ok, d }) => {
        if (ok) {
          refetch();
        } else {
          setError(d.error || 'Login-Link ungültig oder abgelaufen.');
          setLoading(false);
        }
      })
      .catch(() => {
        setError('Verbindungsfehler beim Verarbeiten des Login-Links.');
        setLoading(false);
      });
  }, [refetch]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const body = { email, password };
      if (isSetup && name.trim()) body.name = name.trim();

      const res = await fetch('/api/auth/user/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Anmeldung fehlgeschlagen');
        setLoading(false);
        return;
      }

      await refetch();
    } catch {
      setError('Verbindungsfehler. Bitte erneut versuchen.');
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <img src="/NR_Logo.png" alt="Logo" className="login-logo-img" />
        </div>

        <h1 className="login-title">Fuchs Metallbau</h1>

        {isSetup ? (
          <>
            <div className="login-setup-badge">Ersteinrichtung</div>
            <p className="login-subtitle">
              Legen Sie den ersten Administrator-Account an. Diese Person erhält automatisch alle Berechtigungen.
            </p>
          </>
        ) : (
          <p className="login-subtitle">Melde dich an, um Zugang zur Anwendung zu erhalten.</p>
        )}

        <form className="login-form" onSubmit={handleSubmit}>
          {isSetup && (
            <div className="login-field">
              <label>Name <span className="login-optional">(optional)</span></label>
              <input
                type="text"
                className="login-input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Dein Name"
                autoComplete="name"
              />
            </div>
          )}

          <div className="login-field">
            <label>E-Mail</label>
            <input
              type="email"
              className="login-input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="beispiel@firma.at"
              required
              autoComplete="email"
            />
          </div>

          <div className="login-field">
            <label>Passwort</label>
            <input
              type="password"
              className="login-input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={isSetup ? 'Mindestens 6 Zeichen' : '••••••••'}
              required
              minLength={6}
              autoComplete={isSetup ? 'new-password' : 'current-password'}
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="login-submit-btn" disabled={loading}>
            {loading ? 'Bitte warten…' : isSetup ? 'Administrator anlegen' : 'Anmelden'}
          </button>
        </form>
      </div>

      <div className="login-footer">
        <img src="/NR_Logo.png" alt="NetRock Entertainment" className="login-footer-logo" />
        <span>Entwickelt von NetRock Entertainment</span>
      </div>
    </div>
  );
}
