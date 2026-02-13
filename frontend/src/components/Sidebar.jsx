import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { HardDrive, FolderKanban, Settings, ChevronDown, ChevronRight } from 'lucide-react';
import './Sidebar.css';

const menuItems = [
  {
    id: 'drive',
    label: 'Drive',
    icon: HardDrive,
    subItems: [
      { id: 'drive-images', label: 'Bilder', path: '/drive/images' },
      { id: 'drive-settings', label: 'Einstellungen', path: '/drive/settings' }
    ]
  },
  {
    id: 'projects',
    label: 'Projekte',
    icon: FolderKanban,
    subItems: [
      { id: 'projects-list', label: 'Projekte', path: '/projects/list' },
      { id: 'projects-settings', label: 'Einstellungen', path: '/projects/settings' }
    ]
  },
  {
    id: 'settings',
    label: 'Einstellungen',
    icon: Settings,
    path: '/settings'
  }
];

function Sidebar({ collapsed }) {
  const location = useLocation();
  const [expandedItems, setExpandedItems] = useState(['drive', 'projects']);

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
