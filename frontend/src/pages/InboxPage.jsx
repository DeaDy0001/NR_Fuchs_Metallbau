import { useState, useEffect, useCallback } from 'react';
import { Inbox, Upload, FolderPlus, Trash2, GitMerge, Camera } from 'lucide-react';
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

export default function InboxPage() {
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

  return (
    <div className="inbox-page">
      <div className="inbox-page-header">
        <Inbox size={22} />
        <h1>Inbox</h1>
        <span className="inbox-page-subtitle">Aktivitäten der Handy-App</span>
      </div>

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
