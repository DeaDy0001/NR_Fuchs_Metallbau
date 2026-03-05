import { useState, useEffect, useCallback } from 'react';
import { Inbox, Upload, FolderPlus, Trash2, GitMerge, Camera, UserCheck, ChevronDown } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import './InboxPage.css';

const TYPE_CONFIG = {
  image_upload:   { icon: Upload,      label: 'Foto hochgeladen',    color: '#3b82f6' },
  project_create: { icon: FolderPlus,  label: 'Projekt erstellt',    color: '#10b981' },
  inbox_item:     { icon: Camera,      label: 'Neue Uploads',        color: '#f59e0b' },
  delete_request: { icon: Trash2,      label: 'Löschanfrage',        color: '#ef4444' },
  project_change: { icon: GitMerge,    label: 'Projektänderung',     color: '#8b5cf6' },
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

function PendingUsersSection({ onApproved }) {
  const [pendingUsers, setPendingUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [selectedRoles, setSelectedRoles] = useState({});
  const [approving, setApproving] = useState({});

  const load = useCallback(async () => {
    try {
      const [uRes, rRes] = await Promise.all([
        fetch('/api/users/pending'),
        fetch('/api/roles')
      ]);
      if (uRes.ok) setPendingUsers((await uRes.json()).users);
      if (rRes.ok) setRoles((await rRes.json()).roles);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (pendingUsers.length === 0) return null;

  const handleApprove = async (userId) => {
    const roleId = selectedRoles[userId];
    if (!roleId) return;
    setApproving(prev => ({ ...prev, [userId]: true }));
    try {
      const res = await fetch(`/api/users/${userId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_id: parseInt(roleId) })
      });
      if (res.ok) {
        setPendingUsers(prev => prev.filter(u => u.id !== userId));
        if (onApproved) onApproved();
      }
    } catch { /* ignore */ }
    setApproving(prev => ({ ...prev, [userId]: false }));
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
              <select
                className="inbox-pending-select"
                value={selectedRoles[user.id] || ''}
                onChange={e => setSelectedRoles(prev => ({ ...prev, [user.id]: e.target.value }))}
              >
                <option value="">Rolle wählen...</option>
                {roles.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              <button
                className="inbox-pending-approve-btn"
                disabled={!selectedRoles[user.id] || approving[user.id]}
                onClick={() => handleApprove(user.id)}
              >
                <UserCheck size={14} />
                Freischalten
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function InboxPage() {
  const { user } = useAuth();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/mobile/activities');
      if (res.ok) {
        const data = await res.json();
        setActivities(data.activities || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Mark all as read when page is opened
    fetch('/api/mobile/activities/read', { method: 'POST' }).catch(() => {});
  }, [load]);

  const grouped = groupByDate(activities);
  const canApproveUsers = user?.permissions?.approve_users;

  return (
    <div className="inbox-page">
      <div className="inbox-page-header">
        <Inbox size={22} />
        <h1>Inbox</h1>
        <span className="inbox-page-subtitle">Aktivitäten der Handy-App</span>
      </div>

      {canApproveUsers && <PendingUsersSection />}

      {loading && (
        <div className="inbox-page-empty">
          <span>Lade Aktivitäten…</span>
        </div>
      )}

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
              {items.map((a) => {
                const cfg = TYPE_CONFIG[a.type] || { icon: Inbox, label: a.type, color: '#6b7280' };
                const Icon = cfg.icon;
                return (
                  <div key={a.id} className="inbox-activity-item">
                    <div
                      className="inbox-activity-icon"
                      style={{ background: cfg.color + '22', color: cfg.color }}
                    >
                      <Icon size={16} />
                    </div>
                    <div className="inbox-activity-body">
                      <div className="inbox-activity-title">{a.title}</div>
                      {a.description && (
                        <div className="inbox-activity-desc">{a.description}</div>
                      )}
                      {a.device_name && (
                        <div className="inbox-activity-meta">von {a.device_name}</div>
                      )}
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
  );
}
