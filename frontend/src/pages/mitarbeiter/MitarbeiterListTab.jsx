import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Archive, ArchiveRestore, BarChart2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import EmployeeModal from './EmployeeModal';
import BalanceModal from './BalanceModal';
import '../MitarbeiterPage.css';

function calcAge(birthDate) {
  if (!birthDate) return null;
  const today = new Date();
  const dob = new Date(birthDate);
  let age = today.getFullYear() - dob.getFullYear();
  if (today.getMonth() - dob.getMonth() < 0 || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate())) age--;
  return age;
}

export default function MitarbeiterListTab() {
  const { user } = useAuth();
  const isAdmin = user?.is_admin;
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [editEmployee, setEditEmployee] = useState(null); // null | 'new' | employee object
  const [balanceEmployee, setBalanceEmployee] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/employees${showArchived ? '?archived=true' : ''}`);
      if (res.ok) {
        const d = await res.json();
        setEmployees(d.employees);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [showArchived]);

  useEffect(() => { load(); }, [load]);

  const handleArchive = async (emp) => {
    const action = emp.archived ? 'wiederherstellen' : 'archivieren';
    if (!confirm(`Mitarbeiter "${emp.first_name} ${emp.last_name}" ${action}?`)) return;
    try {
      await fetch(`/api/employees/${emp.id}/archive`, { method: 'POST' });
      load();
    } catch { setError('Netzwerkfehler'); }
  };

  if (loading) return <div className="ma-loading">Lade...</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {isAdmin && (
            <button className="ma-btn ma-btn-primary" onClick={() => setEditEmployee('new')}>
              <Plus size={15} />
              Neuer Mitarbeiter
            </button>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
            Archivierte anzeigen
          </label>
        </div>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{employees.length} Mitarbeiter</span>
      </div>

      {error && <div className="ma-error">{error}</div>}

      {employees.length === 0 ? (
        <div className="ma-empty">Keine Mitarbeiter gefunden.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '0.8rem', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px', fontWeight: 500 }}>Name</th>
                <th style={{ padding: '8px 12px', fontWeight: 500 }}>E-Mail</th>
                <th style={{ padding: '8px 12px', fontWeight: 500 }}>Telefon</th>
                <th style={{ padding: '8px 12px', fontWeight: 500 }}>Alter</th>
                <th style={{ padding: '8px 12px', fontWeight: 500 }}>Adresse</th>
                <th style={{ padding: '8px 12px', fontWeight: 500 }} />
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr
                  key={emp.id}
                  style={{
                    borderBottom: '1px solid var(--border-color)',
                    opacity: emp.archived ? 0.55 : 1,
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '10px 12px', fontWeight: 500, color: 'var(--text-primary)' }}>
                    {emp.first_name} {emp.last_name}
                    {emp.archived && <span style={{ marginLeft: 6, fontSize: '0.7rem', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 4, padding: '1px 5px' }}>Archiviert</span>}
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{emp.email || '—'}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{emp.phone || '—'}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{calcAge(emp.birth_date) ?? '—'}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{emp.address || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button
                        className="ma-btn-icon"
                        title="Stände & Logs"
                        onClick={() => setBalanceEmployee(emp)}
                      >
                        <BarChart2 size={16} />
                      </button>
                      {isAdmin && (
                        <>
                          <button
                            className="ma-btn-icon"
                            title="Bearbeiten"
                            onClick={() => setEditEmployee(emp)}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            className={`ma-btn-icon ${emp.archived ? '' : 'danger'}`}
                            title={emp.archived ? 'Wiederherstellen' : 'Archivieren'}
                            onClick={() => handleArchive(emp)}
                          >
                            {emp.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Employee create/edit modal */}
      {editEmployee && (
        <EmployeeModal
          employee={editEmployee === 'new' ? null : editEmployee}
          onClose={() => setEditEmployee(null)}
          onSaved={() => load()}
        />
      )}

      {/* Balance/logs modal */}
      {balanceEmployee && (
        <BalanceModal
          employee={balanceEmployee}
          onClose={() => setBalanceEmployee(null)}
          onChanged={() => load()}
        />
      )}
    </div>
  );
}
