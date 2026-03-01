import { useState, useEffect } from 'react';
import { Smartphone, QrCode, RefreshCw, Trash2, CheckCircle, XCircle, Wifi, Clock, FolderOpen } from 'lucide-react';
import './MobileAppSettings.css';

function MobileAppSettings() {
  const [qrData, setQrData] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState(null);
  const [devices, setDevices] = useState([]);
  const [notification, setNotification] = useState(null);
  const [drivePaths, setDrivePaths] = useState([]);
  const [selectedDrivePathId, setSelectedDrivePathId] = useState(null);
  const [networkAddresses, setNetworkAddresses] = useState([]);
  const [selectedAddress, setSelectedAddress] = useState(null);

  useEffect(() => {
    loadDevices();
    loadConnectInfo();

    // Auto-refresh devices every 30 seconds for online status
    const interval = setInterval(loadDevices, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadConnectInfo = async () => {
    try {
      const response = await fetch('/api/mobile/connect-info');
      if (response.ok) {
        const data = await response.json();
        if (data.networkAddresses) setNetworkAddresses(data.networkAddresses);
        if (data.drivePaths) setDrivePaths(data.drivePaths);
      }
    } catch (error) {
      console.error('Failed to load connect info:', error);
    }
  };

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

        {/* Drive path selector */}
        {drivePaths.length >= 1 && (
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

        {/* Network address selector */}
        {networkAddresses.length >= 1 && (
          <div className="network-selector">
            <label className="network-selector-label">
              <Wifi size={16} />
              Server-Adresse für die App
            </label>
            <div className="network-options">
              {networkAddresses.map(addr => (
                <button
                  key={addr.address}
                  className={`network-option ${(selectedAddress || networkAddresses[0]?.address) === addr.address ? 'active' : ''}`}
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

      {/* Connected Devices */}
      <div className="settings-section">
        <div className="section-header-row">
          <div>
            <h2>Verbundene Geräte</h2>
            <p className="section-description">
              Alle registrierten Geräte, die sich über den QR-Code angemeldet haben.
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
              <div key={device.device_id} className={`device-item ${device.is_online ? 'device-online' : 'device-offline'}`}>
                <div className={`device-icon ${device.is_online ? 'device-icon-online' : ''}`}>
                  <Smartphone size={20} />
                </div>
                <div className="device-info">
                  <div className="device-name">
                    {device.user_name}
                    <span className={`device-status-badge ${device.is_online ? 'status-online' : 'status-offline'}`}>
                      <span className={`status-dot ${device.is_online ? 'dot-online' : 'dot-offline'}`} />
                      {device.is_online ? 'Im Netzwerk' : 'Offline'}
                    </span>
                  </div>
                  <div className="device-meta">
                    <span>
                      <Smartphone size={12} />
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
    </div>
  );
}

export default MobileAppSettings;
