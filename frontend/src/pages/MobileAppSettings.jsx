import { useState, useEffect, useRef } from 'react';
import { Smartphone, QrCode, RefreshCw, Trash2, Download, CheckCircle, XCircle, Wifi, Clock } from 'lucide-react';
import './MobileAppSettings.css';

function MobileAppSettings() {
  const [qrData, setQrData] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [devices, setDevices] = useState([]);
  const [inbox, setInbox] = useState([]);
  const [notification, setNotification] = useState(null);
  const qrTimerRef = useRef(null);

  useEffect(() => {
    loadDevices();
    loadInbox();
    return () => {
      if (qrTimerRef.current) clearInterval(qrTimerRef.current);
    };
  }, []);

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const generateQR = async () => {
    setQrLoading(true);
    try {
      const response = await fetch('/api/mobile/connect-token');
      const data = await response.json();
      setQrData(data);

      // Auto-expire after 5 minutes
      if (qrTimerRef.current) clearInterval(qrTimerRef.current);
      qrTimerRef.current = setTimeout(() => {
        setQrData(null);
      }, 5 * 60 * 1000);
    } catch (error) {
      showNotification('Fehler beim Erstellen des QR-Codes', 'error');
    } finally {
      setQrLoading(false);
    }
  };

  const loadDevices = async () => {
    try {
      const response = await fetch('/api/mobile/devices');
      const data = await response.json();
      setDevices(data);
    } catch (error) {
      console.error('Failed to load devices:', error);
    }
  };

  const loadInbox = async () => {
    try {
      const response = await fetch('/api/mobile/inbox');
      const data = await response.json();
      setInbox(data.filter(i => i.status === 'new_project' || i.status === 'pending'));
    } catch (error) {
      console.error('Failed to load inbox:', error);
    }
  };

  const removeDevice = async (deviceId) => {
    if (!window.confirm('Gerät wirklich entfernen? Das Gerät muss erneut verbunden werden.')) return;
    try {
      await fetch(`/api/mobile/devices/${deviceId}`, { method: 'DELETE' });
      showNotification('Gerät entfernt');
      loadDevices();
    } catch (error) {
      showNotification('Fehler beim Entfernen', 'error');
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Nie';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Gerade eben';
    if (diffMin < 60) return `vor ${diffMin} Min.`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `vor ${diffHours} Std.`;
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  // Generate a simple QR code as SVG (no external dependency needed)
  const QRCodeSVG = ({ data, size = 200 }) => {
    // Simple QR code using a data URI for a QR code API
    // For production, use a proper QR library
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}&bgcolor=1a1a2e&color=e2e8f0&format=svg`;

    return (
      <img
        src={qrUrl}
        alt="QR Code"
        width={size}
        height={size}
        style={{ borderRadius: 8 }}
      />
    );
  };

  return (
    <div className="mobile-settings-page">
      {notification && (
        <div className={`notification notification-${notification.type}`}>
          {notification.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
          {notification.message}
        </div>
      )}

      {/* QR Code Section */}
      <div className="settings-section">
        <div className="section-header-row">
          <div>
            <h2>Gerät verbinden</h2>
            <p className="section-description">
              Scanne den QR-Code mit der Handy-App, um das Gerät mit diesem Server zu verbinden.
            </p>
          </div>
        </div>

        <div className="qr-section">
          {qrData ? (
            <div className="qr-display">
              <QRCodeSVG data={JSON.stringify({
                token: qrData.token,
                serverUrl: qrData.serverUrl,
              })} size={220} />
              <div className="qr-info">
                <p className="qr-server">Server: <strong>{qrData.serverUrl}</strong></p>
                <p className="qr-expires">
                  <Clock size={14} />
                  Gültig für 5 Minuten
                </p>
              </div>
              <button className="btn btn-secondary" onClick={generateQR}>
                <RefreshCw size={16} />
                Neuer QR-Code
              </button>
            </div>
          ) : (
            <div className="qr-placeholder">
              <QrCode size={48} strokeWidth={1} />
              <p>Erstelle einen QR-Code, um ein Gerät zu verbinden</p>
              <button
                className="btn btn-primary"
                onClick={generateQR}
                disabled={qrLoading}
              >
                {qrLoading ? (
                  <><RefreshCw size={16} className="spinning" /> Wird erstellt...</>
                ) : (
                  <><QrCode size={16} /> QR-Code generieren</>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* APK Download */}
      <div className="settings-section">
        <h2>App herunterladen</h2>
        <p className="section-description">
          Lade die APK-Datei herunter und installiere sie auf deinem Android-Gerät.
        </p>
        <div className="apk-download">
          <div className="apk-info">
            <Smartphone size={24} />
            <div>
              <strong>Fuchs Metallbau App</strong>
              <span>Android (APK)</span>
            </div>
          </div>
          <a href="/api/mobile/app.apk" className="btn btn-primary" download>
            <Download size={16} />
            APK herunterladen
          </a>
        </div>
      </div>

      {/* Connected Devices */}
      <div className="settings-section">
        <div className="section-header-row">
          <div>
            <h2>Verbundene Geräte</h2>
            <p className="section-description">
              Alle Geräte, die mit diesem Server verbunden sind.
            </p>
          </div>
          <button className="btn btn-secondary" onClick={loadDevices}>
            <RefreshCw size={16} />
            Aktualisieren
          </button>
        </div>

        <div className="devices-list">
          {devices.length === 0 ? (
            <div className="empty-state">
              <Smartphone size={36} strokeWidth={1} />
              <p>Keine Geräte verbunden</p>
              <span>Verbinde ein Gerät über den QR-Code oben.</span>
            </div>
          ) : (
            devices.map(device => (
              <div key={device.device_id} className="device-item">
                <div className="device-icon">
                  <Smartphone size={20} />
                </div>
                <div className="device-info">
                  <div className="device-name">{device.user_name}</div>
                  <div className="device-meta">
                    <span>
                      <Wifi size={12} />
                      {device.device_name || 'Unbekannt'}
                    </span>
                    <span>
                      <Clock size={12} />
                      {formatDate(device.last_seen)}
                    </span>
                  </div>
                </div>
                <button
                  className="btn btn-icon btn-danger-icon"
                  onClick={() => removeDevice(device.device_id)}
                  title="Gerät entfernen"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Inbox */}
      {inbox.length > 0 && (
        <div className="settings-section">
          <h2>Inbox</h2>
          <p className="section-description">
            Neue Uploads und Projekte von der Handy-App.
          </p>
          <div className="inbox-list">
            {inbox.map(item => (
              <div key={item.id} className="inbox-item">
                <div className="inbox-icon">
                  {item.status === 'new_project' ? '📁' : '🖼️'}
                </div>
                <div className="inbox-info">
                  <div className="inbox-name">{item.original_name || item.file_name}</div>
                  <div className="inbox-meta">
                    von {item.device_user || item.user_name} &middot; {formatDate(item.uploaded_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default MobileAppSettings;
