import { useState, useEffect, useCallback } from 'react';
import { X, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import '../MitarbeiterPage.css';

const TYPES = ['vacation', 'zeitausgleich', 'sonderurlaub', 'krankenstand'];
const TYPE_LABELS = { vacation: 'Urlaub', zeitausgleich: 'Zeitausgleich', sonderurlaub: 'Sonderurlaub', krankenstand: 'Krankenstand' };
const TYPE_COLORS = { vacation: '#6366f1', zeitausgleich: '#22c55e', sonderurlaub: '#f59e0b', krankenstand: '#ef4444' };

function fmt(dt) {
  if (!dt) return '—';
  const d = new Date(dt.endsWith('Z') ? dt : dt + 'Z');
  return d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function unitLabel(unit) {
  if (unit === 'hours') return 'Std.';
  if (unit === 'halfdays') return 'Halbtage';
  return 'Tage';
}

export default function BalanceModal({ employee, onClose, onChanged }) {
  const { user } = useAuth();
  const isAdmin = user?.is_admin;
  const [tab, setTab] = useState('aktuell');
  const [year, setYear] = useState(new Date().getFullYear());
  const [balances, setBalances] = useState(null);
  const [allBalances, setAllBalances] = useState([]);
  const [entries, setEntries] = useState([]);
  const [logs, setLogs] = useState([]);
  const [entryPage, setEntryPage] = useState(1);
  const [logPage, setLogPage] = useState(1);
  const [entryMeta, setEntryMeta] = useState({ total: 0, pages: 1 });
  const [logMeta, setLogMeta] = useState({ total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [stornoOpen, setStornoOpen] = useState(false);
  const [storno, setStorno] = useState({ type: 'vacation', field: 'allocated', amount: '', reason: '', year: new Date().getFullYear() });
  const [krankenForm, setKrankenForm] = useState({ start_date: '', end_date: '', amount: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [config, setConfig] = useState({});

  const loadBalances = useCallback(async () => {
    const [bRes, allRes, cfgRes] = await Promise.all([
      fetch(`/api/employees/${employee.id}/balances?year=${year}`),
      fetch(`/api/employees/${employee.id}/balances/all`),
      fetch('/api/employees/config'),
    ]);
    if (bRes.ok) setBalances((await bRes.json()).balances);
    if (allRes.ok) setAllBalances((await allRes.json()).balances);
    if (cfgRes.ok) setConfig(await cfgRes.json());
  }, [employee.id, year]);

  const loadEntries = useCallback(async () => {
    const res = await fetch(`/api/employees/${employee.id}/entries?page=${entryPage}`);
    if (res.ok) {
      const d = await res.json();
      setEntries(d.entries);
      setEntryMeta({ total: d.total, pages: d.pages });
    }
  }, [employee.id, entryPage]);

  const loadLogs = useCallback(async () => {
    const res = await fetch(`/api/employees/${employee.id}/logs?page=${logPage}`);
    if (res.ok) {
      const d = await res.json();
      setLogs(d.logs);
      setLogMeta({ total: d.total, pages: d.pages });
    }
  }, [employee.id, logPage]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadBalances(), loadEntries(), loadLogs()]).finally(() => setLoading(false));
  }, [loadBalances, loadEntries, loadLogs]);

  const submitStorno = async () => {
    setError(''); setMsg('');
    if (!storno.reason.trim() || storno.amount === '') return setError('Betrag und Begründung erforderlich.');
    setSaving(true);
    try {
      const res = await fetch(`/api/employees/${employee.id}/storno`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...storno, amount: parseFloat(storno.amount) }),
      });
      const d = await res.json();
      if (!res.ok) return setError(d.error || 'Fehler');
      setMsg('Storno gespeichert.');
      setStornoOpen(false);
      setStorno(p => ({ ...p, amount: '', reason: '' }));
      await loadBalances();
      await loadLogs();
      onChanged();
    } catch { setError('Netzwerkfehler'); }
    setSaving(false);
  };

  const submitKrankenstand = async () => {
    setError(''); setMsg('');
    if (!krankenForm.start_date || !krankenForm.end_date || !krankenForm.amount) {
      return setError('Start, Ende und Betrag erforderlich.');
    }
    setSaving(true);
    try {
      const res = await fetch('/api/employees/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: [{
            employee_id: employee.id,
            type: 'krankenstand',
            start_date: krankenForm.start_date,
            end_date: krankenForm.end_date,
            amount: parseFloat(krankenForm.amount),
            notes: krankenForm.notes,
          }]
        }),
      });
      const d = await res.json();
      if (!res.ok) return setError(d.error || 'Fehler');
      setMsg('Krankenstand eingetragen.');
      setKrankenForm({ start_date: '', end_date: '', amount: '', notes: '' });
      await loadBalances();
      await loadEntries();
      await loadLogs();
      onChanged();
    } catch { setError('Netzwerkfehler'); }
    setSaving(false);
  };

  const deleteEntry = async (entryId) => {
    const reason = prompt('Begründung für die Stornierung:');
    if (!reason?.trim()) return;
    try {
      const res = await fetch(`/api/employees/entries/${entryId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        await loadBalances();
        await loadEntries();
        await loadLogs();
        onChanged();
      }
    } catch { /* ignore */ }
  };

  return (
    <div className="ma-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="ma-modal ma-modal-lg">
        <div className="ma-modal-header">
          <span className="ma-modal-title">{employee.first_name} {employee.last_name}</span>
          <button className="ma-btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="ma-subtabs" style={{ padding: '0 20px' }}>
          {['aktuell', 'verlauf', 'eintraege', 'krankenstand', 'logs'].map(t => (
            <button key={t} className={`ma-subtab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {{ aktuell: 'Aktuelle Stände', verlauf: 'Verlauf', eintraege: 'Einträge', krankenstand: 'Krankenstand', logs: 'Logs' }[t]}
            </button>
          ))}
        </div>

        <div className="ma-modal-body" style={{ minHeight: 300 }}>
          {(error || msg) && (
            error ? <div className="ma-error">{error}</div> : <div className="ma-success">{msg}</div>
          )}

          {/* ── Aktuelle Stände ── */}
          {tab === 'aktuell' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <button className="ma-btn-icon" onClick={() => setYear(y => y - 1)}><ChevronLeft size={16} /></button>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{year}</span>
                <button className="ma-btn-icon" onClick={() => setYear(y => y + 1)}><ChevronRight size={16} /></button>
              </div>

              {loading ? <div className="ma-loading">Lade...</div> : balances && (
                <div className="ma-balance-grid">
                  {TYPES.map(t => {
                    const b = balances[t] || { allocated: 0, used: 0, remaining: 0 };
                    const unit = unitLabel(config[`unit_${t}`] || 'days');
                    return (
                      <div key={t} className="ma-balance-chip" style={{ borderLeft: `3px solid ${TYPE_COLORS[t]}` }}>
                        <div className="ma-balance-chip-label">{TYPE_LABELS[t]}</div>
                        <div className="ma-balance-chip-values">
                          <span className="ma-balance-chip-remaining">{b.remaining} {unit}</span>
                          <span className="ma-balance-chip-used">({b.used} verbraucht / {b.allocated} gesamt)</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {isAdmin && (
                <>
                  <button
                    className="ma-btn ma-btn-warning"
                    style={{ marginTop: 8 }}
                    onClick={() => { setStornoOpen(!stornoOpen); setError(''); setMsg(''); }}
                  >
                    <AlertTriangle size={15} />
                    Korrektur (Storno)
                  </button>

                  {stornoOpen && (
                    <div style={{ marginTop: 14, padding: 14, background: 'var(--bg-tertiary)', borderRadius: 8, border: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
                        <div className="ma-field">
                          <label className="ma-label">Typ</label>
                          <select className="ma-select" value={storno.type} onChange={e => setStorno(p => ({ ...p, type: e.target.value }))}>
                            {TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                          </select>
                        </div>
                        <div className="ma-field">
                          <label className="ma-label">Feld</label>
                          <select className="ma-select" value={storno.field} onChange={e => setStorno(p => ({ ...p, field: e.target.value }))}>
                            <option value="allocated">Zugeteilt</option>
                            <option value="used">Verbraucht</option>
                          </select>
                        </div>
                        <div className="ma-field">
                          <label className="ma-label">Jahr</label>
                          <input className="ma-input" type="number" value={storno.year} onChange={e => setStorno(p => ({ ...p, year: parseInt(e.target.value) }))} />
                        </div>
                        <div className="ma-field">
                          <label className="ma-label">Neuer Wert</label>
                          <input className="ma-input" type="number" step="0.5" value={storno.amount} onChange={e => setStorno(p => ({ ...p, amount: e.target.value }))} placeholder="0" />
                        </div>
                        <div className="ma-field" style={{ gridColumn: '1 / -1' }}>
                          <label className="ma-label">Begründung *</label>
                          <input className="ma-input" value={storno.reason} onChange={e => setStorno(p => ({ ...p, reason: e.target.value }))} placeholder="Pflichtfeld" />
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="ma-btn ma-btn-warning" onClick={submitStorno} disabled={saving}>
                          {saving ? 'Speichern...' : 'Korrektur speichern'}
                        </button>
                        <button className="ma-btn ma-btn-ghost" onClick={() => setStornoOpen(false)}>Abbrechen</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Verlauf ── */}
          {tab === 'verlauf' && (
            <div>
              {allBalances.length === 0 ? <div className="ma-empty">Keine historischen Daten.</div> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 500 }}>Jahr</th>
                      <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 500 }}>Typ</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 500 }}>Zugeteilt</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 500 }}>Verbraucht</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 500 }}>Rest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allBalances.map(b => (
                      <tr key={b.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '7px 10px', color: 'var(--text-primary)', fontWeight: 500 }}>{b.year}</td>
                        <td style={{ padding: '7px 10px', color: 'var(--text-secondary)' }}>
                          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: TYPE_COLORS[b.type], marginRight: 6 }} />
                          {TYPE_LABELS[b.type] || b.type}
                        </td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text-secondary)' }}>{b.allocated}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text-secondary)' }}>{b.used}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600, color: b.allocated - b.used < 0 ? '#ef4444' : 'var(--text-primary)' }}>
                          {(b.allocated - b.used).toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── Einträge ── */}
          {tab === 'eintraege' && (
            <div>
              {entries.length === 0 ? <div className="ma-empty">Keine Einträge.</div> : (
                <>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 500 }}>Typ</th>
                        <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 500 }}>Von</th>
                        <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 500 }}>Bis</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 500 }}>Menge</th>
                        <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 500 }}>Status</th>
                        {isAdmin && <th style={{ padding: '6px 10px' }} />}
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map(e => (
                        <tr key={e.id} style={{ borderBottom: '1px solid var(--border-color)', opacity: e.is_storno ? 0.5 : 1 }}>
                          <td style={{ padding: '7px 10px' }}>
                            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: TYPE_COLORS[e.type], marginRight: 6 }} />
                            {TYPE_LABELS[e.type] || e.type}
                          </td>
                          <td style={{ padding: '7px 10px', color: 'var(--text-secondary)' }}>{fmtDate(e.start_date)}</td>
                          <td style={{ padding: '7px 10px', color: 'var(--text-secondary)' }}>{fmtDate(e.end_date)}</td>
                          <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>{e.amount} {unitLabel(e.unit)}</td>
                          <td style={{ padding: '7px 10px', fontSize: '0.78rem' }}>
                            {e.is_storno
                              ? <span style={{ color: '#ef4444' }}>Storniert: {e.storno_reason}</span>
                              : <span style={{ color: '#22c55e' }}>Aktiv</span>}
                          </td>
                          {isAdmin && (
                            <td style={{ padding: '7px 10px' }}>
                              {!e.is_storno && (
                                <button className="ma-btn-icon danger" title="Stornieren" onClick={() => deleteEntry(e.id)}>
                                  <X size={14} />
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {entryMeta.pages > 1 && (
                    <div className="ma-pagination">
                      <button className="ma-pagination-btn" disabled={entryPage === 1} onClick={() => setEntryPage(p => p - 1)}>←</button>
                      <span className="ma-pagination-info">Seite {entryPage} / {entryMeta.pages}</span>
                      <button className="ma-pagination-btn" disabled={entryPage >= entryMeta.pages} onClick={() => setEntryPage(p => p + 1)}>→</button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Krankenstand eintragen ── */}
          {tab === 'krankenstand' && (
            <div>
              <div style={{ marginBottom: 16, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Hier kann ein Krankenstand für diesen Mitarbeiter eingetragen werden.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
                <div className="ma-field">
                  <label className="ma-label">Von *</label>
                  <input className="ma-input" type="date" value={krankenForm.start_date} onChange={e => setKrankenForm(p => ({ ...p, start_date: e.target.value }))} />
                </div>
                <div className="ma-field">
                  <label className="ma-label">Bis *</label>
                  <input className="ma-input" type="date" value={krankenForm.end_date} onChange={e => setKrankenForm(p => ({ ...p, end_date: e.target.value }))} />
                </div>
                <div className="ma-field">
                  <label className="ma-label">Menge *</label>
                  <input className="ma-input" type="number" min="0" step="0.5" value={krankenForm.amount} onChange={e => setKrankenForm(p => ({ ...p, amount: e.target.value }))} placeholder="0" />
                </div>
                <div className="ma-field" style={{ gridColumn: '1 / -1' }}>
                  <label className="ma-label">Notizen</label>
                  <input className="ma-input" value={krankenForm.notes} onChange={e => setKrankenForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional..." />
                </div>
              </div>
              <button className="ma-btn ma-btn-primary" onClick={submitKrankenstand} disabled={saving}>
                {saving ? 'Eintragen...' : 'Krankenstand eintragen'}
              </button>
            </div>
          )}

          {/* ── Logs ── */}
          {tab === 'logs' && (
            <div>
              {logs.length === 0 ? <div className="ma-empty">Keine Logs.</div> : (
                <>
                  {logs.map(log => (
                    <div key={log.id} style={{
                      padding: '10px 12px',
                      borderBottom: '1px solid var(--border-color)',
                      fontSize: '0.8rem',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{log.action}</span>
                        <span style={{ color: 'var(--text-secondary)' }}>{fmt(log.created_at)}</span>
                      </div>
                      <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>
                        Von: <strong style={{ color: 'var(--text-primary)' }}>{log.performed_by_name || '—'}</strong>
                      </div>
                      <pre style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: 'var(--bg-tertiary)', borderRadius: 4, padding: '4px 8px' }}>
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    </div>
                  ))}
                  {logMeta.pages > 1 && (
                    <div className="ma-pagination">
                      <button className="ma-pagination-btn" disabled={logPage === 1} onClick={() => setLogPage(p => p - 1)}>←</button>
                      <span className="ma-pagination-info">Seite {logPage} / {logMeta.pages}</span>
                      <button className="ma-pagination-btn" disabled={logPage >= logMeta.pages} onClick={() => setLogPage(p => p + 1)}>→</button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
