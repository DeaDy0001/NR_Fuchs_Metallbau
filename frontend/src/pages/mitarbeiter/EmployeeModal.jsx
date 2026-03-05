import { useState } from 'react';
import { X } from 'lucide-react';
import '../MitarbeiterPage.css';

const TYPES = ['vacation', 'zeitausgleich', 'sonderurlaub', 'krankenstand'];
const TYPE_LABELS = { vacation: 'Urlaub', zeitausgleich: 'Zeitausgleich', sonderurlaub: 'Sonderurlaub', krankenstand: 'Krankenstand' };

export default function EmployeeModal({ employee, onClose, onSaved }) {
  const isEdit = !!employee;
  const [form, setForm] = useState({
    first_name: employee?.first_name || '',
    last_name: employee?.last_name || '',
    email: employee?.email || '',
    phone: employee?.phone || '',
    address: employee?.address || '',
    birth_date: employee?.birth_date || '',
    notes: employee?.notes || '',
  });
  const [balances, setBalances] = useState({ vacation: '', zeitausgleich: '', sonderurlaub: '', krankenstand: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setError('');
    if (!form.first_name.trim() || !form.last_name.trim()) {
      return setError('Vor- und Nachname sind Pflichtfelder.');
    }
    setSaving(true);
    try {
      const body = { ...form };
      if (!isEdit) {
        body.initial_balances = {};
        for (const t of TYPES) body.initial_balances[t] = parseFloat(balances[t]) || 0;
      }

      const url = isEdit ? `/api/employees/${employee.id}` : '/api/employees';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error || 'Fehler');
      onSaved(data);
      onClose();
    } catch { setError('Netzwerkfehler'); }
    setSaving(false);
  };

  return (
    <div className="ma-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="ma-modal">
        <div className="ma-modal-header">
          <span className="ma-modal-title">{isEdit ? 'Mitarbeiter bearbeiten' : 'Neuen Mitarbeiter anlegen'}</span>
          <button className="ma-btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="ma-modal-body">
          {error && <div className="ma-error">{error}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
            <div className="ma-field">
              <label className="ma-label">Vorname *</label>
              <input className="ma-input" value={form.first_name} onChange={e => set('first_name', e.target.value)} placeholder="Vorname" />
            </div>
            <div className="ma-field">
              <label className="ma-label">Nachname *</label>
              <input className="ma-input" value={form.last_name} onChange={e => set('last_name', e.target.value)} placeholder="Nachname" />
            </div>
            <div className="ma-field">
              <label className="ma-label">E-Mail</label>
              <input className="ma-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="email@beispiel.at" />
            </div>
            <div className="ma-field">
              <label className="ma-label">Telefon</label>
              <input className="ma-input" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+43 ..." />
            </div>
            <div className="ma-field" style={{ gridColumn: '1 / -1' }}>
              <label className="ma-label">Adresse</label>
              <input className="ma-input" value={form.address} onChange={e => set('address', e.target.value)} placeholder="Straße, PLZ Ort" />
            </div>
            <div className="ma-field">
              <label className="ma-label">Geburtsdatum</label>
              <input className="ma-input" type="date" value={form.birth_date} onChange={e => set('birth_date', e.target.value)} />
            </div>
            <div className="ma-field" style={{ gridColumn: '1 / -1' }}>
              <label className="ma-label">Notizen</label>
              <textarea className="ma-input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Interne Notizen..." style={{ resize: 'vertical' }} />
            </div>
          </div>

          {/* Initial balances only on create */}
          {!isEdit && (
            <>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: 10, marginTop: 4 }}>
                Anfangsstände (aktuelles Jahr)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
                {TYPES.map(t => (
                  <div key={t} className="ma-field">
                    <label className="ma-label">{TYPE_LABELS[t]}</label>
                    <input
                      className="ma-input"
                      type="number"
                      min="0"
                      step="0.5"
                      value={balances[t]}
                      onChange={e => setBalances(p => ({ ...p, [t]: e.target.value }))}
                      placeholder="0"
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="ma-modal-footer">
          <button className="ma-btn ma-btn-ghost" onClick={onClose} disabled={saving}>Abbrechen</button>
          <button className="ma-btn ma-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Speichern...' : (isEdit ? 'Speichern' : 'Anlegen')}
          </button>
        </div>
      </div>
    </div>
  );
}
