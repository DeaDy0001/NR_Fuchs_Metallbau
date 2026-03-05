import { Clock, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import './WaitingPage.css';

export default function WaitingPage() {
  const { user, logout } = useAuth();

  return (
    <div className="waiting-page">
      <div className="waiting-card">
        <div className="waiting-icon-wrap">
          <Clock size={40} className="waiting-icon" />
        </div>

        <h1 className="waiting-title">Zugang ausstehend</h1>

        <p className="waiting-text">
          Dein Konto wurde angelegt und wartet auf die Freischaltung durch einen Administrator.
          Du wirst benachrichtigt, sobald dein Zugang aktiviert wurde.
        </p>

        {user && (
          <div className="waiting-user-info">
            {user.picture && (
              <img src={user.picture} alt={user.name} className="waiting-avatar" referrerPolicy="no-referrer" />
            )}
            <div>
              <div className="waiting-user-name">{user.name}</div>
              <div className="waiting-user-email">{user.email}</div>
            </div>
          </div>
        )}

        <button className="waiting-logout-btn" onClick={logout}>
          <LogOut size={16} />
          Abmelden
        </button>
      </div>

      <div className="waiting-footer">
        <img src="/NR_Logo.png" alt="NetRock Entertainment" className="waiting-footer-logo" />
        <span>Entwickelt von NetRock Entertainment</span>
      </div>
    </div>
  );
}
