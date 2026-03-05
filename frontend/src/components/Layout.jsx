import Header from './Header';
import Sidebar from './Sidebar';
import InboxBanner from './InboxBanner';
import './Layout.css';

function Layout({ children, settings, updateSettings, updateInfo, onToggleSidebar, onOpenSettings, onOpenUpdate }) {
  return (
    <div className="layout">
      <InboxBanner />
      <Header
        logoPath={settings.logo_path}
        sidebarCollapsed={settings.sidebar_collapsed}
        onToggleSidebar={onToggleSidebar}
        updateInfo={updateInfo}
        onOpenSettings={onOpenSettings}
        onOpenUpdate={onOpenUpdate}
      />
      <div className="layout-body">
        <Sidebar collapsed={settings.sidebar_collapsed} moduleMitarbeiter={settings.module_mitarbeiter_enabled} />
        <main className={`main-content ${settings.sidebar_collapsed ? 'sidebar-collapsed' : ''}`}>
          {children}
        </main>
      </div>
    </div>
  );
}

export default Layout;
