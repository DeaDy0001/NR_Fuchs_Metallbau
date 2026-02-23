import { useState } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import './Layout.css';

function Layout({ children, settings, updateSettings, updateInfo }) {
  const toggleSidebar = async () => {
    const newCollapsed = !settings.sidebar_collapsed;

    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sidebar_collapsed: newCollapsed })
      });

      if (response.ok) {
        updateSettings({ sidebar_collapsed: newCollapsed });
      }
    } catch (error) {
      console.error('Failed to update sidebar state:', error);
    }
  };

  return (
    <div className="layout">
      <Header
        logoPath={settings.logo_path}
        sidebarCollapsed={settings.sidebar_collapsed}
        onToggleSidebar={toggleSidebar}
        updateInfo={updateInfo}
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
