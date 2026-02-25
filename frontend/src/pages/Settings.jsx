import { useState, useRef, useEffect } from 'react';
import { Upload, Trash2, Network, Copy, Check } from 'lucide-react';
import './Settings.css';

function Settings({ settings, updateSettings, onSettingsChange }) {
  const [uploading, setUploading] = useState(false);
  const [uploadingFavicon, setUploadingFavicon] = useState(false);
  const [companyName, setCompanyName] = useState(settings.company_name || 'Fuchs Metallbau');
  const [primaryColor, setPrimaryColor] = useState(settings.primary_color || '#3b82f6');
  const [networkInfo, setNetworkInfo] = useState(null);
  const [copiedUrl, setCopiedUrl] = useState(null);
  const fileInputRef = useRef(null);
  const faviconInputRef = useRef(null);

  useEffect(() => {
    loadNetworkInfo();
  }, []);

  const loadNetworkInfo = async () => {
    try {
      const response = await fetch('/api/system/network-info');
      if (response.ok) {
        const data = await response.json();
        setNetworkInfo(data);
      }
    } catch (error) {
      console.error('Error loading network info:', error);
    }
  };

  const copyToClipboard = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch (error) {
      console.error('Error copying to clipboard:', error);
    }
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('logo', file);

    setUploading(true);

    try {
      const response = await fetch('/api/settings/logo', {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        updateSettings({ logo_path: data.logo_path });
        onSettingsChange();
      } else {
        alert('Fehler beim Hochladen des Logos');
      }
    } catch (error) {
      console.error('Error uploading logo:', error);
      alert('Fehler beim Hochladen des Logos');
    } finally {
      setUploading(false);
    }
  };

  const handleLogoDelete = async () => {
    if (!confirm('Möchten Sie das Logo wirklich löschen?')) return;

    try {
      const response = await fetch('/api/settings/logo', {
        method: 'DELETE'
      });

      if (response.ok) {
        updateSettings({ logo_path: null });
        onSettingsChange();
      } else {
        alert('Fehler beim Löschen des Logos');
      }
    } catch (error) {
      console.error('Error deleting logo:', error);
      alert('Fehler beim Löschen des Logos');
    }
  };

  const handleFaviconUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('favicon', file);

    setUploadingFavicon(true);

    try {
      const response = await fetch('/api/settings/favicon', {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        updateSettings({ favicon_path: data.favicon_path });
        onSettingsChange();
        // Update favicon in browser
        const link = document.querySelector("link[rel~='icon']");
        if (link) {
          link.href = data.favicon_path + '?v=' + Date.now();
        }
      } else {
        alert('Fehler beim Hochladen des Favicons');
      }
    } catch (error) {
      console.error('Error uploading favicon:', error);
      alert('Fehler beim Hochladen des Favicons');
    } finally {
      setUploadingFavicon(false);
    }
  };

  const handleFaviconDelete = async () => {
    if (!confirm('Möchten Sie das Favicon wirklich löschen?')) return;

    try {
      const response = await fetch('/api/settings/favicon', {
        method: 'DELETE'
      });

      if (response.ok) {
        updateSettings({ favicon_path: null });
        onSettingsChange();
        // Reset favicon in browser
        const link = document.querySelector("link[rel~='icon']");
        if (link) {
          link.href = '/favicon.ico';
        }
      } else {
        alert('Fehler beim Löschen des Favicons');
      }
    } catch (error) {
      console.error('Error deleting favicon:', error);
      alert('Fehler beim Löschen des Favicons');
    }
  };

  const handleCompanyNameSave = async () => {
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_name: companyName })
      });

      if (response.ok) {
        const data = await response.json();
        updateSettings({ company_name: data.company_name });
        onSettingsChange();
        alert('Firmenname erfolgreich gespeichert');
      } else {
        alert('Fehler beim Speichern des Firmennamens');
      }
    } catch (error) {
      console.error('Error saving company name:', error);
      alert('Fehler beim Speichern des Firmennamens');
    }
  };

  const handlePrimaryColorSave = async () => {
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primary_color: primaryColor })
      });

      if (response.ok) {
        const data = await response.json();
        updateSettings({ primary_color: data.primary_color });
        onSettingsChange();
        alert('Hauptfarbe erfolgreich gespeichert');
      } else {
        alert('Fehler beim Speichern der Hauptfarbe');
      }
    } catch (error) {
      console.error('Error saving primary color:', error);
      alert('Fehler beim Speichern der Hauptfarbe');
    }
  };

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>Einstellungen</h1>
      </div>

      <div className="settings-section">
        <h2>Logo</h2>
        <p className="section-description">
          Laden Sie ein Logo hoch, das in der Kopfzeile angezeigt wird.
        </p>

        <div className="logo-settings">
          {settings.logo_path && (
            <div className="logo-preview">
              <img src={settings.logo_path} alt="Logo" />
            </div>
          )}

          <div className="logo-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoUpload}
              style={{ display: 'none' }}
            />

            <button
              className="btn btn-primary"
              onClick={() => fileInputRef.current.click()}
              disabled={uploading}
            >
              <Upload size={18} />
              {uploading ? 'Lädt hoch...' : settings.logo_path ? 'Logo ändern' : 'Logo hochladen'}
            </button>

            {settings.logo_path && (
              <button
                className="btn btn-danger"
                onClick={handleLogoDelete}
              >
                <Trash2 size={18} />
                Logo löschen
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h2>Favicon</h2>
        <p className="section-description">
          Laden Sie ein Favicon hoch, das im Browser-Tab angezeigt wird. Empfohlen: 32x32 oder 64x64 Pixel, .ico, .png oder .svg Format.
        </p>

        <div className="logo-settings">
          {settings.favicon_path && (
            <div className="favicon-preview">
              <img src={settings.favicon_path} alt="Favicon" />
            </div>
          )}

          <div className="logo-actions">
            <input
              ref={faviconInputRef}
              type="file"
              accept="image/*,.ico"
              onChange={handleFaviconUpload}
              style={{ display: 'none' }}
            />

            <button
              className="btn btn-primary"
              onClick={() => faviconInputRef.current.click()}
              disabled={uploadingFavicon}
            >
              <Upload size={18} />
              {uploadingFavicon ? 'Lädt hoch...' : settings.favicon_path ? 'Favicon ändern' : 'Favicon hochladen'}
            </button>

            {settings.favicon_path && (
              <button
                className="btn btn-danger"
                onClick={handleFaviconDelete}
              >
                <Trash2 size={18} />
                Favicon löschen
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h2>Firmenname</h2>
        <p className="section-description">
          Der Firmenname wird im Browser-Tab und an verschiedenen Stellen der Anwendung angezeigt.
        </p>
        <div className="input-group">
          <input
            type="text"
            className="text-input"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="z.B. Fuchs Metallbau"
          />
          <button
            className="btn btn-primary"
            onClick={handleCompanyNameSave}
          >
            Speichern
          </button>
        </div>
      </div>

      <div className="settings-section">
        <h2>Hauptfarbe</h2>
        <p className="section-description">
          Die Hauptfarbe wird für Akzente, Buttons und Links verwendet.
        </p>
        <div className="color-picker-group">
          <div className="color-preview" style={{ backgroundColor: primaryColor }}>
            <span className="color-value">{primaryColor}</span>
          </div>
          <input
            type="color"
            className="color-input"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
          />
          <input
            type="text"
            className="text-input"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            placeholder="#3b82f6"
            pattern="^#[0-9A-Fa-f]{6}$"
          />
          <button
            className="btn btn-primary"
            onClick={handlePrimaryColorSave}
          >
            Speichern
          </button>
        </div>
      </div>

      <div className="settings-section">
        <h2>Theme</h2>
        <p className="section-description">
          Aktuell wird nur der Dark Mode unterstützt.
        </p>
        <div className="theme-info">
          <div className="theme-badge">
            Dark Mode aktiv
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h2>
          <Network size={20} style={{ verticalAlign: 'middle', marginRight: '0.5rem' }} />
          Netzwerk-Zugriff
        </h2>
        <p className="section-description">
          Über folgende Adressen ist dieser Server erreichbar. Teile eine Adresse mit anderen Geräten im selben Netzwerk, um darauf zuzugreifen.
        </p>
        {networkInfo ? (
          <div className="network-list">
            {networkInfo.addresses.map((entry, i) => (
              <div key={i} className="network-item">
                <div className="network-item-info">
                  <span className="network-item-name">{entry.name}</span>
                  <span className="network-item-url">{entry.url}</span>
                </div>
                <button
                  className="btn-copy"
                  onClick={() => copyToClipboard(entry.url)}
                  title="In Zwischenablage kopieren"
                >
                  {copiedUrl === entry.url ? <Check size={16} /> : <Copy size={16} />}
                  {copiedUrl === entry.url ? 'Kopiert' : 'Kopieren'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="section-description" style={{ marginBottom: 0 }}>Lade Netzwerk-Informationen...</p>
        )}
      </div>
    </div>
  );
}

export default Settings;
