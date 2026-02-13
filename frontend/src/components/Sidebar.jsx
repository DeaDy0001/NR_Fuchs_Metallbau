import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Image, FolderKanban, Settings, ChevronDown, ChevronRight } from 'lucide-react';
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
    id: 'settings',
    label: 'Einstellungen',
    icon: Settings,
    subItems: [
      { id: 'settings-general', label: 'Allgemein', path: '/settings/general' },
      { id: 'settings-images', label: 'Bilder', path: '/settings/images' },
      { id: 'settings-projects', label: 'Projekte', path: '/settings/projects' }
    ]
  }
];

function Sidebar({ collapsed }) {
  const location = useLocation();
  const [expandedItems, setExpandedItems] = useState(['settings']);

  const toggleExpand = (itemId) => {
    setExpandedItems(prev =>
      prev.includes(itemId)
        ? prev.filter(id => id !== itemId)
        : [...prev, itemId]
    );
  };

  const isActive = (path) => {
    return location.pathname === path;
  };

  const isParentActive = (item) => {
    if (item.path) return isActive(item.path);
    return item.subItems?.some(sub => isActive(sub.path));
  };

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <nav className="sidebar-nav">
        {menuItems.map(item => {
          const Icon = item.icon;
          const hasSubItems = item.subItems && item.subItems.length > 0;
          const isExpanded = expandedItems.includes(item.id);
          const isItemActive = isParentActive(item);

          if (!hasSubItems) {
            // Simple menu item without sub-items
            return (
              <Link
                key={item.id}
                to={item.path}
                className={`menu-item ${isItemActive ? 'active' : ''}`}
                title={collapsed ? item.label : ''}
              >
                <div className="menu-item-content">
                  <Icon size={20} />
                  {!collapsed && <span className="menu-item-label">{item.label}</span>}
                </div>
              </Link>
            );
          }

          // Menu item with sub-items
          return (
            <div key={item.id} className="menu-group">
              <button
                className={`menu-item ${isItemActive ? 'active' : ''}`}
                onClick={() => !collapsed && toggleExpand(item.id)}
                title={collapsed ? item.label : ''}
              >
                <div className="menu-item-content">
                  <Icon size={20} />
                  {!collapsed && (
                    <>
                      <span className="menu-item-label">{item.label}</span>
                      <div className="menu-item-expand">
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </div>
                    </>
                  )}
                </div>
              </button>

              {/* Sub-items */}
              {!collapsed && isExpanded && (
                <div className="sub-menu">
                  {item.subItems.map(subItem => (
                    <Link
                      key={subItem.id}
                      to={subItem.path}
                      className={`sub-menu-item ${isActive(subItem.path) ? 'active' : ''}`}
                    >
                      <span>{subItem.label}</span>
                    </Link>
                  ))}
                </div>
              )}

              {/* Collapsed sub-items as tooltip */}
              {collapsed && (
                <div className="collapsed-submenu">
                  {item.subItems.map(subItem => (
                    <Link
                      key={subItem.id}
                      to={subItem.path}
                      className={`collapsed-submenu-item ${isActive(subItem.path) ? 'active' : ''}`}
                    >
                      {subItem.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

export default Sidebar;
