import { useState, useEffect } from 'react';
import { Download, X, RefreshCw, ExternalLink, AlertCircle } from 'lucide-react';
import './UpdateNotification.css';

function UpdateNotification() {
  const [updateInfo, setUpdateInfo] = useState(null);
  const [show, setShow] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(false);

  // Check for updates on mount
  useEffect(() => {
    checkForUpdates();

    // Check every hour
    const interval = setInterval(checkForUpdates, 60 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  const checkForUpdates = async () => {
    try {
      const response = await fetch('/api/system/version');
      if (response.ok) {
        const data = await response.json();
        setUpdateInfo(data);

        // Show notification if update is available and not dismissed
        if (data.updateAvailable && !dismissed) {
          setShow(true);
        }
      }
    } catch (error) {
      console.error('Error checking for updates:', error);
    }
  };

  const handleUpdate = async () => {
    if (!window.confirm('Server wird aktualisiert und neugestartet. Fortfahren?')) {
      return;
    }

    setUpdating(true);
    setError('');

    try {
      const response = await fetch('/api/system/update', {
        method: 'POST'
      });

      if (response.ok) {
        // Server will restart, show loading message
        setShow(false);
        showRestartMessage();
      } else {
        throw new Error('Update fehlgeschlagen');
      }
    } catch (error) {
      setError('Update konnte nicht durchgeführt werden: ' + error.message);
      setUpdating(false);
    }
  };

  const showRestartMessage = () => {
    // Show modal that waits for server to come back
    const modal = document.createElement('div');
    modal.className = 'update-restart-modal';
    modal.innerHTML = `
      <div class="update-restart-content">
        <div class="spinner"></div>
        <h2>Server wird aktualisiert...</h2>
        <p>Bitte warten. Die Seite lädt automatisch neu, sobald der Server wieder verfügbar ist.</p>
      </div>
    `;
    document.body.appendChild(modal);

    // Poll for server availability
    const checkServer = async () => {
      try {
        const response = await fetch('/api/health');
        if (response.ok) {
          // Server is back, reload page
          window.location.reload();
        }
      } catch {
        // Server still down, check again
        setTimeout(checkServer, 2000);
      }
    };

    // Wait a bit before starting to check (give server time to restart)
    setTimeout(checkServer, 5000);
  };

  const handleDismiss = () => {
    setShow(false);
    setDismissed(true);
  };

  if (!show || !updateInfo?.updateAvailable) {
    return null;
  }

  return (
    <div className="update-notification">
      <div className="update-notification-content">
        <div className="update-notification-header">
          <Download size={24} className="update-icon" />
          <div>
            <h3>Update verfügbar</h3>
            <p className="update-version">
              Version {updateInfo.currentVersion} → {updateInfo.latestVersion}
            </p>
          </div>
          <button
            className="update-close-btn"
            onClick={handleDismiss}
            disabled={updating}
          >
            <X size={20} />
          </button>
        </div>

        {updateInfo.releaseName && (
          <div className="update-release-name">
            {updateInfo.releaseName}
          </div>
        )}

        {updateInfo.releaseNotes && (
          <div className="update-notes">
            <strong>Änderungen:</strong>
            <div className="update-notes-content">
              {updateInfo.releaseNotes}
            </div>
          </div>
        )}

        {error && (
          <div className="update-error">
            <AlertCircle size={18} />
            {error}
          </div>
        )}

        <div className="update-actions">
          <a
            href={updateInfo.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            <ExternalLink size={18} />
            Auf GitHub ansehen
          </a>
          <button
            className="btn btn-primary"
            onClick={handleUpdate}
            disabled={updating}
          >
            {updating ? (
              <>
                <RefreshCw size={18} className="spinning" />
                Wird aktualisiert...
              </>
            ) : (
              <>
                <Download size={18} />
                Jetzt aktualisieren
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default UpdateNotification;
