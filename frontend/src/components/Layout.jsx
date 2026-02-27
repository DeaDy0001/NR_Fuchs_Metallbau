import Header from './Header';
import Sidebar from './Sidebar';
import PendingProjectsBanner from './PendingProjects';
import InboxBanner from './InboxBanner';
import './Layout.css';

function Layout({ children, settings, updateSettings, updateInfo, onToggleSidebar, onOpenSettings, onOpenUpdate }) {
  return (
    <div className="layout">
      <PendingProjectsBanner />
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
        <Sidebar collapsed={settings.sidebar_collapsed} />
        <main className={`main-content ${settings.sidebar_collapsed ? 'sidebar-collapsed' : ''}`}>
          {children}
        </main>
      </div>
    </div>
  );
}

export default Layout;
