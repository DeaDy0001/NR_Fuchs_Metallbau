import { useState } from 'react';
import { Menu, Settings, Download, LogOut, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import './Header.css';

function Header({ logoPath, sidebarCollapsed, onToggleSidebar, updateInfo, onOpenSettings, onOpenUpdate }) {
  const { user, logout } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);

  const canOpenSettings = user?.permissions?.access_settings;

  return (
    <header className="header">
      <div className="header-left">
        <button
          className="icon-button"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? 'Sidebar erweitern' : 'Sidebar einklappen'}
        >
          <Menu size={24} />
        </button>

        {logoPath && (
          <div className="header-logo">
            <img src={logoPath} alt="Logo" />
          </div>
        )}

        {!logoPath && (
          <div className="header-title">
            <h1>Fuchs Metallbau</h1>
          </div>
        )}
      </div>

      <div className="header-right">
        {updateInfo && updateInfo.updateAvailable && (
          <button
            className="update-badge"
            onClick={onOpenUpdate}
            title={`Update auf v${updateInfo.latestVersion} verfügbar`}
          >
            <Download size={14} />
            <span>v{updateInfo.latestVersion}</span>
          </button>
        )}
        {canOpenSettings && (
          <button className="icon-button" onClick={onOpenSettings} title="Einstellungen">
            <Settings size={20} />
          </button>
        )}

        {/* User avatar + dropdown */}
        <div className="header-user-wrap">
          <button
            className="header-user-btn"
            onClick={() => setShowUserMenu(v => !v)}
            title={user?.name || 'Benutzer'}
          >
            {user?.picture
              ? <img src={user.picture} alt={user.name} className="header-avatar" referrerPolicy="no-referrer" />
              : <User size={18} />
            }
          </button>

          {showUserMenu && (
            <>
              <div className="header-user-overlay" onClick={() => setShowUserMenu(false)} />
              <div className="header-user-menu">
                <div className="header-user-info">
                  {user?.picture && (
                    <img src={user.picture} alt={user.name} className="header-menu-avatar" referrerPolicy="no-referrer" />
                  )}
                  <div>
                    <div className="header-user-name">{user?.name}</div>
                    <div className="header-user-email">{user?.email}</div>
                    {user?.role_name && <div className="header-user-role">{user.role_name}</div>}
                  </div>
                </div>
                <div className="header-user-divider" />
                <button className="header-user-logout" onClick={() => { setShowUserMenu(false); logout(); }}>
                  <LogOut size={14} />
                  Abmelden
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export default Header;
