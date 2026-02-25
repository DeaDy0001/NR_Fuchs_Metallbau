import { Link, useLocation } from 'react-router-dom';
import { Image, FolderKanban } from 'lucide-react';
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
  }
];

function Sidebar({ collapsed }) {
  const location = useLocation();

  const isActive = (path) => {
    return location.pathname === path;
  };

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <nav className="sidebar-nav">
        {menuItems.map(item => {
          const Icon = item.icon;
          return (
            <Link
              key={item.id}
              to={item.path}
              className={`menu-item ${isActive(item.path) ? 'active' : ''}`}
              title={collapsed ? item.label : ''}
            >
              <div className="menu-item-content">
                <Icon size={20} />
                {!collapsed && <span className="menu-item-label">{item.label}</span>}
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
