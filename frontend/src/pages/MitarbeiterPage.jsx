import { useState } from 'react';
import { Calendar, Users, Settings, ClipboardList } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import KalenderTab from './mitarbeiter/KalenderTab';
import MitarbeiterListTab from './mitarbeiter/MitarbeiterListTab';
import MitarbeiterSettingsTab from './mitarbeiter/MitarbeiterSettingsTab';
import ZeitEintragenTab from './mitarbeiter/ZeitEintragenTab';
import './MitarbeiterPage.css';

const TABS = [
  { id: 'kalender', label: 'Kalender', icon: Calendar },
  { id: 'mitarbeiter', label: 'Mitarbeiter', icon: Users },
  { id: 'settings', label: 'Einstellungen', icon: Settings },
  { id: 'zeit', label: 'Zeit Eintragen', icon: ClipboardList, highlight: true },
];

export default function MitarbeiterPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('mitarbeiter');

  const visibleTabs = TABS.filter(t => {
    if (t.id === 'settings') return user?.is_admin;
    return true;
  });

  return (
    <div className="ma-page">
      <div className="ma-header">
        <h1 className="ma-title">Mitarbeiter</h1>
        <div className="ma-tabs">
          {visibleTabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={`ma-tab ${activeTab === tab.id ? 'active' : ''} ${tab.highlight ? 'highlight' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="ma-content">
        {activeTab === 'kalender' && <KalenderTab />}
        {activeTab === 'mitarbeiter' && <MitarbeiterListTab />}
        {activeTab === 'settings' && user?.is_admin && <MitarbeiterSettingsTab />}
        {activeTab === 'zeit' && <ZeitEintragenTab />}
      </div>
    </div>
  );
}
