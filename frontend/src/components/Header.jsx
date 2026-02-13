import { Menu, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import './Header.css';

function Header({ logoPath, sidebarCollapsed, onToggleSidebar }) {
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
        <Link to="/settings" className="icon-button" title="Einstellungen">
          <Settings size={20} />
        </Link>
      </div>
    </header>
  );
}

export default Header;
