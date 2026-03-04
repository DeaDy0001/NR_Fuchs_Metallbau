import { useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Image, FolderKanban, Inbox } from 'lucide-react';
import './Sidebar.css';

const menuItems = [
  {
    id: 'images',
    label: 'Bilder',
    icon: Image,
    path: '/images'
  },
  {
    id: 'projects',
    label: 'Projekte',
    icon: FolderKanban,
    path: '/projects'
  },
  {
    id: 'inbox',
    label: 'Inbox',
    icon: Inbox,
    path: '/inbox',
    showBadge: true
  }
];

function Sidebar({ collapsed }) {
  const location = useLocation();
  const [inboxCount, setInboxCount] = useState(0);

  const checkInbox = useCallback(async () => {
    try {
      const [inboxRes, changesRes] = await Promise.all([
        fetch('/api/mobile/inbox'),
        fetch('/api/mobile/project-changes'),
      ]);
      let count = 0;
      if (inboxRes.ok) {
        const data = await inboxRes.json();
        count += data.projects?.length || 0;
        count += data.deleteRequests?.length || 0;
      }
      if (changesRes.ok) {
        const data = await changesRes.json();
        count += data.changes?.length || 0;
      }
      setInboxCount(count);
    } catch {}
  }, []);

  useEffect(() => {
    checkInbox();
    const interval = setInterval(checkInbox, 60000);
    return () => clearInterval(interval);
  }, [checkInbox]);

  const isActive = (path) => {
    return location.pathname === path;
  };

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <nav className="sidebar-nav">
        {menuItems.map(item => {
          const Icon = item.icon;
          const hasBadge = item.showBadge && inboxCount > 0;
          return (
            <Link
              key={item.id}
              to={item.path}
              className={`menu-item ${isActive(item.path) ? 'active' : ''}`}
              title={collapsed ? item.label : ''}
            >
              <div className="menu-item-content">
                <div className="menu-item-icon-wrapper">
                  <Icon size={20} />
                  {hasBadge && <span className="menu-item-badge" />}
                </div>
                {!collapsed && <span className="menu-item-label">{item.label}</span>}
                {!collapsed && hasBadge && (
                  <span className="menu-item-count">{inboxCount}</span>
                )}
              </div>
            </Link>
          );
        })}
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
