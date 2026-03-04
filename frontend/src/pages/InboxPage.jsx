import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Inbox, Loader } from 'lucide-react';
import { InboxContent } from '../components/InboxBanner';
import './InboxPage.css';

function InboxPage() {
  const [inboxItems, setInboxItems] = useState([]);
  const [deleteRequests, setDeleteRequests] = useState([]);
  const [projectChanges, setProjectChanges] = useState([]);
  const [scanning, setScanning] = useState(false);
  const navigate = useNavigate();

  const loadInbox = useCallback(async () => {
    try {
      setScanning(true);
      const [inboxRes, changesRes] = await Promise.all([
        fetch('/api/mobile/inbox'),
        fetch('/api/mobile/project-changes'),
      ]);
      if (inboxRes.ok) {
        const data = await inboxRes.json();
        if (data.projects) {
          setInboxItems(data.projects);
          setDeleteRequests(data.deleteRequests || []);
        } else if (Array.isArray(data)) {
          setInboxItems(data);
          setDeleteRequests([]);
        }
      }
      if (changesRes.ok) {
        const data = await changesRes.json();
        setProjectChanges(data.changes || []);
      }
    } catch (error) {
      console.error('Error loading inbox:', error);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    loadInbox();
    const interval = setInterval(loadInbox, 60000);
    return () => clearInterval(interval);
  }, [loadInbox]);

  const totalCount = inboxItems.length + deleteRequests.length + projectChanges.length;

  return (
    <div className="inbox-page">
      <div className="inbox-page-header">
        <Inbox size={22} />
        <h1>Inbox</h1>
        {scanning && <Loader size={16} className="spinning" />}
      </div>

      {totalCount === 0 && !scanning ? (
        <div className="inbox-page-empty">
          <Inbox size={48} strokeWidth={1} />
          <p>Keine neuen Uploads in der Inbox</p>
        </div>
      ) : (
        <InboxContent
          projects={inboxItems}
          deleteRequests={deleteRequests}
          projectChanges={projectChanges}
          onRefresh={loadInbox}
          asPage
          onNavigateToProject={(projectName) => {
            navigate('/projects', { state: { openProject: projectName } });
          }}
        />
      )}
    </div>
  );
}

export default InboxPage;
