import { useState, useEffect } from 'react';
import { Smartphone, QrCode, RefreshCw, Trash2, Download, CheckCircle, XCircle, Wifi, Clock, FolderOpen } from 'lucide-react';
import './MobileAppSettings.css';

function MobileAppSettings() {
  const [qrData, setQrData] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState(null);
  const [devices, setDevices] = useState([]);
  const [inbox, setInbox] = useState([]);
  const [notification, setNotification] = useState(null);
  const [drivePaths, setDrivePaths] = useState([]);
  const [selectedDrivePathId, setSelectedDrivePathId] = useState(null);
  const [networkAddresses, setNetworkAddresses] = useState([]);
  const [selectedAddress, setSelectedAddress] = useState(null);

  useEffect(() => {
    loadDevices();
    loadInbox();
  }, []);

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const generateQR = async () => {
    setQrLoading(true);
    setQrError(null);
    try {
      const response = await fetch('/api/mobile/connect-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drivePathId: selectedDrivePathId, networkAddress: selectedAddress })
      });
      const data = await response.json();

      if (!response.ok) {
        setQrError(data.error);
        setQrLoading(false);
        return;
      }

      setQrData(data);
      if (data.drivePaths) {
        setDrivePaths(data.drivePaths);
      }
      if (data.networkAddresses) {
        setNetworkAddresses(data.networkAddresses);
      }
    } catch (error) {
      setQrError('Fehler beim Erstellen des QR-Codes');
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
              Scanne den QR-Code mit der Handy-App, um das Gerät mit dem Google Drive Ordner zu verbinden.
              Der QR-Code enthält die Google-Anmeldedaten und den Drive-Ordner.
            </p>
          </div>
        </div>

        {/* Drive path selector (if multiple) */}
        {drivePaths.length > 1 && (
          <div className="network-selector">
            <label className="network-selector-label">
              <FolderOpen size={16} />
              Drive-Ordner für die App
            </label>
            <div className="network-options">
              {drivePaths.map(dp => (
                <button
                  key={dp.id}
                  className={`network-option ${selectedDrivePathId === dp.id ? 'active' : ''}`}
                  onClick={() => { setSelectedDrivePathId(dp.id); setQrData(null); }}
                >
                  <div className="network-option-name">{dp.name}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Network address selector (if multiple) */}
        {networkAddresses.length > 1 && (
          <div className="network-selector">
            <label className="network-selector-label">
              <Wifi size={16} />
              Server-Adresse für die App
            </label>
            <div className="network-options">
              {networkAddresses.map(addr => (
                <button
                  key={addr.address}
                  className={`network-option ${selectedAddress === addr.address ? 'active' : ''}`}
                  onClick={() => { setSelectedAddress(addr.address); setQrData(null); }}
                >
                  <div className="network-option-name">{addr.address}</div>
                  <div className="network-option-detail">{addr.name}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="qr-section">
          {qrError && (
            <div className="qr-error" style={{
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 10, padding: 16, marginBottom: 16, display: 'flex',
              alignItems: 'center', gap: 10, color: '#f87171', fontSize: 14
            }}>
              <XCircle size={20} />
              <p style={{ margin: 0 }}>{qrError}</p>
            </div>
          )}

          {qrData ? (
            <div className="qr-display">
              <QRCodeSVG data={qrData.qrData} size={220} />
              <div className="qr-info">
                <p className="qr-server">Drive-Ordner: <strong>{qrData.name}</strong></p>
                <p className="qr-server">Server: <strong>{qrData.serverUrl}</strong></p>
                <p className="qr-expires">
                  <FolderOpen size={14} />
                  QR-Code bleibt gültig bis die App neu verbunden wird
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

        {/* Mobile OAuth setup notice */}
        {qrData && !qrData.hasMobileClientId && (
          <div className="info-box" style={{ marginTop: 16, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: 16 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#f59e0b', marginBottom: 8 }}>
              Wichtig: Mobile OAuth einrichten
            </p>
            <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8, lineHeight: 1.5 }}>
              Erstelle in der <strong>Google Cloud Console</strong> eine neue OAuth-Client-ID vom Typ <strong>&quot;Desktop-App&quot;</strong>
              (APIs &amp; Dienste &rarr; Anmeldedaten &rarr; Anmeldedaten erstellen &rarr; OAuth-Client-ID &rarr; Anwendungstyp: Desktop-App).
            </p>
            <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8, lineHeight: 1.5 }}>
              Trage die Client-ID und das Client-Secret in die <code style={{ background: '#16163a', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>.env</code> Datei ein:
            </p>
            <code style={{
              display: 'block', background: '#16163a', border: '1px solid #2a2a4a', borderRadius: 6,
              padding: '10px 12px', fontSize: 12, color: '#e2e8f0', fontFamily: 'monospace',
              lineHeight: 1.6, whiteSpace: 'pre',
            }}>
{`GOOGLE_MOBILE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_MOBILE_CLIENT_SECRET=...`}
            </code>
            <p style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
              Desktop-App Client-IDs erlauben benutzerdefinierte Redirect-URIs, die von der Handy-App benötigt werden. Funktioniert auf jedem Server ohne IP-Registrierung.
            </p>
          </div>
        )}
        {qrData && qrData.hasMobileClientId && (
          <div className="info-box" style={{ marginTop: 16, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 10, padding: 12 }}>
            <p style={{ fontSize: 13, color: '#4ade80', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle size={16} />
              Mobile OAuth konfiguriert (Desktop-App Client-ID)
            </p>
          </div>
        )}

        {/* Setup instructions */}
        {qrData && (
          <div className="info-box" style={{ marginTop: 16 }}>
            <p className="label" style={{ marginBottom: 12, fontSize: 13, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>So verbindest du ein Gerät:</p>
            <div style={{ textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
                <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#2a2a4a', color: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>1</span>
                <span style={{ fontSize: 14, color: '#cbd5e1', lineHeight: 1.4, paddingTop: 2 }}>Installiere die Fuchs Metallbau App (APK unten)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
                <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#2a2a4a', color: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>2</span>
                <span style={{ fontSize: 14, color: '#cbd5e1', lineHeight: 1.4, paddingTop: 2 }}>Öffne die App und scanne diesen QR-Code</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#2a2a4a', color: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>3</span>
                <span style={{ fontSize: 14, color: '#cbd5e1', lineHeight: 1.4, paddingTop: 2 }}>Melde dich in der App mit deinem Google-Konto an</span>
              </div>
            </div>
          </div>
        )}
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
