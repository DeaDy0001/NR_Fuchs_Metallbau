import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import './InboxBanner.css';

function InboxBanner() {
  const [unreadCount, setUnreadCount] = useState(0);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try {
      // Poll new JSON-based requests to detect new inbox items
      const reqRes = await fetch('/api/mobile/inbox/requests');
      if (reqRes.ok) {
        const data = await reqRes.json();
        const count =
          (data.image_requests?.length || 0) +
          (data.projekt_requests?.length || 0) +
          (data.image_change_requests?.length || 0) +
          (data.projekt_change_requests?.length || 0) +
          (data.delete_requests?.length || 0);
        setUnreadCount(count);
      }
    } catch {
      // ignore network errors
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (unreadCount === 0) return null;

  return (
    <div
      className="inbox-banner"
      onClick={() => navigate('/inbox')}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && navigate('/inbox')}
    >
      <div className="inbox-banner-content">
        <Inbox size={18} />
        <span>
          {unreadCount === 1
            ? '1 neue Postfach-Anfrage'
            : `${unreadCount} neue Postfach-Anfragen`}
        </span>
        <span className="inbox-banner-cta">Jetzt ansehen →</span>
      </div>
    </div>
  );
}

export default InboxBanner;
