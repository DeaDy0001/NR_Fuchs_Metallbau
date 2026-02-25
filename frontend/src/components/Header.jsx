import { Menu, Settings, Download } from 'lucide-react';
import './Header.css';

function Header({ logoPath, sidebarCollapsed, onToggleSidebar, updateInfo, onOpenSettings, onOpenUpdate }) {
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
        <button className="icon-button" onClick={onOpenSettings} title="Einstellungen">
          <Settings size={20} />
        </button>
      </div>
    </header>
  );
}

export default Header;
