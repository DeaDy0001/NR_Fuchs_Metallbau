import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import './InboxBanner.css';

function InboxBanner() {
  const [unreadCount, setUnreadCount] = useState(0);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try {
      // Poll inbox + project-changes so the backend can log new activities
      await Promise.allSettled([
        fetch('/api/mobile/inbox'),
        fetch('/api/mobile/project-changes'),
      ]);
      // Then check how many unread activities were produced
      const res = await fetch('/api/mobile/activities?unread_count=1');
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.unread_count || 0);
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
            ? '1 neue Handy-App Aktivität'
            : `${unreadCount} neue Handy-App Aktivitäten`}
        </span>
        <span className="inbox-banner-cta">Jetzt ansehen →</span>
      </div>
    </div>
  );
}

export default InboxBanner;
