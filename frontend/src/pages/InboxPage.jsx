import { useState, useEffect, useCallback } from 'react';
import {
  Inbox, Upload, FolderPlus, Trash2, GitMerge, Camera,
  UserCheck, ChevronDown, ChevronUp, Check, X, Eye,
  FolderOpen, RefreshCw, Image
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import './InboxPage.css';

const TYPE_CONFIG = {
  image_upload:   { icon: Upload,      label: 'Foto hochgeladen',  color: '#3b82f6' },
  project_create: { icon: FolderPlus,  label: 'Projekt erstellt',  color: '#10b981' },
  inbox_item:     { icon: Camera,      label: 'Neue Uploads',      color: '#f59e0b' },
  delete_request: { icon: Trash2,      label: 'Löschanfrage',      color: '#ef4444' },
  project_change: { icon: GitMerge,    label: 'Projektänderung',   color: '#8b5cf6' },
};

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr.endsWith('Z') ? isoStr : isoStr + 'Z');
  return d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr.endsWith('Z') ? isoStr : isoStr + 'Z');
  return d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr.endsWith('Z') ? isoStr : isoStr + 'Z');
  return d.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
}

function groupByDate(activities) {
  const groups = new Map();
  for (const a of activities) {
    const dateKey = formatDate(a.created_at);
    if (!groups.has(dateKey)) groups.set(dateKey, []);
    groups.get(dateKey).push(a);
  }
  return groups;
}

// ─── Pending Users ────────────────────────────────────────────────────────────
function PendingUsersSection() {
  const [pendingUsers, setPendingUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [selectedRoles, setSelectedRoles] = useState({});
  const [approving, setApproving] = useState({});

  const load = useCallback(async () => {
    try {
      const [uRes, rRes] = await Promise.all([fetch('/api/users/pending'), fetch('/api/roles')]);
      if (uRes.ok) setPendingUsers((await uRes.json()).users);
      if (rRes.ok) setRoles((await rRes.json()).roles);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (pendingUsers.length === 0) return null;

  const handleApprove = async (userId) => {
    const roleId = selectedRoles[userId];
    if (!roleId) return;
    setApproving(p => ({ ...p, [userId]: true }));
    try {
      const res = await fetch(`/api/users/${userId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_id: parseInt(roleId) })
      });
      if (res.ok) setPendingUsers(p => p.filter(u => u.id !== userId));
    } catch { /* ignore */ }
    setApproving(p => ({ ...p, [userId]: false }));
  };

  return (
    <div className="inbox-pending-section">
      <div className="inbox-pending-header">
        <UserCheck size={18} className="inbox-pending-icon" />
        <span>Benutzer warten auf Freischaltung</span>
        <span className="inbox-pending-count">{pendingUsers.length}</span>
      </div>
      <div className="inbox-pending-list">
        {pendingUsers.map(user => (
          <div key={user.id} className="inbox-pending-user">
            <div className="inbox-pending-user-info">
              {user.picture
                ? <img src={user.picture} alt={user.name} className="inbox-pending-avatar" referrerPolicy="no-referrer" />
                : <div className="inbox-pending-initials">{(user.name || user.email)[0].toUpperCase()}</div>
              }
              <div>
                <div className="inbox-pending-name">{user.name}</div>
                <div className="inbox-pending-email">{user.email}</div>
                <div className="inbox-pending-date">Registriert: {formatDateTime(user.created_at)}</div>
              </div>
            </div>
            <div className="inbox-pending-actions">
              <select className="inbox-pending-select"
                value={selectedRoles[user.id] || ''}
                onChange={e => setSelectedRoles(p => ({ ...p, [user.id]: e.target.value }))}>
                <option value="">Rolle wählen...</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <button className="inbox-pending-approve-btn"
                disabled={!selectedRoles[user.id] || approving[user.id]}
                onClick={() => handleApprove(user.id)}>
                <UserCheck size={14} />Freischalten
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Inbox Items (new uploads without project) ────────────────────────────────
function InboxItemRow({ item, projects, canManage, onDone }) {
  const [expanded, setExpanded] = useState(false);
  const [images, setImages] = useState(null);
  const [loadingImages, setLoadingImages] = useState(false);
  const [mergeProjectId, setMergeProjectId] = useState('');
  const [newProjectName, setNewProjectName] = useState(item.project_name || item.original_name || '');
  const [showConfirmForm, setShowConfirmForm] = useState(false);
  const [showMergeForm, setShowMergeForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadImages = async () => {
    if (images !== null) return;
    setLoadingImages(true);
    try {
      const res = await fetch(`/api/mobile/inbox/${item.drive_folder_id}/images`);
      if (res.ok) setImages(await res.json());
    } catch { setImages([]); }
    setLoadingImages(false);
  };

  const handleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) loadImages();
  };

  const handleConfirm = async () => {
    if (!newProjectName.trim()) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/mobile/inbox/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: item.drive_folder_id, inboxFolderId: item.inbox_folder_id, projectName: newProjectName.trim() })
      });
      if (res.ok) { onDone(); return; }
      const d = await res.json();
      setError(d.error || 'Fehler');
    } catch { setError('Netzwerkfehler'); }
    setBusy(false);
  };

  const handleMerge = async () => {
    if (!mergeProjectId) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/mobile/inbox/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceFolderId: item.drive_folder_id, targetProjectId: parseInt(mergeProjectId), inboxFolderId: item.inbox_folder_id, projectName: item.project_name })
      });
      if (res.ok) { onDone(); return; }
      const d = await res.json();
      setError(d.error || 'Fehler');
    } catch { setError('Netzwerkfehler'); }
    setBusy(false);
  };

  const handleDelete = async () => {
    if (!confirm(`Inbox-Eintrag „${item.project_name}" wirklich löschen?`)) return;
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/mobile/inbox/${item.drive_folder_id}`, { method: 'DELETE' });
      if (res.ok) { onDone(); return; }
      const d = await res.json();
      setError(d.error || 'Fehler');
    } catch { setError('Netzwerkfehler'); }
    setBusy(false);
  };

  const imgFilter = images ? images.filter(f => f.mimeType && f.mimeType.startsWith('image/')) : [];

  return (
    <div className="inbox-entry-card">
      <div className="inbox-entry-header" onClick={handleExpand}>
        <div className="inbox-entry-header-left">
          <div className="inbox-entry-icon" style={{ background: '#f59e0b22', color: '#f59e0b' }}>
            <Camera size={16} />
          </div>
          <div>
            <div className="inbox-entry-title">{item.project_name}</div>
            <div className="inbox-entry-meta">
              {item.image_count > 0 && <span>{item.image_count} Bild{item.image_count !== 1 ? 'er' : ''}</span>}
              {item.device_user && item.device_user !== 'Handy-App' && <span>· von {item.device_user}</span>}
            </div>
          </div>
        </div>
        <div className="inbox-entry-header-right">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {expanded && (
        <div className="inbox-entry-body">
          {/* Image grid */}
          {loadingImages && <div className="inbox-entry-loading">Lade Bilder…</div>}
          {!loadingImages && imgFilter.length > 0 && (
            <div className="inbox-image-grid">
              {imgFilter.map(img => (
                <div key={img.id} className="inbox-image-thumb">
                  <img
                    src={`/api/mobile/inbox/image-proxy/${img.id}`}
                    alt={img.name}
                    loading="lazy"
                  />
                  <span className="inbox-image-name">{img.name}</span>
                </div>
              ))}
            </div>
          )}
          {!loadingImages && imgFilter.length === 0 && (
            <p className="inbox-entry-no-images">Keine Bilder gefunden</p>
          )}

          {error && <div className="inbox-entry-error">{error}</div>}

          {canManage && (
            <div className="inbox-entry-actions">
              {/* Confirm as project */}
              {!showMergeForm && (
                <div className="inbox-action-group">
                  {!showConfirmForm ? (
                    <button className="inbox-action-btn inbox-action-confirm"
                      onClick={() => { setShowConfirmForm(true); setShowMergeForm(false); }}>
                      <FolderPlus size={14} />
                      Als Projekt anlegen
                    </button>
                  ) : (
                    <div className="inbox-action-form">
                      <input
                        className="inbox-action-input"
                        value={newProjectName}
                        onChange={e => setNewProjectName(e.target.value)}
                        placeholder="Projektname"
                      />
                      <button className="inbox-action-btn inbox-action-confirm" onClick={handleConfirm} disabled={busy || !newProjectName.trim()}>
                        <Check size={14} />Anlegen
                      </button>
                      <button className="inbox-action-btn inbox-action-cancel" onClick={() => setShowConfirmForm(false)}>
                        <X size={14} />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Merge with existing project */}
              {!showConfirmForm && (
                <div className="inbox-action-group">
                  {!showMergeForm ? (
                    <button className="inbox-action-btn inbox-action-merge"
                      onClick={() => { setShowMergeForm(true); setShowConfirmForm(false); }}>
                      <GitMerge size={14} />
                      Zusammenführen
                    </button>
                  ) : (
                    <div className="inbox-action-form">
                      <select className="inbox-action-select" value={mergeProjectId}
                        onChange={e => setMergeProjectId(e.target.value)}>
                        <option value="">Projekt wählen…</option>
                        {projects.map(p => <option key={p.id} value={p.id}>{p.folder_name}</option>)}
                      </select>
                      <button className="inbox-action-btn inbox-action-merge" onClick={handleMerge} disabled={busy || !mergeProjectId}>
                        <Check size={14} />Zusammenführen
                      </button>
                      <button className="inbox-action-btn inbox-action-cancel" onClick={() => setShowMergeForm(false)}>
                        <X size={14} />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Delete */}
              {!showConfirmForm && !showMergeForm && (
                <button className="inbox-action-btn inbox-action-delete" onClick={handleDelete} disabled={busy}>
                  <Trash2 size={14} />
                  Löschen
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Project Changes ──────────────────────────────────────────────────────────
function ProjectChangeRow({ change, canManage, onDone }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    setBusy(true); setError('');
    try {
      const fileIds = change.new_images.map(i => i.id);
      const res = await fetch('/api/mobile/project-changes/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName: change.project_name, fileIds })
      });
      if (res.ok) { onDone(); return; }
      const d = await res.json();
      setError(d.error || 'Fehler');
    } catch { setError('Netzwerkfehler'); }
    setBusy(false);
  };

  const handleReject = async () => {
    if (!confirm(`Neue Bilder in „${change.project_name}" wirklich ablehnen und löschen?`)) return;
    setBusy(true); setError('');
    try {
      const fileIds = change.new_images.map(i => i.id);
      const res = await fetch('/api/mobile/project-changes/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName: change.project_name, fileIds })
      });
      if (res.ok) { onDone(); return; }
      const d = await res.json();
      setError(d.error || 'Fehler');
    } catch { setError('Netzwerkfehler'); }
    setBusy(false);
  };

  return (
    <div className="inbox-entry-card">
      <div className="inbox-entry-header" onClick={() => setExpanded(e => !e)}>
        <div className="inbox-entry-header-left">
          <div className="inbox-entry-icon" style={{ background: '#8b5cf622', color: '#8b5cf6' }}>
            <GitMerge size={16} />
          </div>
          <div>
            <div className="inbox-entry-title">{change.project_name}</div>
            <div className="inbox-entry-meta">
              <span>{change.new_images.length} neue{change.new_images.length !== 1 ? ' Bilder' : 's Bild'}</span>
              {change.uploaders.length > 0 && <span>· von {change.uploaders.join(', ')}</span>}
            </div>
          </div>
        </div>
        <div className="inbox-entry-header-right">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {expanded && (
        <div className="inbox-entry-body">
          {change.new_images.length > 0 && (
            <div className="inbox-change-filelist">
              {change.new_images.map(img => (
                <div key={img.id} className="inbox-change-file">
                  <Image size={14} />
                  <span>{img.name}</span>
                </div>
              ))}
            </div>
          )}

          {error && <div className="inbox-entry-error">{error}</div>}

          {canManage && (
            <div className="inbox-entry-actions">
              <button className="inbox-action-btn inbox-action-confirm" onClick={handleConfirm} disabled={busy}>
                <Check size={14} />Hinzufügen
              </button>
              <button className="inbox-action-btn inbox-action-delete" onClick={handleReject} disabled={busy}>
                <X size={14} />Ablehnen
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function InboxPage() {
  const { user } = useAuth();
  const canApproveUsers = user?.permissions?.approve_users;
  const canManageInbox = user?.permissions?.manage_inbox;

  const [inboxItems, setInboxItems] = useState([]);
  const [projectChanges, setProjectChanges] = useState([]);
  const [projects, setProjects] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingInbox, setLoadingInbox] = useState(true);

  const loadActivities = useCallback(async () => {
    try {
      const res = await fetch('/api/mobile/activities');
      if (res.ok) {
        const data = await res.json();
        setActivities(data.activities || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const loadInbox = useCallback(async () => {
    setLoadingInbox(true);
    try {
      const [inboxRes, changesRes, projRes] = await Promise.all([
        fetch('/api/mobile/inbox'),
        fetch('/api/mobile/project-changes'),
        fetch('/api/projects'),
      ]);
      if (inboxRes.ok) {
        const d = await inboxRes.json();
        setInboxItems(d.projects || d || []);
      }
      if (changesRes.ok) {
        const d = await changesRes.json();
        setProjectChanges(d.changes || []);
      }
      if (projRes.ok) {
        const d = await projRes.json();
        setProjects(d.projects || d || []);
      }
    } catch { /* ignore */ }
    setLoadingInbox(false);
  }, []);

  useEffect(() => {
    loadActivities();
    loadInbox();
    fetch('/api/mobile/activities/read', { method: 'POST' }).catch(() => {});
  }, [loadActivities, loadInbox]);

  const grouped = groupByDate(activities);
  const hasPendingItems = inboxItems.length > 0 || projectChanges.length > 0;

  return (
    <div className="inbox-page">
      <div className="inbox-page-header">
        <Inbox size={22} />
        <h1>Inbox</h1>
        <span className="inbox-page-subtitle">Aktivitäten der Handy-App</span>
        <button className="inbox-refresh-btn" onClick={() => { loadInbox(); loadActivities(); }} title="Aktualisieren">
          <RefreshCw size={15} />
        </button>
      </div>

      {/* Pending user approvals */}
      {canApproveUsers && <PendingUsersSection />}

      {/* Pending inbox items */}
      {(loadingInbox || hasPendingItems) && (
        <div className="inbox-section">
          <div className="inbox-section-title">
            <Camera size={16} />
            Ausstehende Uploads
            {!loadingInbox && hasPendingItems && (
              <span className="inbox-section-count">{inboxItems.length + projectChanges.length}</span>
            )}
          </div>

          {loadingInbox && <div className="inbox-entry-loading">Lade Daten von Google Drive…</div>}

          {!loadingInbox && !hasPendingItems && (
            <p className="inbox-empty-hint">Keine ausstehenden Uploads.</p>
          )}

          {!loadingInbox && inboxItems.map(item => (
            <InboxItemRow
              key={item.id || item.drive_folder_id}
              item={item}
              projects={projects}
              canManage={canManageInbox}
              onDone={loadInbox}
            />
          ))}

          {!loadingInbox && projectChanges.map(change => (
            <ProjectChangeRow
              key={change.drive_folder_id || change.project_name}
              change={change}
              canManage={canManageInbox}
              onDone={loadInbox}
            />
          ))}
        </div>
      )}

      {/* Activity log */}
      <div className="inbox-section">
        <div className="inbox-section-title">
          <Inbox size={16} />
          Aktivitäten
        </div>

        {loading && <div className="inbox-entry-loading">Lade Aktivitäten…</div>}

        {!loading && activities.length === 0 && (
          <div className="inbox-page-empty">
            <Inbox size={40} className="inbox-page-empty-icon" />
            <p>Noch keine Aktivitäten</p>
            <span>Sobald die App Fotos hochlädt oder Projekte erstellt, erscheinen sie hier.</span>
          </div>
        )}

        {!loading && activities.length > 0 && (
          <div className="inbox-page-list">
            {[...grouped.entries()].map(([dateKey, items]) => (
              <div key={dateKey} className="inbox-day-group">
                <div className="inbox-day-label">{dateKey}</div>
                {items.map(a => {
                  const cfg = TYPE_CONFIG[a.type] || { icon: Inbox, label: a.type, color: '#6b7280' };
                  const Icon = cfg.icon;
                  return (
                    <div key={a.id} className="inbox-activity-item">
                      <div className="inbox-activity-icon" style={{ background: cfg.color + '22', color: cfg.color }}>
                        <Icon size={16} />
                      </div>
                      <div className="inbox-activity-body">
                        <div className="inbox-activity-title">{a.title}</div>
                        {a.description && <div className="inbox-activity-desc">{a.description}</div>}
                        {a.device_name && <div className="inbox-activity-meta">von {a.device_name}</div>}
                      </div>
                      <div className="inbox-activity-time">{formatTime(a.created_at)}</div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
