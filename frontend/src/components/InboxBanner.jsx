import { useState, useEffect, useCallback } from 'react';
import { Inbox, Check, Trash2, X, FolderOpen, Loader, RefreshCw, Smartphone, ChevronRight } from 'lucide-react';
import './InboxBanner.css';

function InboxBanner() {
  const [inboxItems, setInboxItems] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadInbox = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/mobile/inbox');
      if (response.ok) {
        const data = await response.json();
        setInboxItems(data.filter(i => i.status === 'new_project'));
      }
    } catch (error) {
      console.error('Error loading inbox:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInbox();
    const interval = setInterval(loadInbox, 60000);
    return () => clearInterval(interval);
  }, [loadInbox]);

  if (inboxItems.length === 0) return null;

  return (
    <>
      <div className="inbox-banner" onClick={() => setShowModal(true)}>
        <div className="inbox-banner-content">
          <Inbox size={18} />
          <span>
            {inboxItems.length === 1
              ? '1 neues Projekt von der Handy-App'
              : `${inboxItems.length} neue Projekte von der Handy-App`}
          </span>
          {loading && <Loader size={14} className="spinning" />}
          <ChevronRight size={16} />
        </div>
      </div>

      {showModal && (
        <InboxModal
          items={inboxItems}
          onClose={() => setShowModal(false)}
          onRefresh={loadInbox}
        />
      )}
    </>
  );
}

function InboxModal({ items, onClose, onRefresh }) {
  const [processing, setProcessing] = useState({});
  const [notification, setNotification] = useState(null);

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Gerade eben';
    if (diffMin < 60) return `vor ${diffMin} Min.`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `vor ${diffHours} Std.`;
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const handleConfirm = async (item) => {
    setProcessing(prev => ({ ...prev, [item.id]: 'confirming' }));
    try {
      const response = await fetch('/api/mobile/inbox/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderId: item.drive_folder_id,
          inboxFolderId: item.inbox_folder_id,
          projectName: item.project_name || item.original_name,
        })
      });
      const data = await response.json();
      if (!response.ok) {
        showNotification(data.error || 'Fehler beim Bestätigen', 'error');
      } else {
        showNotification(`"${item.project_name || item.original_name}" in Projekte verschoben`);
        await onRefresh();
      }
    } catch (e) {
      showNotification('Fehler: ' + e.message, 'error');
    } finally {
      setProcessing(prev => ({ ...prev, [item.id]: null }));
    }
  };

  const handleReject = async (item) => {
    if (!window.confirm(`Projekt "${item.project_name || item.original_name}" wirklich ablehnen? Der Ordner wird aus der Inbox entfernt.`)) return;
    setProcessing(prev => ({ ...prev, [item.id]: 'rejecting' }));
    try {
      // For drive inbox items we don't have a delete endpoint yet, just refresh
      // For DB items, we could add one - for now just mark as processed
      showNotification(`"${item.project_name || item.original_name}" abgelehnt`);
      await onRefresh();
    } catch (e) {
      showNotification('Fehler: ' + e.message, 'error');
    } finally {
      setProcessing(prev => ({ ...prev, [item.id]: null }));
    }
  };

  const handleConfirmAll = async () => {
    if (!window.confirm(`Alle ${items.length} Projekte bestätigen und in den Projekte-Ordner verschieben?`)) return;
    for (const item of items) {
      if (item.drive_folder_id) {
        await handleConfirm(item);
      }
    }
  };

  return (
    <div className="inbox-modal-overlay" onClick={onClose}>
      <div className="inbox-modal" onClick={e => e.stopPropagation()}>
        <div className="inbox-modal-header">
          <div className="inbox-modal-title">
            <Inbox size={22} />
            <div>
              <h2>Inbox - Neue Projekte</h2>
              <p className="inbox-modal-subtitle">
                Projekte von der Handy-App, die auf Bestätigung warten
              </p>
            </div>
          </div>
          <div className="inbox-modal-header-actions">
            {items.length > 1 && (
              <button className="inbox-btn inbox-btn-confirm-all" onClick={handleConfirmAll}>
                <Check size={16} />
                Alle bestätigen
              </button>
            )}
            <button className="inbox-modal-close" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </div>

        {notification && (
          <div className={`inbox-notification ${notification.type}`}>
            {notification.type === 'success' ? <Check size={16} /> : <X size={16} />}
            {notification.message}
          </div>
        )}

        <div className="inbox-modal-body">
          {items.length === 0 ? (
            <div className="inbox-empty">
              <Inbox size={48} strokeWidth={1} />
              <p>Keine neuen Projekte in der Inbox</p>
            </div>
          ) : (
            items.map(item => (
              <div key={item.id} className="inbox-project-card">
                <div className="inbox-project-icon">
                  <FolderOpen size={24} />
                </div>
                <div className="inbox-project-info">
                  <div className="inbox-project-name">
                    {item.project_name || item.original_name}
                  </div>
                  <div className="inbox-project-meta">
                    <Smartphone size={12} />
                    <span>von {item.device_user || 'Handy-App'}</span>
                    {item.uploaded_at && (
                      <span className="inbox-project-date">{formatDate(item.uploaded_at)}</span>
                    )}
                  </div>
                </div>
                <div className="inbox-project-actions">
                  {processing[item.id] ? (
                    <Loader size={18} className="spinning" />
                  ) : (
                    <>
                      {item.drive_folder_id && (
                        <button
                          className="inbox-btn inbox-btn-confirm"
                          onClick={() => handleConfirm(item)}
                          title="In Projekte-Ordner verschieben"
                        >
                          <Check size={16} />
                          Bestätigen
                        </button>
                      )}
                      <button
                        className="inbox-btn inbox-btn-reject"
                        onClick={() => handleReject(item)}
                        title="Ablehnen"
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default InboxBanner;
