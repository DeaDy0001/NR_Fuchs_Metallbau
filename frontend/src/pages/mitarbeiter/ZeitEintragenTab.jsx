import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Check } from 'lucide-react';
import '../MitarbeiterPage.css';

const TYPES = ['vacation', 'zeitausgleich', 'sonderurlaub', 'krankenstand'];
const TYPE_LABELS = { vacation: 'Urlaub', zeitausgleich: 'Zeitausgleich', sonderurlaub: 'Sonderurlaub', krankenstand: 'Krankenstand' };
const TYPE_COLORS = { vacation: '#6366f1', zeitausgleich: '#22c55e', sonderurlaub: '#f59e0b', krankenstand: '#ef4444' };

const EMPTY_ENTRY = { type: 'vacation', start_date: '', end_date: '', amount: '', notes: '' };

function unitLabel(unit) {
  if (unit === 'hours') return 'Stunden';
  if (unit === 'halfdays') return 'Halbtage';
  return 'Tage';
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000) + 1;
}

function fmt(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ── Mini Calendar component ─────────────────────────────────────────────────
function MiniCalendar({ rangeStart, rangeEnd, allEntries, employees }) {
  if (!rangeStart || !rangeEnd) return null;

  const displayStart = addDays(rangeStart, -4);
  const displayEnd = addDays(rangeEnd, 4);
  const totalDays = daysBetween(displayStart, displayEnd);

  const DAY_W = 36;
  const ROW_H = 30;
  const LEFT_W = 130;

  // All unique employee IDs that have entries in this range
  const relevantEmpIds = [...new Set(allEntries.map(e => e.employee_id))];
  const relevantEmps = employees.filter(e => relevantEmpIds.includes(e.id) || !relevantEmpIds.length);

  const days = [];
  for (let i = 0; i < totalDays; i++) {
    days.push(addDays(displayStart, i));
  }

  const isInRange = (d) => d >= rangeStart && d <= rangeEnd;
  const isWeekend = (d) => { const day = new Date(d).getDay(); return day === 0 || day === 6; };

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)' }}>
      <div style={{ display: 'flex', minWidth: LEFT_W + totalDays * DAY_W }}>
        {/* Left column */}
        <div style={{ width: LEFT_W, flexShrink: 0, borderRight: '1px solid var(--border-color)' }}>
          {/* Header */}
          <div style={{ height: 30, borderBottom: '1px solid var(--border-color)', background: 'var(--bg-tertiary)' }} />
          {/* Employee names */}
          {relevantEmps.map(emp => (
            <div key={emp.id} style={{
              height: ROW_H,
              display: 'flex',
              alignItems: 'center',
              padding: '0 10px',
              borderBottom: '1px solid var(--border-color)',
              fontSize: '0.78rem',
              fontWeight: 500,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {emp.first_name} {emp.last_name}
            </div>
          ))}
        </div>

        {/* Timeline */}
        <div style={{ flex: 1 }}>
          {/* Day headers */}
          <div style={{ display: 'flex', height: 30, borderBottom: '1px solid var(--border-color)', background: 'var(--bg-tertiary)' }}>
            {days.map(d => (
              <div key={d} style={{
                width: DAY_W,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.7rem',
                color: isInRange(d) ? 'var(--accent-primary)' : (isWeekend(d) ? '#ef4444' : 'var(--text-secondary)'),
                fontWeight: isInRange(d) ? 700 : 400,
                borderRight: '1px solid var(--border-color)',
                background: isInRange(d) ? 'rgba(99,102,241,0.08)' : 'transparent',
              }}>
                <span>{new Date(d).getDate()}</span>
                <span style={{ fontSize: '0.6rem' }}>{['So','Mo','Di','Mi','Do','Fr','Sa'][new Date(d).getDay()]}</span>
              </div>
            ))}
          </div>

          {/* Entry rows */}
          {relevantEmps.map((emp, empIdx) => {
            const empEntries = allEntries.filter(e => e.employee_id === emp.id);
            return (
              <div key={emp.id} style={{
                display: 'flex',
                height: ROW_H,
                borderBottom: '1px solid var(--border-color)',
                position: 'relative',
                background: empIdx % 2 === 0 ? 'var(--bg-primary)' : 'var(--bg-secondary)',
              }}>
                {days.map(d => (
                  <div key={d} style={{
                    width: DAY_W,
                    flexShrink: 0,
                    borderRight: '1px solid rgba(42,45,62,0.5)',
                    background: isInRange(d) ? 'rgba(99,102,241,0.05)' : (isWeekend(d) ? 'rgba(239,68,68,0.04)' : 'transparent'),
                  }} />
                ))}
                {/* Entry bars */}
                {empEntries.map(entry => {
                  const entryStart = entry.start_date > displayEnd || entry.end_date < displayStart ? null : entry.start_date;
                  if (!entryStart) return null;
                  const clampedStart = entry.start_date < displayStart ? displayStart : entry.start_date;
                  const clampedEnd = entry.end_date > displayEnd ? displayEnd : entry.end_date;
                  const startIdx = days.indexOf(clampedStart);
                  const endIdx = days.indexOf(clampedEnd);
                  if (startIdx < 0 || endIdx < 0) return null;
                  const barW = (endIdx - startIdx + 1) * DAY_W - 2;
                  return (
                    <div
                      key={entry.id}
                      title={`${emp.first_name} ${emp.last_name}: ${TYPE_LABELS[entry.type]} ${entry.start_date} – ${entry.end_date}`}
                      style={{
                        position: 'absolute',
                        left: startIdx * DAY_W + 1,
                        top: 4,
                        height: ROW_H - 8,
                        width: barW,
                        background: TYPE_COLORS[entry.type] || '#888',
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        paddingLeft: 5,
                        fontSize: '0.65rem',
                        color: '#fff',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        opacity: 0.85,
                        zIndex: 2,
                      }}
                    >
                      {barW > 60 && `${emp.first_name} (${TYPE_LABELS[entry.type]})`}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────
export default function ZeitEintragenTab() {
  const [employees, setEmployees] = useState([]);
  const [selectedEmp, setSelectedEmp] = useState('');
  const [empBalances, setEmpBalances] = useState(null);
  const [config, setConfig] = useState({});
  const [entries, setEntries] = useState([{ ...EMPTY_ENTRY }]);
  const [allEntries, setAllEntries] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // Calendar range: union of all entry date ranges ±4 days
  const calendarStart = entries.reduce((acc, e) => e.start_date && (!acc || e.start_date < acc) ? e.start_date : acc, null);
  const calendarEnd = entries.reduce((acc, e) => e.end_date && (!acc || e.end_date > acc) ? e.end_date : acc, null);

  const load = useCallback(async () => {
    const [empRes, cfgRes] = await Promise.all([
      fetch('/api/employees'),
      fetch('/api/employees/config'),
    ]);
    if (empRes.ok) setEmployees((await empRes.json()).employees.filter(e => !e.archived));
    if (cfgRes.ok) setConfig(await cfgRes.json());
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selectedEmp) { setEmpBalances(null); return; }
    const year = new Date().getFullYear();
    fetch(`/api/employees/${selectedEmp}/balances?year=${year}`)
      .then(r => r.json())
      .then(d => setEmpBalances(d.balances))
      .catch(() => {});
  }, [selectedEmp]);

  // Load calendar entries when dates change
  useEffect(() => {
    if (!calendarStart || !calendarEnd) return;
    const start = addDays(calendarStart, -4);
    const end = addDays(calendarEnd, 4);
    fetch(`/api/employees/entries?start=${start}&end=${end}`)
      .then(r => r.json())
      .then(d => setAllEntries(d.entries || []))
      .catch(() => {});
  }, [calendarStart, calendarEnd]);

  const addEntry = () => setEntries(p => [...p, { ...EMPTY_ENTRY }]);

  const removeEntry = (idx) => setEntries(p => p.filter((_, i) => i !== idx));

  const updateEntry = (idx, key, val) => {
    setEntries(p => p.map((e, i) => i === idx ? { ...e, [key]: val } : e));
  };

  const handleSubmit = async () => {
    setError(''); setMsg('');
    if (!selectedEmp) return setError('Bitte Mitarbeiter auswählen.');
    for (const e of entries) {
      if (!e.type || !e.start_date || !e.end_date || !e.amount) {
        return setError('Alle Felder (Typ, Datum Von/Bis, Menge) müssen ausgefüllt sein.');
      }
      if (e.end_date < e.start_date) return setError('Enddatum muss nach Startdatum liegen.');
    }
    setSaving(true);
    try {
      const res = await fetch('/api/employees/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: entries.map(e => ({ ...e, employee_id: parseInt(selectedEmp), amount: parseFloat(e.amount) }))
        }),
      });
      const d = await res.json();
      if (!res.ok) return setError(d.error || 'Fehler');
      setMsg(`${entries.length} Eintrag/Einträge erfolgreich gespeichert.`);
      setEntries([{ ...EMPTY_ENTRY }]);
      // Reload balances
      const year = new Date().getFullYear();
      const bRes = await fetch(`/api/employees/${selectedEmp}/balances?year=${year}`);
      if (bRes.ok) setEmpBalances((await bRes.json()).balances);
    } catch { setError('Netzwerkfehler'); }
    setSaving(false);
  };

  const selEmpObj = employees.find(e => e.id === parseInt(selectedEmp));

  return (
    <div>
      {error && <div className="ma-error">{error}</div>}
      {msg && <div className="ma-success">{msg}</div>}

      {/* ── Mitarbeiter wählen ── */}
      <div className="ma-card" style={{ marginBottom: 16 }}>
        <div className="ma-field" style={{ marginBottom: 0 }}>
          <label className="ma-label">Mitarbeiter *</label>
          <select className="ma-select" value={selectedEmp} onChange={e => setSelectedEmp(e.target.value)}>
            <option value="">— Mitarbeiter wählen —</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>
            ))}
          </select>
        </div>

        {/* Balances for selected employee */}
        {empBalances && (
          <div className="ma-balance-grid" style={{ marginTop: 14 }}>
            {TYPES.map(t => {
              const b = empBalances[t] || { allocated: 0, used: 0, remaining: 0 };
              const unit = unitLabel(config[`unit_${t}`] || 'days');
              return (
                <div key={t} className="ma-balance-chip" style={{ borderLeft: `3px solid ${TYPE_COLORS[t]}` }}>
                  <div className="ma-balance-chip-label">{TYPE_LABELS[t]}</div>
                  <div className="ma-balance-chip-values">
                    <span className="ma-balance-chip-remaining">{b.remaining} {unit}</span>
                    <span className="ma-balance-chip-used">verfügbar ({b.used} verbraucht)</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Einträge ── */}
      <div className="ma-card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: 12 }}>Einträge</div>
        {entries.map((entry, idx) => (
          <div key={idx} style={{ background: 'var(--bg-tertiary)', borderRadius: 8, padding: 12, marginBottom: 10, border: '1px solid var(--border-color)', position: 'relative' }}>
            {entries.length > 1 && (
              <button
                className="ma-btn-icon danger"
                style={{ position: 'absolute', top: 8, right: 8 }}
                onClick={() => removeEntry(idx)}
                title="Entfernen"
              >
                <Trash2 size={14} />
              </button>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 0.8fr', gap: '0 12px' }}>
              <div className="ma-field" style={{ marginBottom: 8 }}>
                <label className="ma-label">Typ</label>
                <select className="ma-select" value={entry.type} onChange={e => updateEntry(idx, 'type', e.target.value)}>
                  {TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              <div className="ma-field" style={{ marginBottom: 8 }}>
                <label className="ma-label">Von *</label>
                <input className="ma-input" type="date" value={entry.start_date} onChange={e => updateEntry(idx, 'start_date', e.target.value)} />
              </div>
              <div className="ma-field" style={{ marginBottom: 8 }}>
                <label className="ma-label">Bis *</label>
                <input className="ma-input" type="date" value={entry.end_date} onChange={e => updateEntry(idx, 'end_date', e.target.value)} />
              </div>
              <div className="ma-field" style={{ marginBottom: 8 }}>
                <label className="ma-label">{unitLabel(config[`unit_${entry.type}`] || 'days')} *</label>
                <input className="ma-input" type="number" min="0" step="0.5" value={entry.amount} onChange={e => updateEntry(idx, 'amount', e.target.value)} placeholder="0" />
              </div>
              <div className="ma-field" style={{ gridColumn: '1 / -1', marginBottom: 0 }}>
                <label className="ma-label">Notizen</label>
                <input className="ma-input" value={entry.notes} onChange={e => updateEntry(idx, 'notes', e.target.value)} placeholder="Optional..." />
              </div>
            </div>
          </div>
        ))}

        <button className="ma-btn ma-btn-secondary" onClick={addEntry} style={{ marginTop: 4 }}>
          <Plus size={15} />
          Weiteren Eintrag hinzufügen
        </button>
      </div>

      {/* ── Mini-Calendar ── */}
      {calendarStart && calendarEnd && (
        <div className="ma-card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: 12 }}>
            Zeitraum Übersicht
            <span style={{ fontWeight: 400, fontSize: '0.8rem', color: 'var(--text-secondary)', marginLeft: 8 }}>
              {fmt(addDays(calendarStart, -4))} – {fmt(addDays(calendarEnd, 4))}
            </span>
          </div>
          <MiniCalendar
            rangeStart={calendarStart}
            rangeEnd={calendarEnd}
            allEntries={allEntries}
            employees={employees}
          />
          <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: TYPE_COLORS[k], display: 'inline-block' }} />
                {v}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Submit ── */}
      <button
        className="ma-btn ma-btn-primary"
        onClick={handleSubmit}
        disabled={saving || !selectedEmp}
        style={{ padding: '10px 24px', fontSize: '0.9rem' }}
      >
        <Check size={16} />
        {saving ? 'Eintragen...' : 'Eintragen'}
      </button>
    </div>
  );
}
