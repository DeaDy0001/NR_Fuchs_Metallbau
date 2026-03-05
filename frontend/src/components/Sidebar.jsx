import { Link, useLocation } from 'react-router-dom';
import { Image, FolderKanban, Inbox } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './Sidebar.css';

function Sidebar({ collapsed }) {
  const location = useLocation();
  const { user } = useAuth();
  const [inboxUnread, setInboxUnread] = useState(0);
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

      </nav>

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
