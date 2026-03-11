import { useState, useEffect, useCallback } from 'react';
import { Users, Shield, Plus, Trash2, Check, X, ChevronDown, ChevronUp, Link } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import './UserManagement.css';

function useAppSettings() {
  const [settings, setSettings] = useState(null);
  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(setSettings).catch(() => {});
  }, []);
  return settings;
}

const ALL_TABS = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'images', label: 'Bilder' },
  { id: 'projects', label: 'Projekte' },
  { id: 'mitarbeiter', label: 'Mitarbeiter', moduleKey: 'module_mitarbeiter_enabled' }
];

function StatusBadge({ status }) {
  const map = {
    active: { label: 'Aktiv', cls: 'badge-active' },
    pending: { label: 'Ausstehend', cls: 'badge-pending' },
    inactive: { label: 'Inaktiv', cls: 'badge-inactive' }
  };
  const cfg = map[status] || { label: status, cls: '' };
  return <span className={`um-badge ${cfg.cls}`}>{cfg.label}</span>;
}

function RoleEditor({ role, onSave, onCancel, isNew, appSettings }) {
  const [name, setName] = useState(role?.name || '');
  const [perms, setPerms] = useState(role?.permissions || {
    approve_users: false,
    manage_inbox: false,
    view_tabs: ['inbox', 'images', 'projects'],
    access_settings: false
  });

  const visibleTabs = ALL_TABS.filter(tab =>
    !tab.moduleKey || appSettings?.[tab.moduleKey]
  );

  const toggleTab = (tabId) => {
    setPerms(prev => {
      const tabs = prev.view_tabs || [];
      return {
        ...prev,
        view_tabs: tabs.includes(tabId) ? tabs.filter(t => t !== tabId) : [...tabs, tabId]
      };
    });
  };

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), permissions: perms });
  };

  return (
    <div className="um-role-editor">
      <div className="um-field">
        <label>Rollenname</label>
        <input
          className="um-input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="z.B. Mitarbeiter"
          disabled={role?.is_system}
        />
      </div>

      <div className="um-field">
        <label>Berechtigungen</label>
        <div className="um-perm-list">
          <label className="um-perm-row">
            <input
              type="checkbox"
              checked={!!perms.approve_users}
              onChange={e => setPerms(p => ({ ...p, approve_users: e.target.checked }))}
            />
            <span>Benutzer freischalten (Inbox)</span>
          </label>
          <label className="um-perm-row">
            <input
              type="checkbox"
              checked={!!perms.manage_inbox}
              onChange={e => setPerms(p => ({ ...p, manage_inbox: e.target.checked }))}
            />
            <span>Inbox-Einträge verwalten (hinzufügen, zusammenführen, löschen)</span>
          </label>
          <label className="um-perm-row">
            <input
              type="checkbox"
              checked={!!perms.access_settings}
              onChange={e => setPerms(p => ({ ...p, access_settings: e.target.checked }))}
            />
            <span>Einstellungen öffnen</span>
          </label>
        </div>
      </div>

      <div className="um-field">
        <label>Sichtbare Tabs (Sidebar)</label>
        <div className="um-tab-checks">
          {visibleTabs.map(tab => (
            <label key={tab.id} className="um-perm-row">
              <input
                type="checkbox"
                checked={(perms.view_tabs || []).includes(tab.id)}
                onChange={() => toggleTab(tab.id)}
              />
              <span>{tab.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="um-role-editor-actions">
        <button className="um-btn um-btn-primary" onClick={handleSave}>
          <Check size={14} />
          {isNew ? 'Erstellen' : 'Speichern'}
        </button>
        <button className="um-btn um-btn-ghost" onClick={onCancel}>
          <X size={14} />
          Abbrechen
        </button>
      </div>
    </div>
  );
}

const EMPTY_NEW_USER = { name: '', email: '', password: '', password2: '', role_id: '' };

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.is_admin === true;
  const appSettings = useAppSettings();

  const [section, setSection] = useState('users');
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingRole, setEditingRole] = useState(null); // role object or 'new'
  const [expandedRole, setExpandedRole] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showNewUser, setShowNewUser] = useState(false);
  const [newUser, setNewUser] = useState(EMPTY_NEW_USER);
  const [newUserError, setNewUserError] = useState('');
  const [newUserSaving, setNewUserSaving] = useState(false);
  const [copiedLinkId, setCopiedLinkId] = useState(null); // userId whose link was just copied

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [uRes, rRes] = await Promise.all([
        fetch('/api/users'),
        fetch('/api/roles')
      ]);
      if (uRes.ok) setUsers((await uRes.json()).users);
      if (rRes.ok) setRoles((await rRes.json()).roles);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const toggleUserStatus = async (user) => {
    const newStatus = user.status === 'active' ? 'inactive' : 'active';
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        setUsers(prev => prev.map(u => u.id === user.id ? { ...u, status: newStatus } : u));
      } else {
        const d = await res.json();
        setError(d.error || 'Fehler');
      }
    } catch { setError('Netzwerkfehler'); }
    setSaving(false);
  };

  const changeUserRole = async (userId, roleId) => {
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_id: roleId ? parseInt(roleId) : null })
      });
      if (res.ok) {
        const role = roles.find(r => r.id === parseInt(roleId));
        setUsers(prev => prev.map(u => u.id === userId
          ? { ...u, role_id: roleId ? parseInt(roleId) : null, role_name: role?.name || null }
          : u
        ));
      }
    } catch { /* ignore */ }
  };

  const createUser = async (e) => {
    e.preventDefault();
    setNewUserError('');
    if (!newUser.email.trim()) return setNewUserError('E-Mail ist erforderlich.');
    if (!newUser.password) return setNewUserError('Passwort ist erforderlich.');
    if (newUser.password !== newUser.password2) return setNewUserError('Passwörter stimmen nicht überein.');
    setNewUserSaving(true);
    try {
      const body = {
        email: newUser.email.trim(),
        password: newUser.password,
        name: newUser.name.trim() || undefined,
        role_id: newUser.role_id ? parseInt(newUser.role_id) : undefined
      };
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const d = await res.json();
      if (res.ok) {
        setNewUser(EMPTY_NEW_USER);
        setShowNewUser(false);
        await loadData();
      } else {
        setNewUserError(d.error || 'Fehler beim Anlegen.');
      }
    } catch { setNewUserError('Netzwerkfehler'); }
    setNewUserSaving(false);
  };

  const saveRole = async (data) => {
    setSaving(true);
    setError('');
    try {
      let res;
      if (editingRole === 'new') {
        res = await fetch('/api/roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
      } else {
        res = await fetch(`/api/roles/${editingRole.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
      }
      if (res.ok) {
        setEditingRole(null);
        await loadData();
      } else {
        const d = await res.json();
        setError(d.error || 'Fehler');
      }
    } catch { setError('Netzwerkfehler'); }
    setSaving(false);
  };

  const deleteRole = async (roleId) => {
    if (!confirm('Rolle wirklich löschen? Benutzer mit dieser Rolle verlieren sie.')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/roles/${roleId}`, { method: 'DELETE' });
      if (res.ok) {
        await loadData();
      } else {
        const d = await res.json();
        setError(d.error || 'Fehler');
      }
    } catch { setError('Netzwerkfehler'); }
    setSaving(false);
  };

  const copyLoginLink = async (userId) => {
    try {
      const res = await fetch(`/api/users/${userId}/login-link`, { method: 'POST' });
      const d = await res.json();
      if (!res.ok) return setError(d.error || 'Fehler beim Generieren des Links');
      await navigator.clipboard.writeText(d.url);
      setCopiedLinkId(userId);
      setTimeout(() => setCopiedLinkId(null), 2500);
    } catch {
      setError('Link konnte nicht kopiert werden');
    }
  };

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
    return d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  if (loading) return <div className="um-loading">Lade...</div>;

  return (
    <div className="um-page">
      <div className="um-section-tabs">
        <button
          className={`um-section-tab ${section === 'users' ? 'active' : ''}`}
          onClick={() => setSection('users')}
        >
          <Users size={16} />
          Benutzer
        </button>
        {isAdmin && (
          <button
            className={`um-section-tab ${section === 'roles' ? 'active' : ''}`}
            onClick={() => setSection('roles')}
          >
            <Shield size={16} />
            Rollen
          </button>
        )}
      </div>

      {error && <div className="um-error">{error}</div>}

      {/* ========== USERS ========== */}
      {section === 'users' && (
        <div className="um-users-list">
          {/* Create new user */}
          {!showNewUser ? (
            <button className="um-btn um-btn-primary um-add-role-btn" onClick={() => setShowNewUser(true)}>
              <Plus size={14} />
              Neuen Benutzer anlegen
            </button>
          ) : (
            <div className="um-new-user-form">
              <div className="um-new-user-title">Neuen Benutzer anlegen</div>
              <form onSubmit={createUser}>
                <div className="um-field">
                  <label>Name (optional)</label>
                  <input
                    className="um-input"
                    value={newUser.name}
                    onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))}
                    placeholder="Vorname Nachname"
                  />
                </div>
                <div className="um-field">
                  <label>E-Mail *</label>
                  <input
                    className="um-input"
                    type="email"
                    value={newUser.email}
                    onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))}
                    placeholder="benutzer@beispiel.at"
                    required
                  />
                </div>
                <div className="um-field">
                  <label>Passwort *</label>
                  <input
                    className="um-input"
                    type="password"
                    value={newUser.password}
                    onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))}
                    placeholder="Passwort"
                    required
                  />
                </div>
                <div className="um-field">
                  <label>Passwort wiederholen *</label>
                  <input
                    className="um-input"
                    type="password"
                    value={newUser.password2}
                    onChange={e => setNewUser(p => ({ ...p, password2: e.target.value }))}
                    placeholder="Passwort wiederholen"
                    required
                  />
                </div>
                <div className="um-field">
                  <label>Rolle</label>
                  <select
                    className="um-select um-select-full"
                    value={newUser.role_id}
                    onChange={e => setNewUser(p => ({ ...p, role_id: e.target.value }))}
                  >
                    <option value="">— Keine Rolle —</option>
                    {roles.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                {newUserError && <div className="um-error">{newUserError}</div>}
                <div className="um-role-editor-actions">
                  <button type="submit" className="um-btn um-btn-primary" disabled={newUserSaving}>
                    <Check size={14} />
                    {newUserSaving ? 'Anlegen...' : 'Benutzer anlegen'}
                  </button>
                  <button type="button" className="um-btn um-btn-ghost" onClick={() => { setShowNewUser(false); setNewUser(EMPTY_NEW_USER); setNewUserError(''); }}>
                    <X size={14} />
                    Abbrechen
                  </button>
                </div>
              </form>
            </div>
          )}

          {users.length === 0 && <p className="um-empty">Keine Benutzer gefunden.</p>}
          {users.map(user => (
            <div key={user.id} className={`um-user-row ${user.status}`}>
              <div className="um-user-avatar">
                {user.picture
                  ? <img src={user.picture} alt={user.name} referrerPolicy="no-referrer" />
                  : <div className="um-user-initials">{(user.name || user.email)[0].toUpperCase()}</div>
                }
              </div>
              <div className="um-user-info">
                <div className="um-user-name">{user.name}</div>
                <div className="um-user-email">{user.email}</div>
                <div className="um-user-meta">
                  Registriert: {formatDate(user.created_at)}
                  {user.last_login && ` · Letzter Login: ${formatDate(user.last_login)}`}
                </div>
              </div>
              <div className="um-user-controls">
                <select
                  className="um-select"
                  value={user.role_id || ''}
                  onChange={e => changeUserRole(user.id, e.target.value)}
                >
                  <option value="">— Keine Rolle —</option>
                  {roles.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
                <StatusBadge status={user.status} />
                {user.status === 'active' && (
                  <button
                    className={`um-btn ${copiedLinkId === user.id ? 'um-btn-success' : 'um-btn-secondary'}`}
                    onClick={() => copyLoginLink(user.id)}
                    title="Login-Link in Zwischenablage kopieren"
                  >
                    {copiedLinkId === user.id ? <Check size={14} /> : <Link size={14} />}
                    {copiedLinkId === user.id ? 'Kopiert!' : 'Link kopieren'}
                  </button>
                )}
                <button
                  className={`um-btn ${user.status === 'active' ? 'um-btn-danger' : 'um-btn-success'}`}
                  onClick={() => toggleUserStatus(user)}
                  disabled={saving}
                  title={user.status === 'active' ? 'Deaktivieren' : 'Aktivieren'}
                >
                  {user.status === 'active' ? <X size={14} /> : <Check size={14} />}
                  {user.status === 'active' ? 'Deaktivieren' : 'Aktivieren'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ========== ROLES ========== */}
      {section === 'roles' && isAdmin && (
        <div className="um-roles-section">
          {editingRole === 'new' && (
            <div className="um-role-card">
              <div className="um-role-header">
                <span className="um-role-name">Neue Rolle</span>
              </div>
              <RoleEditor
                role={null}
                isNew
                onSave={saveRole}
                onCancel={() => setEditingRole(null)}
                appSettings={appSettings}
              />
            </div>
          )}

          {roles.map(role => (
            <div key={role.id} className="um-role-card">
              <div
                className="um-role-header"
                onClick={() => setExpandedRole(expandedRole === role.id ? null : role.id)}
              >
                <div className="um-role-header-left">
                  <Shield size={16} className="um-role-icon" />
                  <span className="um-role-name">{role.name}</span>
                  {role.is_system === 1 && <span className="um-system-badge">System</span>}
                </div>
                <div className="um-role-header-right">
                  {!role.is_system && (
                    <button
                      className="um-btn-icon um-btn-danger-icon"
                      onClick={e => { e.stopPropagation(); deleteRole(role.id); }}
                      title="Rolle löschen"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                  {expandedRole === role.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
              </div>

              {expandedRole === role.id && (
                editingRole?.id === role.id ? (
                  <RoleEditor
                    role={role}
                    isNew={false}
                    onSave={saveRole}
                    onCancel={() => setEditingRole(null)}
                    appSettings={appSettings}
                  />
                ) : (
                  <div className="um-role-details">
                    <div className="um-perm-display">
                      <PermRow label="Benutzer freischalten" value={role.permissions.approve_users} />
                      <PermRow label="Inbox verwalten" value={role.permissions.manage_inbox} />
                      <PermRow label="Einstellungen" value={role.permissions.access_settings} />
                      <PermRow
                        label="Sichtbare Tabs"
                        value={(role.permissions.view_tabs || [])
                          .map(t => ALL_TABS.find(x => x.id === t)?.label || t)
                          .join(', ') || '—'}
                        isText
                      />

                    </div>
                    <button className="um-btn um-btn-secondary" onClick={() => setEditingRole(role)}>
                      Bearbeiten
                    </button>
                  </div>
                )
              )}
            </div>
          ))}

          {editingRole !== 'new' && (
            <button className="um-btn um-btn-primary um-add-role-btn" onClick={() => { setEditingRole('new'); setExpandedRole(null); }}>
              <Plus size={14} />
              Neue Rolle erstellen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PermRow({ label, value, isText }) {
  return (
    <div className="um-perm-display-row">
      <span className="um-perm-label">{label}</span>
      {isText
        ? <span className="um-perm-text">{value}</span>
        : <span className={`um-perm-val ${value ? 'yes' : 'no'}`}>{value ? '✓ Ja' : '✗ Nein'}</span>
      }
    </div>
  );
}
