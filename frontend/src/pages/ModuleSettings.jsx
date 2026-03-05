import { useState, useEffect } from 'react';
import { Users } from 'lucide-react';
import './Settings.css';

export default function ModuleSettings() {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(setSettings);
  }, []);

  const toggle = async (key) => {
    setSaving(true);
    setMsg('');
    const newVal = !settings[key];
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: newVal })
      });
      if (res.ok) {
        const updated = await res.json();
        setSettings(updated);
        setMsg('Gespeichert');
        setTimeout(() => setMsg(''), 2000);
      }
    } catch { /* ignore */ }
    setSaving(false);
  };

  if (!settings) return <div style={{ padding: 32, color: 'var(--text-secondary)' }}>Lade...</div>;

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Module</h3>
      <p className="settings-description">
        Module können hier aktiviert oder deaktiviert werden. Nur Administratoren können diese Einstellung ändern.
      </p>

      <div className="module-list">
        <div className="module-item">
          <div className="module-item-info">
            <div className="module-item-icon">
              <Users size={20} />
            </div>
            <div>
              <div className="module-item-name">Mitarbeiter</div>
              <div className="module-item-desc">
                Mitarbeiterverwaltung mit Urlaub, Zeitausgleich, Sonderurlaub und Krankenstand
              </div>
            </div>
          </div>
          <button
            className={`module-toggle ${settings.module_mitarbeiter_enabled ? 'active' : ''}`}
            onClick={() => toggle('module_mitarbeiter_enabled')}
            disabled={saving}
            title={settings.module_mitarbeiter_enabled ? 'Deaktivieren' : 'Aktivieren'}
          >
            <span className="module-toggle-knob" />
          </button>
        </div>
      </div>

      {msg && <div className="settings-success">{msg}</div>}
    </div>
  );
}
