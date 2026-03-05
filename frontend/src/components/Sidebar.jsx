import { Link, useLocation } from 'react-router-dom';
import { Image, FolderKanban, Inbox, User, LogOut, Users } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './Sidebar.css';

function Sidebar({ collapsed, moduleMitarbeiter }) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const [inboxUnread, setInboxUnread] = useState(0);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const viewTabs = user?.permissions?.view_tabs || ['inbox', 'images', 'projects'];

  const checkUnread = useCallback(async () => {
    try {
      const res = await fetch('/api/mobile/activities?unread_count=1');
      if (res.ok) {
        const data = await res.json();
        setInboxUnread(data.unread_count || 0);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    checkUnread();
    const interval = setInterval(checkUnread, 60000);
    return () => clearInterval(interval);
  }, [checkUnread]);

  // Re-check when navigating away from /inbox (badge might need to refresh)
  useEffect(() => {
    if (location.pathname !== '/inbox') {
      checkUnread();
    }
  }, [location.pathname, checkUnread]);

  const isActive = (path) => location.pathname === path;

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <nav className="sidebar-nav">

        {viewTabs.includes('inbox') && (
          <Link
            to="/inbox"
            className={`menu-item ${isActive('/inbox') ? 'active' : ''}`}
            title={collapsed ? 'Inbox' : ''}
          >
            <div className="menu-item-content">
              <div className="menu-item-icon-wrap">
                <Inbox size={20} />
                {inboxUnread > 0 && <span className="inbox-badge" />}
              </div>
              {!collapsed && <span className="menu-item-label">Inbox</span>}
            </div>
          </Link>
        )}

        {viewTabs.includes('images') && (
          <Link
            to="/images"
            className={`menu-item ${isActive('/images') ? 'active' : ''}`}
            title={collapsed ? 'Bilder' : ''}
          >
            <div className="menu-item-content">
              <Image size={20} />
              {!collapsed && <span className="menu-item-label">Bilder</span>}
            </div>
          </Link>
        )}

        {viewTabs.includes('projects') && (
          <Link
            to="/projects"
            className={`menu-item ${isActive('/projects') ? 'active' : ''}`}
            title={collapsed ? 'Projekte' : ''}
          >
            <div className="menu-item-content">
              <FolderKanban size={20} />
              {!collapsed && <span className="menu-item-label">Projekte</span>}
            </div>
          </Link>
        )}

        {moduleMitarbeiter && viewTabs.includes('mitarbeiter') && (
          <Link
            to="/mitarbeiter"
            className={`menu-item ${isActive('/mitarbeiter') ? 'active' : ''}`}
            title={collapsed ? 'Mitarbeiter' : ''}
          >
            <div className="menu-item-content">
              <Users size={20} />
              {!collapsed && <span className="menu-item-label">Mitarbeiter</span>}
            </div>
          </Link>
        )}

      </nav>

      {/* User section */}
      <div className="sidebar-user-section">
        <button
          className={`sidebar-user-btn${collapsed ? ' collapsed' : ''}`}
          onClick={() => setShowUserMenu(v => !v)}
          title={user?.name || 'Benutzer'}
        >
          {user?.picture
            ? <img src={user.picture} alt={user?.name} className="sidebar-user-avatar" referrerPolicy="no-referrer" />
            : <div className="sidebar-user-avatar sidebar-user-avatar-placeholder"><User size={16} /></div>
          }
          {!collapsed && <span className="sidebar-user-name">{user?.name || 'Benutzer'}</span>}
        </button>

        {showUserMenu && (
          <>
            <div className="sidebar-user-overlay" onClick={() => setShowUserMenu(false)} />
            <div className="sidebar-user-menu">
              <div className="sidebar-user-info">
                {user?.picture && (
                  <img src={user.picture} alt={user?.name} className="sidebar-menu-avatar" referrerPolicy="no-referrer" />
                )}
                <div>
                  <div className="sidebar-user-fullname">{user?.name}</div>
                  <div className="sidebar-user-email">{user?.email}</div>
                  {user?.role_name && <div className="sidebar-user-role">{user.role_name}</div>}
                </div>
              </div>
              <div className="sidebar-user-divider" />
              <button className="sidebar-user-logout" onClick={() => { setShowUserMenu(false); logout(); }}>
                <LogOut size={14} />
                Abmelden
              </button>
            </div>
          </>
        )}
      </div>

      {/* NetRock Footer */}
      <div className="sidebar-footer">
        <a
          href="https://www.netrock.at"
          target="_blank"
          rel="noopener noreferrer"
          className="netrock-link"
        >
          {!collapsed && (
            <>
              <img
                src="/NR_Logo.png"
                alt="NetRock Entertainment"
                className="netrock-logo"
              />
              <span className="netrock-text">
                Entwickelt von<br />NetRock Entertainment
              </span>
            </>
          )}
          {collapsed && (
            <img
              src="/NR_Logo.png"
              alt="NetRock Entertainment"
              className="netrock-logo-collapsed"
            />
          )}
        </a>
      </div>
    </aside>
  );
}

export default Sidebar;
