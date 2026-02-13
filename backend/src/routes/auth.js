const express = require('express');
const router = express.Router();
const { createOAuth2Client, getAuthUrl } = require('../config/oauth');
const {
  exchangeCodeForTokens,
  getAuthStatus,
  deleteTokens,
  checkCredentials,
  saveCredentials
} = require('../services/authService');

/**
 * Auth Routes
 * Handles Google OAuth 2.0 authentication flow
 */

// Check if OAuth credentials are configured
router.get('/credentials/status', (req, res) => {
  try {
    const status = checkCredentials();
    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Save OAuth credentials
router.post('/credentials', async (req, res) => {
  try {
    const { clientId, clientSecret } = req.body;

    if (!clientId || !clientSecret) {
      return res.status(400).json({
        error: 'Client ID and Client Secret are required'
      });
    }

    await saveCredentials(clientId, clientSecret);

    res.json({
      success: true,
      message: 'Credentials saved successfully'
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Get auth status
router.get('/status', async (req, res) => {
  try {
    const status = await getAuthStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Initiate OAuth flow
router.get('/google', (req, res) => {
  try {
    const oauth2Client = createOAuth2Client();

    if (!oauth2Client) {
      return res.status(500).json({
        error: 'OAuth not configured',
        message: 'Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env file'
      });
    }

    const authUrl = getAuthUrl(oauth2Client);
    res.redirect(authUrl);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// OAuth callback
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;

  // User denied access
  if (error) {
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Login abgebrochen</title>
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.2);
              text-align: center;
              max-width: 400px;
            }
            h1 { color: #e74c3c; margin-bottom: 20px; }
            p { color: #555; margin-bottom: 30px; line-height: 1.6; }
            button {
              background: #667eea;
              color: white;
              border: none;
              padding: 12px 30px;
              border-radius: 6px;
              cursor: pointer;
              font-size: 16px;
              transition: background 0.3s;
            }
            button:hover { background: #5568d3; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Login abgebrochen</h1>
            <p>Du hast die Anmeldung mit Google abgebrochen.</p>
            <button onclick="window.close()">Fenster schließen</button>
          </div>
        </body>
      </html>
    `);
  }

  // No code received
  if (!code) {
    return res.status(400).json({
      error: 'No authorization code received'
    });
  }

  try {
    // Exchange code for tokens
    await exchangeCodeForTokens(code);

    // Success page
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Login erfolgreich</title>
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.2);
              text-align: center;
              max-width: 400px;
            }
            h1 { color: #27ae60; margin-bottom: 20px; }
            p { color: #555; margin-bottom: 20px; line-height: 1.6; }
            .success-icon {
              font-size: 64px;
              margin-bottom: 20px;
            }
            button {
              background: #27ae60;
              color: white;
              border: none;
              padding: 12px 30px;
              border-radius: 6px;
              cursor: pointer;
              font-size: 16px;
              transition: background 0.3s;
              margin: 5px;
            }
            button:hover { background: #229954; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon">✅</div>
            <h1>Login erfolgreich!</h1>
            <p>Du bist jetzt mit deinem Google-Konto angemeldet.</p>
            <p>Du kannst jetzt Google Drive synchronisieren und Dateien verwalten.</p>
            <button onclick="window.close()">Fenster schließen</button>
            <button onclick="notifyParent()">Zurück zur App</button>
          </div>
          <script>
            function notifyParent() {
              // Try to notify parent window
              if (window.opener) {
                window.opener.postMessage({ type: 'AUTH_SUCCESS' }, '*');
                window.close();
              } else {
                window.close();
              }
            }

            // Auto-notify after 2 seconds
            setTimeout(() => {
              notifyParent();
            }, 2000);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('OAuth callback error:', error);

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Login fehlgeschlagen</title>
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.2);
              text-align: center;
              max-width: 400px;
            }
            h1 { color: #e74c3c; margin-bottom: 20px; }
            p { color: #555; margin-bottom: 20px; line-height: 1.6; }
            .error { background: #fee; padding: 15px; border-radius: 6px; margin: 20px 0; }
            button {
              background: #667eea;
              color: white;
              border: none;
              padding: 12px 30px;
              border-radius: 6px;
              cursor: pointer;
              font-size: 16px;
              transition: background 0.3s;
            }
            button:hover { background: #5568d3; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Login fehlgeschlagen</h1>
            <p>Es gab einen Fehler bei der Anmeldung.</p>
            <div class="error">${error.message}</div>
            <button onclick="window.close()">Fenster schließen</button>
          </div>
        </body>
      </html>
    `);
  }
});

// Logout
router.post('/logout', async (req, res) => {
  try {
    await deleteTokens();

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

module.exports = router;
