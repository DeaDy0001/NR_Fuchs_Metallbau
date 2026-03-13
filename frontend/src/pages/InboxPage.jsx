import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Inbox, Upload, FolderPlus, Trash2, Camera,
  UserCheck, ChevronDown, ChevronUp, Check, X,
  RefreshCw, ChevronLeft, ChevronRight, Pencil, FileText
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import './InboxPage.css';

// ─── Shared Helpers ───────────────────────────────────────────────────────────

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

const TYPE_CONFIG = {
  image_upload:   { icons: [{ Icon: Upload,    color: '#3b82f6' }], label: 'Bilder hinzugefügt' },
  project_create: { icons: [{ Icon: FolderPlus,color: '#10b981' }], label: 'Projekt erstellt'   },
  project_notes:  { icons: [{ Icon: FileText,  color: '#8b5cf6' }], label: 'Projektnotiz'       },
  image_change:   { icons: [{ Icon: Pencil,    color: '#f59e0b' }], label: 'Bild geändert'      },
  delete_request: { icons: [{ Icon: Trash2,    color: '#ef4444' }], label: 'Löschanfrage'       },
  // legacy
  inbox_item:     { icons: [{ Icon: Camera,    color: '#f59e0b' }], label: 'Neue Uploads'       },
  project_change: { icons: [{ Icon: Camera,    color: '#f59e0b' }], label: 'Projektänderung'    },
};

// ─── Icon Group ───────────────────────────────────────────────────────────────
function EntryIconGroup({ icons }) {
  if (icons.length === 1) {
    const { Icon, color } = icons[0];
    return (
      <div className="inbox-entry-icon" style={{ background: color + '22', color }}>
        <Icon size={16} />
      </div>
    );
  }
  return (
    <div className="inbox-entry-icon-group">
      {icons.map(({ Icon, color }, i) => (
        <div key={i} className="inbox-entry-icon-badge" style={{ background: color + '33', color }}>
          <Icon size={12} />
        </div>
      ))}
    </div>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────
function Badge({ label, color = '#3b82f6' }) {
  return (
    <span className="inbox-badge-pill" style={{ background: color + '22', color, borderColor: color + '44' }}>
      {label}
    </span>
  );
}

// ─── Project Picker (searchable dropdown) ─────────────────────────────────────
function ProjectPicker({ projects, value, onChange, placeholder = 'Projekt suchen…', allowNone = true }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 220 });
  const triggerRef = useRef(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return q ? projects.filter(p => p.folder_name.toLowerCase().includes(q)) : projects;
  }, [projects, search]);

  const selected = projects.find(p => p.id === value);

  // Recalculate dropdown position whenever it opens
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setDropPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 220) });
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (!triggerRef.current?.contains(e.target)) { setOpen(false); setSearch(''); }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const dropdown = open && createPortal(
    <div
      className="project-picker-dropdown"
      style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, minWidth: dropPos.width, zIndex: 9999 }}
      onMouseDown={e => e.stopPropagation()}
    >
      <input
        className="project-picker-search"
        autoFocus
        placeholder="Suchen…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      {allowNone && (
        <div
          className={`project-picker-option${!value ? ' selected' : ''}`}
          onClick={() => { onChange(null); setOpen(false); setSearch(''); }}
        >
          <em>Ohne Projekt (Bibliothek)</em>
        </div>
      )}
      {filtered.slice(0, 50).map(p => (
        <div
          key={p.id}
          className={`project-picker-option${value === p.id ? ' selected' : ''}`}
          onClick={() => { onChange(p.id); setOpen(false); setSearch(''); }}
        >
          {p.folder_name}
        </div>
      ))}
      {filtered.length === 0 && <div className="project-picker-empty">Kein Ergebnis</div>}
    </div>,
    document.body
  );

  return (
    <div className="project-picker" ref={triggerRef}>
      <div
        className="inbox-action-input project-picker-trigger"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', minWidth: 180 }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ color: selected ? 'var(--text-primary)' : 'var(--text-tertiary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.folder_name : (allowNone ? 'Ohne Projekt (Bibliothek)' : placeholder)}
        </span>
        <ChevronDown size={14} style={{ flexShrink: 0, marginLeft: 4 }} />
      </div>
      {dropdown}
    </div>
  );
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────
function InboxLightbox({ images, startIndex, onClose, entry }) {
  const [index, setIndex] = useState(startIndex);
  const [meta, setMeta] = useState(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [locationName, setLocationName] = useState(null);
  const img = images[index];

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) setIndex(i => i - 1);
      if (e.key === 'ArrowRight' && index < images.length - 1) setIndex(i => i + 1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [index, images.length, onClose]);

  // Fetch Drive file metadata when image changes
  useEffect(() => {
    setMeta(null);
    setMetaLoading(true);
    fetch(`/api/mobile/inbox/image-meta/${img.drive_file_id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setMeta(data))
      .catch(() => {})
      .finally(() => setMetaLoading(false));
  }, [img.drive_file_id]);

  const formatSize = (bytes) => {
    if (!bytes) return '–';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatDateTime = (iso) => {
    if (!iso) return null;
    const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
    return d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
      + '  ' + d.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  };

  const displayTitle = img.custom_title || meta?.customTitle || null;
  const displayNotes = img.notes || meta?.notes || null;
  const gps = meta?.gps || null;

  // Reverse-geocode GPS coordinates to a human-readable location name
  useEffect(() => {
    if (!gps?.latitude || !gps?.longitude) { setLocationName(null); return; }
    let cancelled = false;
    fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${gps.latitude}&lon=${gps.longitude}&format=json&accept-language=de`,
      { headers: { 'Accept-Language': 'de' } }
    )
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled && data?.display_name) setLocationName(data.display_name); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [gps?.latitude, gps?.longitude]);

  return (
    <div className="inbox-lightbox-overlay" onClick={onClose}>
      <button className="inbox-lightbox-close" onClick={onClose} title="Schließen (Esc)"><X size={20} /></button>
      {index > 0 && (
        <button className="inbox-lightbox-nav inbox-lightbox-prev" onClick={e => { e.stopPropagation(); setIndex(i => i - 1); }}>
          <ChevronLeft size={24} />
        </button>
      )}
      {index < images.length - 1 && (
        <button className="inbox-lightbox-nav inbox-lightbox-next" onClick={e => { e.stopPropagation(); setIndex(i => i + 1); }}>
          <ChevronRight size={24} />
        </button>
      )}
      <div className="inbox-lightbox-content" onClick={e => e.stopPropagation()}>
        <div className="inbox-lightbox-image-area">
          <img
            src={`/api/mobile/inbox/image-proxy/${img.drive_file_id}`}
            alt={displayTitle || img.file_name}
            className="inbox-lightbox-img"
          />
        </div>
        <div className="inbox-lightbox-sidebar">
          <div className="inbox-lightbox-counter">{index + 1} / {images.length}</div>

          {displayTitle && (
            <div className="inbox-lightbox-section">
              <div className="inbox-lightbox-label">Name</div>
              <div className="inbox-lightbox-value">{displayTitle}</div>
            </div>
          )}

          <div className="inbox-lightbox-section">
            <div className="inbox-lightbox-label">Dateiname</div>
            <div className="inbox-lightbox-value inbox-lightbox-filename">{img.file_name}</div>
          </div>

          <div className="inbox-lightbox-section">
            <div className="inbox-lightbox-label">Notizen</div>
            <div className="inbox-lightbox-notes">{displayNotes || 'Keine Notizen vorhanden'}</div>
          </div>

          {entry?.created_at && (
            <div className="inbox-lightbox-section">
              <div className="inbox-lightbox-label">Hochgeladen am</div>
              <div className="inbox-lightbox-value">{formatDateTime(entry.created_at)}</div>
            </div>
          )}

          {meta?.photoTakenAt && (
            <div className="inbox-lightbox-section">
              <div className="inbox-lightbox-label">Aufgenommen am</div>
              <div className="inbox-lightbox-value">{formatDateTime(meta.photoTakenAt)}</div>
            </div>
          )}

          <div className="inbox-lightbox-section">
            <div className="inbox-lightbox-label">Größe</div>
            <div className="inbox-lightbox-value">{metaLoading ? '…' : formatSize(meta?.size)}</div>
          </div>

          {meta?.width && meta?.height && (
            <div className="inbox-lightbox-section">
              <div className="inbox-lightbox-label">Auflösung</div>
              <div className="inbox-lightbox-value">{meta.width} × {meta.height} px</div>
            </div>
          )}

          {gps && (
            <div className="inbox-lightbox-section">
              <div className="inbox-lightbox-label">Standort</div>
              <div className="inbox-lightbox-value">
                <a
                  href={`https://www.google.com/maps?q=${gps.latitude},${gps.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${parseFloat(gps.latitude).toFixed(6)}, ${parseFloat(gps.longitude).toFixed(6)} – In Google Maps öffnen`}
                  style={{ color: 'var(--accent, #4f8ef7)', textDecoration: 'underline', cursor: 'pointer', wordBreak: 'break-word' }}
                >
                  {locationName || `${parseFloat(gps.latitude).toFixed(6)}, ${parseFloat(gps.longitude).toFixed(6)}`}
                </a>
                {gps.altitude != null && (
                  <span style={{ opacity: 0.6, marginLeft: 6 }}>({parseFloat(gps.altitude).toFixed(0)} m)</span>
                )}
              </div>
            </div>
          )}

          {entry?.user_name && (
            <div className="inbox-lightbox-section">
              <div className="inbox-lightbox-label">Hochgeladen von</div>
              <div className="inbox-lightbox-value">{entry.user_name}</div>
            </div>
          )}

          {entry?.device_name && (
            <div className="inbox-lightbox-section">
              <div className="inbox-lightbox-label">Gerät</div>
              <div className="inbox-lightbox-value">{entry.device_name}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
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
    setPendingUsers(p => p.filter(u => u.id !== userId));
    setApproving(p => ({ ...p, [userId]: true }));
    try {
      await fetch(`/api/users/${userId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_id: parseInt(roleId) })
      });
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
              <button className="inbox-action-btn inbox-action-confirm"
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

// ─── Image Request Row ────────────────────────────────────────────────────────
function ImageRequestRow({ entry, projects, canManage, onRemove, onActivity }) {
  const { user: currentUser } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [selectedIds, setSelectedIds] = useState(null); // null = all
  const [targetProjectId, setTargetProjectId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const hasNewProject = !entry.project_folder_id && entry.project_name;
  const hasExistingProject = !!entry.project_folder_id;

  // Default to matching project
  useEffect(() => {
    if (entry.project_folder_id) {
      const match = projects.find(p =>
        p.drive_folder_id === entry.project_folder_id || p.folder_name === entry.project_name
      );
      if (match) setTargetProjectId(match.id);
    }
  }, [entry.project_folder_id, entry.project_name, projects]);

  const icons = hasNewProject || hasExistingProject
    ? [{ Icon: Camera, color: '#f59e0b' }, { Icon: FolderPlus, color: '#10b981' }]
    : [{ Icon: Camera, color: '#f59e0b' }];

  const toggleImage = (id) => {
    setSelectedIds(prev => {
      const all = new Set(entry.images.map(i => i.drive_file_id));
      const current = prev ? new Set(prev) : new Set(all);
      if (current.has(id)) {
        current.delete(id);
      } else {
        current.add(id);
      }
      const arr = [...current];
      return arr.length === all.size ? null : arr;
    });
  };

  const handleAdd = async () => {
    if (busy) return;
    setBusy(true);
    const ids = selectedIds || null;
    const count = ids ? ids.length : entry.images.length;

    try {
      const res = await fetch('/api/mobile/inbox/process-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: entry.id, selectedImageIds: ids, projectId: targetProjectId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`Fehler: ${data.error || 'Unbekannter Fehler'}`);
        setBusy(false);
        return;
      }
      const projName = targetProjectId
        ? (projects.find(p => p.id === targetProjectId)?.folder_name || entry.project_name)
        : 'Bibliothek';
      const actualCount = data.downloaded ?? count;
      onActivity({
        id: `local_${Date.now()}`,
        type: 'image_upload',
        title: `${actualCount} Bild${actualCount !== 1 ? 'er' : ''} hinzugefügt`,
        description: `Zu „${projName}" – von ${entry.user_name || entry.device_name}`,
        confirmed_by: currentUser?.name || null,
        created_at: new Date().toISOString(),
      });
      if (data.remaining === 0) {
        onRemove(entry.id);
      }
    } catch { /* ignore network errors */ }
    setBusy(false);
  };

  const handleReject = async () => {
    if (!confirm('Bilder wirklich ablehnen und löschen?')) return;
    setBusy(true);
    const ids = selectedIds || null;
    await fetch('/api/mobile/inbox/reject-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: entry.id, selectedImageIds: ids }),
    }).catch(() => {});
    onRemove(entry.id);
    setBusy(false);
  };

  return (
    <div className="inbox-entry-card">
      <div className="inbox-entry-header" onClick={() => setExpanded(e => !e)}>
        <div className="inbox-entry-header-left">
          <EntryIconGroup icons={icons} />
          <div>
            <div className="inbox-entry-badges">
              {entry.images.length > 0 && (
                <Badge label={`${entry.images.length} Bild${entry.images.length !== 1 ? 'er' : ''}`} color="#f59e0b" />
              )}
              {entry.project_name && (
                <Badge label={hasNewProject ? `Neues Projekt: ${entry.project_name}` : entry.project_name} color="#10b981" />
              )}
              {!entry.project_name && <Badge label="Ohne Projekt" color="#6b7280" />}
            </div>
            <div className="inbox-entry-meta">
              {(entry.user_name || entry.device_name) && (
                <span>Anfrage von {entry.user_name || entry.device_name}</span>
              )}
              {entry.created_at && <span>· {formatDateTime(entry.created_at)}</span>}
            </div>
          </div>
        </div>
        <div className="inbox-entry-header-right">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {expanded && (
        <div className="inbox-entry-body">
          {/* Lazy image grid */}
          {entry.images.length > 0 && (
            <div className="inbox-image-grid">
              {entry.images.map((img, idx) => {
                const isSelected = !selectedIds || selectedIds.includes(img.drive_file_id);
                return (
                  <div
                    key={img.drive_file_id}
                    className={`inbox-image-thumb inbox-image-thumb-clickable${!isSelected ? ' inbox-image-thumb-deselected' : ''}`}
                    onClick={() => setLightboxIndex(idx)}
                    title={img.custom_title || img.file_name}
                  >
                    <img
                      src={`/api/mobile/inbox/image-proxy/${img.drive_file_id}`}
                      alt={img.custom_title || img.file_name}
                      loading="lazy"
                    />
                    <span className="inbox-image-name">{img.custom_title || img.file_name}</span>
                    {canManage && (
                      <button
                        className={`inbox-image-select-btn${isSelected ? ' selected' : ''}`}
                        onClick={e => { e.stopPropagation(); toggleImage(img.drive_file_id); }}
                        title={isSelected ? 'Abwählen' : 'Auswählen'}
                      >
                        {isSelected ? <Check size={11} /> : <X size={11} />}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {canManage && (
            <div className="inbox-entry-actions">
              <ProjectPicker
                projects={projects}
                value={targetProjectId}
                onChange={setTargetProjectId}
                allowNone
              />
              <button
                className="inbox-action-btn inbox-action-confirm"
                onClick={handleAdd}
                disabled={busy}
              >
                <Check size={14} />Hinzufügen
              </button>
              <button
                className="inbox-action-btn inbox-action-delete"
                onClick={handleReject}
                disabled={busy}
              >
                <X size={14} />Ablehnen
              </button>
            </div>
          )}
        </div>
      )}

      {lightboxIndex !== null && (
        <InboxLightbox
          images={entry.images}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          entry={entry}
        />
      )}
    </div>
  );
}

// ─── Projekt Request Row ──────────────────────────────────────────────────────
function ProjektRequestRow({ entry, canManage, onRemove, onActivity }) {
  const { user: currentUser } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [projectName, setProjectName] = useState(entry.project_name);
  const [busy, setBusy] = useState(false);

  const handleCreate = async () => {
    if (!projectName.trim() || busy) return;
    setBusy(true);
    try {
      await fetch('/api/mobile/inbox/process-projekt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: entry.id, projectName: projectName.trim() }),
      });
      onActivity({
        id: `local_${Date.now()}`,
        type: 'project_create',
        title: `Projekt angelegt: „${projectName.trim()}"`,
        description: `Anfrage von ${entry.user_name || entry.device_name}`,
        confirmed_by: currentUser?.name || null,
        created_at: new Date().toISOString(),
      });
      onRemove(entry.id);
    } catch { /* ignore */ }
    setBusy(false);
  };

  const handleReject = async () => {
    setBusy(true);
    await fetch('/api/mobile/inbox/reject-projekt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: entry.id }),
    }).catch(() => {});
    onRemove(entry.id);
    setBusy(false);
  };

  return (
    <div className="inbox-entry-card">
      <div className="inbox-entry-header" onClick={() => setExpanded(e => !e)}>
        <div className="inbox-entry-header-left">
          <EntryIconGroup icons={[{ Icon: FolderPlus, color: '#10b981' }]} />
          <div>
            <div className="inbox-entry-badges">
              <Badge label="Neues Projekt" color="#10b981" />
              <Badge label={entry.project_name} color="#6b7280" />
            </div>
            <div className="inbox-entry-meta">
              {(entry.user_name || entry.device_name) && (
                <span>Anfrage von {entry.user_name || entry.device_name}</span>
              )}
              {entry.created_at && <span>· {formatDateTime(entry.created_at)}</span>}
            </div>
          </div>
        </div>
        <div className="inbox-entry-header-right">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {expanded && (
        <div className="inbox-entry-body">
          {entry.notes && (
            <p className="inbox-entry-notes">{entry.notes}</p>
          )}
          {canManage && (
            <div className="inbox-entry-actions">
              <input
                className="inbox-action-input"
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                placeholder="Projektname"
                style={{ minWidth: 180 }}
              />
              <button
                className="inbox-action-btn inbox-action-confirm"
                onClick={handleCreate}
                disabled={busy || !projectName.trim()}
              >
                <Check size={14} />Anlegen
              </button>
              <button
                className="inbox-action-btn inbox-action-delete"
                onClick={handleReject}
                disabled={busy}
              >
                <X size={14} />Ablehnen
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Projekt Change Row ───────────────────────────────────────────────────────
function ProjektChangeRow({ entry, canManage, onRemove, onActivity }) {
  const { user: currentUser } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleApply = async () => {
    setBusy(true);
    try {
      await fetch('/api/mobile/inbox/process-projekt-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: entry.id }),
      });
      onActivity({
        id: `local_${Date.now()}`,
        type: 'project_notes',
        title: `Projektnotiz zu „${entry.project_name}"`,
        description: `Von ${entry.user_name || entry.device_name}`,
        confirmed_by: currentUser?.name || null,
        created_at: new Date().toISOString(),
      });
      onRemove(entry.id);
    } catch { /* ignore */ }
    setBusy(false);
  };

  const handleReject = async () => {
    setBusy(true);
    await fetch('/api/mobile/inbox/reject-projekt-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: entry.id }),
    }).catch(() => {});
    onRemove(entry.id);
    setBusy(false);
  };

  return (
    <div className="inbox-entry-card">
      <div className="inbox-entry-header" onClick={() => setExpanded(e => !e)}>
        <div className="inbox-entry-header-left">
          <EntryIconGroup icons={[{ Icon: FileText, color: '#8b5cf6' }, { Icon: FolderPlus, color: '#10b981' }]} />
          <div>
            <div className="inbox-entry-badges">
              <Badge label="Projektänderung" color="#8b5cf6" />
              <Badge label={entry.project_name} color="#6b7280" />
            </div>
            <div className="inbox-entry-meta">
              {(entry.user_name || entry.device_name) && (
                <span>Anfrage von {entry.user_name || entry.device_name}</span>
              )}
              {entry.created_at && <span>· {formatDateTime(entry.created_at)}</span>}
            </div>
          </div>
        </div>
        <div className="inbox-entry-header-right">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {expanded && (
        <div className="inbox-entry-body">
          {entry.color && (
            <div className="inbox-change-detail">
              <span className="inbox-change-label">Farbe:</span>
              <span className="inbox-color-swatch" style={{ background: entry.color }} />
            </div>
          )}
          {entry.tags && entry.tags.length > 0 && (
            <div className="inbox-change-detail">
              <span className="inbox-change-label">Tags:</span>
              <span>{entry.tags.join(', ')}</span>
            </div>
          )}
          {entry.notes != null && (
            <div className="inbox-change-detail">
              <span className="inbox-change-label">Notizen:</span>
              <p className="inbox-entry-notes" style={{ margin: '4px 0 0' }}>{entry.notes || '(leer)'}</p>
            </div>
          )}
          {!entry.notes && !entry.color && (!entry.tags || entry.tags.length === 0) && (
            <p className="inbox-entry-notes" style={{ opacity: 0.5 }}>Keine Änderungen</p>
          )}
          {canManage && (
            <div className="inbox-entry-actions">
              <button className="inbox-action-btn inbox-action-confirm" onClick={handleApply} disabled={busy}>
                <Check size={14} />Anwenden
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

// ─── Image Change Row ─────────────────────────────────────────────────────────
function ImageChangeRow({ entry, canManage, onRemove, onActivity }) {
  const { user: currentUser } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleApply = async () => {
    setBusy(true);
    try {
      await fetch('/api/mobile/inbox/process-image-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: entry.id }),
      });
      onActivity({
        id: `local_${Date.now()}`,
        type: 'image_change',
        title: `Bildinfo geändert: „${entry.file_name}"`,
        description: `Von ${entry.user_name || entry.device_name}`,
        confirmed_by: currentUser?.name || null,
        created_at: new Date().toISOString(),
      });
      onRemove(entry.id);
    } catch { /* ignore */ }
    setBusy(false);
  };

  const handleReject = async () => {
    setBusy(true);
    await fetch('/api/mobile/inbox/reject-image-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: entry.id }),
    }).catch(() => {});
    onRemove(entry.id);
    setBusy(false);
  };

  return (
    <div className="inbox-entry-card">
      <div className="inbox-entry-header" onClick={() => setExpanded(e => !e)}>
        <div className="inbox-entry-header-left">
          <EntryIconGroup icons={[{ Icon: Pencil, color: '#f59e0b' }]} />
          <div>
            <div className="inbox-entry-badges">
              <Badge label="Bild-Änderung" color="#f59e0b" />
            </div>
            <div className="inbox-entry-meta">
              <span>{entry.file_name}</span>
              {(entry.user_name || entry.device_name) && (
                <span>· Anfrage von {entry.user_name || entry.device_name}</span>
              )}
              {entry.created_at && <span>· {formatDateTime(entry.created_at)}</span>}
            </div>
          </div>
        </div>
        <div className="inbox-entry-header-right">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {expanded && (
        <div className="inbox-entry-body">
          {entry.changes?.custom_title && (
            <div className="inbox-change-field">
              <span className="inbox-change-label">Neuer Titel:</span>
              <span className="inbox-change-value">{entry.changes.custom_title}</span>
            </div>
          )}
          {entry.changes?.notes != null && (
            <div className="inbox-change-field">
              <span className="inbox-change-label">Notizen:</span>
              <span className="inbox-change-value">{entry.changes.notes || <em>leer</em>}</span>
            </div>
          )}
          {canManage && (
            <div className="inbox-entry-actions">
              <button className="inbox-action-btn inbox-action-confirm" onClick={handleApply} disabled={busy}>
                <Check size={14} />Anwenden
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

// ─── Delete Request Row ───────────────────────────────────────────────────────
function DeleteRequestRow({ req, canManage, onRemove, onActivity }) {
  const { user: currentUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [imgError, setImgError] = useState(false);

  const previewSrc = `/api/mobile/inbox/delete-preview/${encodeURIComponent(req.file_name)}${req.project_name ? `?project=${encodeURIComponent(req.project_name)}` : ''}`;

  const handleProcess = async () => {
    if (!confirm(`Datei „${req.file_name}" wirklich löschen?`)) return;
    setBusy(true);
    onRemove(req.id);
    onActivity({
      id: `local_${Date.now()}`,
      type: 'delete_request',
      title: 'Löschanfrage ausgeführt',
      description: `„${req.file_name}"${req.project_name ? ` aus „${req.project_name}"` : ''} gelöscht`,
      confirmed_by: currentUser?.name || null,
      created_at: new Date().toISOString(),
    });
    fetch('/api/mobile/inbox/process-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestIds: [req.id] })
    }).catch(() => {});
  };

  const handleDismiss = async () => {
    setBusy(true);
    onRemove(req.id);
    fetch('/api/mobile/inbox/dismiss-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestIds: [req.id] })
    }).catch(() => {});
  };

  return (
    <div className="inbox-entry-card">
      <div className="inbox-entry-header" onClick={() => setExpanded(e => !e)} style={{ cursor: 'pointer' }}>
        <div className="inbox-entry-header-left">
          <EntryIconGroup icons={[{ Icon: Trash2, color: '#ef4444' }]} />
          <div>
            <div className="inbox-entry-badges">
              <Badge label="Löschanfrage" color="#ef4444" />
            </div>
            <div className="inbox-entry-meta">
              <span>{req.file_name}</span>
              {req.project_name && <span>· {req.project_name}</span>}
              {req.requested_by && <span>· von {req.requested_by}</span>}
              {req.requested_at && <span>· {formatDateTime(req.requested_at)}</span>}
            </div>
          </div>
        </div>
        <div className="inbox-entry-header-right" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {canManage && (<>
            <button className="inbox-action-btn inbox-action-delete" onClick={e => { e.stopPropagation(); handleProcess(); }} disabled={busy} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
              <Trash2 size={13} />Löschen
            </button>
            <button className="inbox-action-btn inbox-action-cancel" onClick={e => { e.stopPropagation(); handleDismiss(); }} disabled={busy} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
              <X size={13} />Abweisen
            </button>
          </>)}
          {expanded ? <ChevronUp size={16} className="inbox-chevron" /> : <ChevronDown size={16} className="inbox-chevron" />}
        </div>
      </div>

      {expanded && (
        <div className="inbox-entry-body">
          {imgError ? (
            <p className="inbox-entry-no-images">Bild nicht lokal verfügbar</p>
          ) : (
            <div className="inbox-image-grid">
              <div className="inbox-image-thumb">
                <img src={previewSrc} alt={req.file_name} loading="lazy" onError={() => setImgError(true)} />
                <span className="inbox-image-name">{req.file_name}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PostfachPage() {
  const { user } = useAuth();
  const canApproveUsers = user?.permissions?.approve_users;
  const canManageInbox = user?.permissions?.manage_inbox;

  const [imageRequests, setImageRequests] = useState([]);
  const [projektRequests, setProjektRequests] = useState([]);
  const [imageChangeRequests, setImageChangeRequests] = useState([]);
  const [projektChangeRequests, setProjektChangeRequests] = useState([]);
  const [deleteRequests, setDeleteRequests] = useState([]);
  const [projects, setProjects] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const loadRequests = useCallback(async () => {
    setSyncing(true);
    try {
      const [reqRes, projRes] = await Promise.all([
        fetch('/api/mobile/inbox/requests'),
        fetch('/api/projects'),
      ]);
      if (reqRes.ok) {
        const d = await reqRes.json();
        setImageRequests(d.image_requests || []);
        setProjektRequests(d.projekt_requests || []);
        setImageChangeRequests(d.image_change_requests || []);
        setProjektChangeRequests(d.projekt_change_requests || []);
        setDeleteRequests(d.delete_requests || []);
      }
      if (projRes.ok) {
        const d = await projRes.json();
        setProjects(d.projects || d || []);
      }
    } catch { /* ignore */ }
    setSyncing(false);
    window.dispatchEvent(new Event('inbox-sync-done'));
  }, []);

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

  useEffect(() => {
    loadRequests();
    loadActivities();
    fetch('/api/mobile/activities/read', { method: 'POST' }).catch(() => {});
  }, [loadRequests, loadActivities]);

  const removeRequest = useCallback((setState) => (id) => {
    setState(prev => prev.filter(e => e.id !== id));
  }, []);

  const addActivity = useCallback((entry) => {
    setActivities(prev => [entry, ...prev]);
  }, []);

  const totalPending = imageRequests.length + projektRequests.length + imageChangeRequests.length + projektChangeRequests.length + deleteRequests.length;

  // Keep InboxBanner in sync immediately when items are added/removed
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('inbox-count-update', { detail: { count: totalPending } }));
  }, [totalPending]);

  const grouped = groupByDate(activities);

  return (
    <div className="inbox-page">
      <div className="inbox-page-header">
        <Inbox size={22} />
        <h1>Postfach</h1>
        <span className="inbox-page-subtitle">Anfragen der Handy-App</span>
        <button
          className={`inbox-refresh-btn${syncing ? ' inbox-refresh-btn--syncing' : ''}`}
          onClick={() => { loadRequests(); loadActivities(); }}
          title="Aktualisieren"
        >
          <RefreshCw size={15} />
        </button>
        {syncing && <span className="inbox-syncing-hint">Synchronisiere…</span>}
      </div>

      {canApproveUsers && <PendingUsersSection />}

      {/* Pending requests */}
      {(syncing || totalPending > 0) && (
        <div className="inbox-section">
          <div className="inbox-section-title">
            <Upload size={16} />
            Ausstehende Anfragen
            {!syncing && totalPending > 0 && (
              <span className="inbox-section-count">{totalPending}</span>
            )}
          </div>

          {syncing && imageRequests.length === 0 && projektRequests.length === 0 && (
            <div className="inbox-entry-loading">Lade Daten von Google Drive…</div>
          )}

          {[
            ...imageRequests.map(e => ({ ...e, _type: 'image',          _sortDate: e.created_at || '' })),
            ...projektRequests.map(e => ({ ...e, _type: 'projekt',        _sortDate: e.created_at || '' })),
            ...projektChangeRequests.map(e => ({ ...e, _type: 'projekt_change', _sortDate: e.created_at || '' })),
            ...imageChangeRequests.map(e => ({ ...e, _type: 'image_change',  _sortDate: e.created_at || '' })),
            ...deleteRequests.map(e => ({ ...e, _type: 'delete',         _sortDate: e.requested_at || e.created_at || '' })),
          ]
            .sort((a, b) => b._sortDate.localeCompare(a._sortDate))
            .map(item => {
              if (item._type === 'image') return (
                <ImageRequestRow key={item.id} entry={item} projects={projects} canManage={canManageInbox}
                  onRemove={removeRequest(setImageRequests)} onActivity={addActivity} />
              );
              if (item._type === 'projekt') return (
                <ProjektRequestRow key={item.id} entry={item} canManage={canManageInbox}
                  onRemove={removeRequest(setProjektRequests)} onActivity={addActivity} />
              );
              if (item._type === 'projekt_change') return (
                <ProjektChangeRow key={item.id} entry={item} canManage={canManageInbox}
                  onRemove={removeRequest(setProjektChangeRequests)} onActivity={addActivity} />
              );
              if (item._type === 'image_change') return (
                <ImageChangeRow key={item.id} entry={item} canManage={canManageInbox}
                  onRemove={removeRequest(setImageChangeRequests)} onActivity={addActivity} />
              );
              if (item._type === 'delete') return (
                <DeleteRequestRow key={item.id} req={item} canManage={canManageInbox}
                  onRemove={removeRequest(setDeleteRequests)} onActivity={addActivity} />
              );
              return null;
            })
          }
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
                  const cfg = TYPE_CONFIG[a.type] || { icons: [{ Icon: Inbox, color: '#6b7280' }], label: a.type };
                  return (
                    <div key={a.id} className="inbox-activity-item">
                      <EntryIconGroup icons={cfg.icons} />
                      <div className="inbox-activity-body">
                        <div className="inbox-activity-title">{a.title}</div>
                        {a.description && <div className="inbox-activity-desc">{a.description}</div>}
                        {a.confirmed_by && <div className="inbox-activity-meta">Bestätigt von {a.confirmed_by}</div>}
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
