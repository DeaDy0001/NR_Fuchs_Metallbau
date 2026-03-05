import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Inbox, Upload, FolderPlus, Trash2, GitMerge, Camera,
  UserCheck, ChevronDown, ChevronUp, Check, X, Eye,
  FolderOpen, RefreshCw, Image, ChevronLeft, ChevronRight
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import './InboxPage.css';

const TYPE_CONFIG = {
  image_upload:   { icons: [{ Icon: Upload,     color: '#3b82f6' }],                                          label: 'Foto hochgeladen'  },
  project_create: { icons: [{ Icon: FolderPlus, color: '#10b981' }],                                          label: 'Projekt erstellt'  },
  inbox_item:     { icons: [{ Icon: Camera,     color: '#f59e0b' }, { Icon: FolderPlus, color: '#10b981' }],  label: 'Neue Uploads'      },
  delete_request: { icons: [{ Icon: Trash2,     color: '#ef4444' }],                                          label: 'Löschanfrage'      },
  project_change: { icons: [{ Icon: Camera,     color: '#f59e0b' }, { Icon: GitMerge,   color: '#8b5cf6' }],  label: 'Projektänderung'   },
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

/**
 * Icon group for inbox entries.
 * Single icon → centered. Two icons → stacked/overlapping micro badges.
 */
function EntryIconGroup({ icons }) {
  // icons = [{ Icon, color }] or [{ Icon, color }, { Icon, color }]
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

/** Parse [FUCHS_META]{...} from Google Drive file description */
function parseFuchsMeta(description) {
  if (!description || !description.startsWith('[FUCHS_META]')) return null;
  try { return JSON.parse(description.substring('[FUCHS_META]'.length)); } catch { return null; }
}

// ─── Image Lightbox ───────────────────────────────────────────────────────────
function InboxLightbox({ images, startIndex, onClose }) {
  const [index, setIndex] = useState(startIndex);
  const img = images[index];
  const meta = parseFuchsMeta(img.description);

  const gpsLat = meta?.gps?.latitude ?? null;
  const gpsLon = meta?.gps?.longitude ?? null;
  const uploadedBy = meta?.uploaded_by || null;
  const notes = meta?.notes || null;
  const customTitle = meta?.title || null;

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) setIndex(i => i - 1);
      if (e.key === 'ArrowRight' && index < images.length - 1) setIndex(i => i + 1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [index, images.length, onClose]);

  return (
    <div className="inbox-lightbox-overlay" onClick={onClose}>
      <button className="inbox-lightbox-close" onClick={onClose} title="Schließen (Esc)">
        <X size={20} />
      </button>

      {index > 0 && (
        <button
          className="inbox-lightbox-nav inbox-lightbox-prev"
          onClick={e => { e.stopPropagation(); setIndex(i => i - 1); }}
          title="Vorheriges Bild (←)"
        >
          <ChevronLeft size={24} />
        </button>
      )}
      {index < images.length - 1 && (
        <button
          className="inbox-lightbox-nav inbox-lightbox-next"
          onClick={e => { e.stopPropagation(); setIndex(i => i + 1); }}
          title="Nächstes Bild (→)"
        >
          <ChevronRight size={24} />
        </button>
      )}

      <div className="inbox-lightbox-content" onClick={e => e.stopPropagation()}>
        <div className="inbox-lightbox-image-area">
          <img
            src={`/api/mobile/inbox/image-proxy/${img.id}`}
            alt={img.name}
            className="inbox-lightbox-img"
          />
        </div>
        <div className="inbox-lightbox-sidebar">
          <div className="inbox-lightbox-counter">{index + 1} / {images.length}</div>

          <div className="inbox-lightbox-section">
            <div className="inbox-lightbox-label">Dateiname</div>
            <div className="inbox-lightbox-value">{customTitle || img.name}</div>
          </div>

          {customTitle && customTitle !== img.name && (
            <div className="inbox-lightbox-section">
              <div className="inbox-lightbox-label">Originalname</div>
              <div className="inbox-lightbox-value inbox-lightbox-value-muted">{img.name}</div>
            </div>
          )}

          {uploadedBy && (
            <div className="inbox-lightbox-section">
              <div className="inbox-lightbox-label">Hochgeladen von</div>
              <div className="inbox-lightbox-value">{uploadedBy}</div>
            </div>
          )}

          <div className="inbox-lightbox-meta-grid">
            {img.size > 0 && (
              <div className="inbox-lightbox-meta-item">
                <span className="inbox-lightbox-meta-label">Größe</span>
                <span className="inbox-lightbox-meta-value">{(img.size / 1024 / 1024).toFixed(2)} MB</span>
              </div>
            )}
            {img.width && img.height && (
              <div className="inbox-lightbox-meta-item">
                <span className="inbox-lightbox-meta-label">Auflösung</span>
                <span className="inbox-lightbox-meta-value">{img.width} × {img.height}</span>
              </div>
            )}
            {img.mimeType && (
              <div className="inbox-lightbox-meta-item">
                <span className="inbox-lightbox-meta-label">Format</span>
                <span className="inbox-lightbox-meta-value">{img.mimeType.split('/')[1]?.toUpperCase() || img.mimeType}</span>
              </div>
            )}
            {img.createdTime && (
              <div className="inbox-lightbox-meta-item">
                <span className="inbox-lightbox-meta-label">Aufgenommen</span>
                <span className="inbox-lightbox-meta-value">{formatDateTime(img.createdTime)}</span>
              </div>
            )}
          </div>

          <div className="inbox-lightbox-section">
            <div className="inbox-lightbox-label">GPS-Standort</div>
            {gpsLat != null && gpsLon != null ? (
              <button
                className="inbox-lightbox-gps-btn"
                onClick={() => window.open(`https://www.google.com/maps?q=${gpsLat},${gpsLon}`, '_blank')}
              >
                <span>📍</span>
                <span>Auf Google Maps öffnen</span>
                <span className="inbox-lightbox-gps-coords">{gpsLat.toFixed(5)}, {gpsLon.toFixed(5)}</span>
              </button>
            ) : (
              <div className="inbox-lightbox-value-muted">Keine GPS-Daten</div>
            )}
          </div>

          <div className="inbox-lightbox-section">
            <div className="inbox-lightbox-label">Notizen</div>
            {notes
              ? <div className="inbox-lightbox-notes">{notes}</div>
              : <div className="inbox-lightbox-value-muted">Keine Notizen</div>
            }
          </div>
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
    // Optimistic: remove immediately
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
function InboxItemRow({ item, projects, canManage, onRemove, onActivity }) {
  const [expanded, setExpanded] = useState(false);
  const [images, setImages] = useState(null);
  const [loadingImages, setLoadingImages] = useState(false);
  const [mergeProjectId, setMergeProjectId] = useState('');
  const [newProjectName, setNewProjectName] = useState(item.project_name || item.original_name || '');
  const [showConfirmForm, setShowConfirmForm] = useState(false);
  const [showMergeForm, setShowMergeForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState(null);

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

  const now = () => new Date().toISOString();

  const handleConfirm = async () => {
    if (!newProjectName.trim()) return;
    const name = newProjectName.trim();
    onRemove(item.drive_folder_id);
    onActivity({ id: `local_${Date.now()}`, type: 'project_create', title: `Projekt angelegt`, description: `„${name}" aus Inbox bestätigt`, device_name: item.device_user || null, created_at: now() });
    fetch('/api/mobile/inbox/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId: item.drive_folder_id, inboxFolderId: item.inbox_folder_id, projectName: name })
    }).catch(() => {});
  };

  const handleMerge = async () => {
    if (!mergeProjectId) return;
    const targetProject = projects.find(p => p.id === parseInt(mergeProjectId));
    onRemove(item.drive_folder_id);
    onActivity({ id: `local_${Date.now()}`, type: 'project_change', title: `Inbox zusammengeführt`, description: `„${item.project_name}" → „${targetProject?.folder_name || mergeProjectId}"`, device_name: item.device_user || null, created_at: now() });
    fetch('/api/mobile/inbox/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceFolderId: item.drive_folder_id, targetProjectId: parseInt(mergeProjectId), inboxFolderId: item.inbox_folder_id, projectName: item.project_name })
    }).catch(() => {});
  };

  const handleDelete = async () => {
    if (!confirm(`Inbox-Eintrag „${item.project_name}" wirklich löschen?`)) return;
    onRemove(item.drive_folder_id);
    onActivity({ id: `local_${Date.now()}`, type: 'delete_request', title: `Inbox-Eintrag gelöscht`, description: `„${item.project_name}" wurde entfernt`, device_name: item.device_user || null, created_at: now() });
    fetch(`/api/mobile/inbox/${item.drive_folder_id}`, { method: 'DELETE' }).catch(() => {});
  };

  const imgFilter = images ? images.filter(f => f.mimeType && f.mimeType.startsWith('image/')) : [];

  return (
    <div className="inbox-entry-card">
      <div className="inbox-entry-header" onClick={handleExpand}>
        <div className="inbox-entry-header-left">
          <EntryIconGroup icons={
            item.is_user_inbox
              ? [{ Icon: Camera, color: '#f59e0b' }]
              : [{ Icon: Camera, color: '#f59e0b' }, { Icon: FolderPlus, color: '#10b981' }]
          } />
          <div>
            <div className="inbox-entry-title">{item.project_name}</div>
            <div className="inbox-entry-meta">
              {item.image_count > 0 && <span>{item.image_count} Bild{item.image_count !== 1 ? 'er' : ''}</span>}
              {item.device_user && <span>· von {item.device_user}</span>}
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
              {imgFilter.map((img, idx) => (
                <div
                  key={img.id}
                  className="inbox-image-thumb inbox-image-thumb-clickable"
                  onClick={() => setLightboxIndex(idx)}
                  title="Bild anzeigen"
                >
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
                      <button className="inbox-action-btn inbox-action-confirm" onClick={handleConfirm} disabled={!newProjectName.trim()}>
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
                      <button className="inbox-action-btn inbox-action-merge" onClick={handleMerge} disabled={!mergeProjectId}>
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
                <button className="inbox-action-btn inbox-action-delete" onClick={handleDelete}>
                  <Trash2 size={14} />
                  Löschen
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <InboxLightbox
          images={imgFilter}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}

// ─── Project Changes ──────────────────────────────────────────────────────────
function ProjectChangeRow({ change, canManage, onRemove, onActivity }) {
  const [expanded, setExpanded] = useState(false);

  const changeKey = change.drive_folder_id || change.project_name;
  const now = () => new Date().toISOString();
  const uploaderStr = change.uploaders?.length > 0 ? change.uploaders.join(', ') : null;

  const handleConfirm = async () => {
    onRemove(changeKey);
    onActivity({ id: `local_${Date.now()}`, type: 'project_change', title: `Bilder hinzugefügt`, description: `${change.new_images.length} Bild${change.new_images.length !== 1 ? 'er' : ''} zu „${change.project_name}"${uploaderStr ? ` von ${uploaderStr}` : ''}`, device_name: uploaderStr || null, created_at: now() });
    const fileIds = change.new_images.map(i => i.id);
    fetch('/api/mobile/project-changes/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectName: change.project_name, fileIds })
    }).catch(() => {});
  };

  const handleReject = async () => {
    if (!confirm(`Neue Bilder in „${change.project_name}" wirklich ablehnen und löschen?`)) return;
    onRemove(changeKey);
    onActivity({ id: `local_${Date.now()}`, type: 'delete_request', title: `Bilder abgelehnt`, description: `${change.new_images.length} Bild${change.new_images.length !== 1 ? 'er' : ''} in „${change.project_name}" abgelehnt`, device_name: uploaderStr || null, created_at: now() });
    const fileIds = change.new_images.map(i => i.id);
    fetch('/api/mobile/project-changes/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectName: change.project_name, fileIds })
    }).catch(() => {});
  };

  return (
    <div className="inbox-entry-card">
      <div className="inbox-entry-header" onClick={() => setExpanded(e => !e)}>
        <div className="inbox-entry-header-left">
          <EntryIconGroup icons={[
            { Icon: Camera, color: '#f59e0b' },
            { Icon: GitMerge, color: '#8b5cf6' }
          ]} />
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

          {canManage && (
            <div className="inbox-entry-actions">
              <button className="inbox-action-btn inbox-action-confirm" onClick={handleConfirm}>
                <Check size={14} />Hinzufügen
              </button>
              <button className="inbox-action-btn inbox-action-delete" onClick={handleReject}>
                <X size={14} />Ablehnen
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Delete Requests ──────────────────────────────────────────────────────────
function DeleteRequestRow({ req, canManage, onRemove, onActivity }) {
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [imgError, setImgError] = useState(false);

  const now = () => new Date().toISOString();

  const previewSrc = req.project_name
    ? `/api/mobile/inbox/delete-preview/${encodeURIComponent(req.project_name)}/${encodeURIComponent(req.file_name)}`
    : null;

  const handleProcess = async () => {
    if (!confirm(`Datei „${req.file_name}" wirklich löschen?`)) return;
    setBusy(true);
    onRemove(req.id);
    onActivity({ id: `local_${Date.now()}`, type: 'delete_request', title: 'Löschanfrage ausgeführt', description: `„${req.file_name}"${req.project_name ? ` aus „${req.project_name}"` : ''} gelöscht`, device_name: req.requested_by || null, created_at: now() });
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
            <div className="inbox-entry-title">{req.file_name}</div>
            <div className="inbox-entry-meta">
              <span>Löschanfrage</span>
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
          {!previewSrc || imgError ? (
            <p className="inbox-entry-no-images">
              {imgError ? 'Bild nicht lokal verfügbar' : 'Kein Projekt angegeben – Vorschau nicht möglich'}
            </p>
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

// ─── Module-level dismissed set: survives tab switches without sessionStorage complexity ─
const dismissedInboxIds = new Set();
const dismissedChangeKeys = new Set();

// ─── Cache helpers ─────────────────────────────────────────────────────────────
const INBOX_CACHE_KEY = 'fuchs_inbox_cache';

function readCache() {
  try {
    const raw = sessionStorage.getItem(INBOX_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeCache(data) {
  try { sessionStorage.setItem(INBOX_CACHE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function InboxPage() {
  const { user } = useAuth();
  const canApproveUsers = user?.permissions?.approve_users;
  const canManageInbox = user?.permissions?.manage_inbox;

  // Seed state from cache so items appear instantly on tab return
  const cached = readCache();
  const [inboxItems, setInboxItems] = useState(
    cached ? (cached.inboxItems || []).filter(i => !dismissedInboxIds.has(i.drive_folder_id)) : []
  );
  const [projectChanges, setProjectChanges] = useState(
    cached ? (cached.projectChanges || []).filter(c => !dismissedChangeKeys.has(c.drive_folder_id || c.project_name)) : []
  );
  const [projects, setProjects] = useState(cached?.projects || []);
  const [activities, setActivities] = useState(cached?.activities || []);
  const [deleteRequests, setDeleteRequests] = useState(cached?.deleteRequests || []);
  const [loading, setLoading] = useState(!cached);
  const [loadingInbox, setLoadingInbox] = useState(!cached);
  const [syncingInbox, setSyncingInbox] = useState(false);

  const loadActivities = useCallback(async () => {
    try {
      const res = await fetch('/api/mobile/activities');
      if (res.ok) {
        const data = await res.json();
        const fresh = data.activities || [];
        setActivities(fresh);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const loadInbox = useCallback(async () => {
    if (!readCache()) setLoadingInbox(true);
    setSyncingInbox(true);
    try {
      const [inboxRes, changesRes, projRes] = await Promise.all([
        fetch('/api/mobile/inbox'),
        fetch('/api/mobile/project-changes'),
        fetch('/api/projects'),
      ]);
      if (inboxRes.ok) {
        const d = await inboxRes.json();
        const fresh = (d.projects || d || []).filter(i => !dismissedInboxIds.has(i.drive_folder_id));
        setInboxItems(fresh);
        const reqs = (d.deleteRequests || []);
        setDeleteRequests(reqs);
      }
      if (changesRes.ok) {
        const d = await changesRes.json();
        const fresh = (d.changes || []).filter(c => !dismissedChangeKeys.has(c.drive_folder_id || c.project_name));
        setProjectChanges(fresh);
      }
      if (projRes.ok) {
        const d = await projRes.json();
        setProjects(d.projects || d || []);
      }
    } catch { /* ignore */ }
    setLoadingInbox(false);
    setSyncingInbox(false);
  }, []);

  // Persist state to cache after updates
  useEffect(() => {
    writeCache({ inboxItems, projectChanges, projects, activities, deleteRequests });
  }, [inboxItems, projectChanges, projects, activities, deleteRequests]);

  useEffect(() => {
    loadActivities();
    loadInbox();
    fetch('/api/mobile/activities/read', { method: 'POST' }).catch(() => {});
  }, [loadActivities, loadInbox]);

  // Optimistic remove handlers — also record in dismissed set so re-fetch won't restore them
  const removeInboxItem = useCallback((folderId) => {
    dismissedInboxIds.add(folderId);
    setInboxItems(prev => prev.filter(i => i.drive_folder_id !== folderId));
  }, []);

  const removeProjectChange = useCallback((key) => {
    dismissedChangeKeys.add(key);
    setProjectChanges(prev => prev.filter(c => (c.drive_folder_id || c.project_name) !== key));
  }, []);

  const removeDeleteRequest = useCallback((id) => {
    setDeleteRequests(prev => prev.filter(r => r.id !== id));
  }, []);

  // Optimistic activity add — deduplicate by title+description to avoid doubles
  const addActivity = useCallback((entry) => {
    setActivities(prev => {
      const isDup = prev.some(a =>
        a.title === entry.title &&
        a.description === entry.description &&
        !a.id?.startsWith('local_')
      );
      if (isDup) return prev;
      return [entry, ...prev];
    });
  }, []);

  const grouped = groupByDate(activities);
  const hasPendingItems = inboxItems.length > 0 || projectChanges.length > 0 || deleteRequests.length > 0;

  return (
    <div className="inbox-page">
      <div className="inbox-page-header">
        <Inbox size={22} />
        <h1>Inbox</h1>
        <span className="inbox-page-subtitle">Aktivitäten der Handy-App</span>
        <button
          className={`inbox-refresh-btn${syncingInbox ? ' inbox-refresh-btn--syncing' : ''}`}
          onClick={() => { loadInbox(); loadActivities(); }}
          title="Aktualisieren"
        >
          <RefreshCw size={15} />
        </button>
        {syncingInbox && <span className="inbox-syncing-hint">Synchronisiere…</span>}
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
              <span className="inbox-section-count">{inboxItems.length + projectChanges.length + deleteRequests.length}</span>
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
              onRemove={removeInboxItem}
              onActivity={addActivity}
            />
          ))}

          {!loadingInbox && projectChanges.map(change => (
            <ProjectChangeRow
              key={change.drive_folder_id || change.project_name}
              change={change}
              canManage={canManageInbox}
              onRemove={removeProjectChange}
              onActivity={addActivity}
            />
          ))}

          {!loadingInbox && deleteRequests.map(req => (
            <DeleteRequestRow
              key={req.id}
              req={req}
              canManage={canManageInbox}
              onRemove={removeDeleteRequest}
              onActivity={addActivity}
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
                  const cfg = TYPE_CONFIG[a.type] || { icons: [{ Icon: Inbox, color: '#6b7280' }], label: a.type };
                  return (
                    <div key={a.id} className="inbox-activity-item">
                      <EntryIconGroup icons={cfg.icons} />
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
