const fs = require('fs-extra');
const path = require('path');
const { google } = require('googleapis');
const { createOAuth2Client } = require('../config/oauth');
const dotenv = require('dotenv');

/**
 * Authentication Service
 * Manages OAuth tokens with persistent storage and automatic refresh
 */

// Path to store tokens
const TOKEN_PATH = path.join(__dirname, '../../config/auth.json');

// In-memory OAuth client (initialized on first use)
let oauth2Client = null;

/**
 * Initialize OAuth2 Client
 * @returns {OAuth2Client|null}
 */
const getOAuth2Client = () => {
  if (!oauth2Client) {
    oauth2Client = createOAuth2Client();
  }
  return oauth2Client;
};

/**
 * Save tokens to file
 * @param {Object} tokens - OAuth tokens
 */
const saveTokens = async (tokens) => {
  try {
    await fs.ensureDir(path.dirname(TOKEN_PATH));
    await fs.writeJson(TOKEN_PATH, tokens, { spaces: 2 });
    console.log('✅ OAuth tokens saved successfully');
  } catch (error) {
    console.error('❌ Error saving tokens:', error.message);
    throw error;
  }
};

/**
 * Load tokens from file
 * @returns {Object|null} Tokens or null if not found
 */
const loadTokens = async () => {
  try {
    if (await fs.pathExists(TOKEN_PATH)) {
      const tokens = await fs.readJson(TOKEN_PATH);
      console.log('✅ OAuth tokens loaded successfully');
      return tokens;
    }
    return null;
  } catch (error) {
    console.error('⚠️  Error loading tokens:', error.message);
    return null;
  }
};

/**
 * Delete stored tokens (logout)
 */
const deleteTokens = async () => {
  try {
    if (await fs.pathExists(TOKEN_PATH)) {
      await fs.remove(TOKEN_PATH);
      console.log('✅ OAuth tokens deleted');
    }
  } catch (error) {
    console.error('❌ Error deleting tokens:', error.message);
    throw error;
  }
};

/**
 * Check if user is authenticated
 * @returns {boolean}
 */
const isAuthenticated = async () => {
  const tokens = await loadTokens();
  return tokens !== null && tokens.access_token;
};

/**
 * Get authenticated OAuth2 client with automatic token refresh
 * @returns {OAuth2Client}
 */
const getAuthenticatedClient = async () => {
  const client = getOAuth2Client();

  if (!client) {
    throw new Error('OAuth2 client not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env');
  }

  // Load tokens
  const tokens = await loadTokens();

  if (!tokens) {
    throw new Error('Not authenticated. Please login first.');
  }

  // Set credentials
  client.setCredentials(tokens);

  // Setup automatic token refresh
  client.on('tokens', async (newTokens) => {
    console.log('🔄 Refreshing OAuth tokens...');

    // Merge new tokens with existing ones (refresh_token might not be included)
    const updatedTokens = {
      ...tokens,
      ...newTokens
    };

    await saveTokens(updatedTokens);
  });

  return client;
};

/**
 * Exchange authorization code for tokens
 * @param {string} code - Authorization code from OAuth callback
 * @returns {Object} Tokens
 */
const exchangeCodeForTokens = async (code) => {
  const client = getOAuth2Client();

  if (!client) {
    throw new Error('OAuth2 client not configured');
  }

  try {
    const { tokens } = await client.getToken(code);

    // Save tokens
    await saveTokens(tokens);

    // Set credentials on client
    client.setCredentials(tokens);

    console.log('✅ User authenticated successfully');

    return tokens;
  } catch (error) {
    console.error('❌ Error exchanging code for tokens:', error.message);
    throw new Error('Failed to authenticate with Google');
  }
};

/**
 * Get Drive API instance with authentication
 * @returns {drive_v3.Drive}
 */
const getDriveClient = async () => {
  const authClient = await getAuthenticatedClient();

  return google.drive({
    version: 'v3',
    auth: authClient
  });
};

/**
 * Get authentication status with token info
 * @returns {Object}
 */
const getAuthStatus = async () => {
  try {
    const tokens = await loadTokens();

    if (!tokens) {
      return {
        authenticated: false,
        message: 'Not logged in'
      };
    }

    // Check if token is expired
    const now = Date.now();
    const expiryDate = tokens.expiry_date;

    if (expiryDate && expiryDate < now) {
      return {
        authenticated: true,
        tokenExpired: true,
        message: 'Token expired, will auto-refresh on next request'
      };
    }

    return {
      authenticated: true,
      tokenExpired: false,
      expiresIn: expiryDate ? Math.floor((expiryDate - now) / 1000 / 60) : null, // minutes
      message: 'Logged in successfully'
    };
  } catch (error) {
    return {
      authenticated: false,
      error: error.message
    };
  }
};

/**
 * Initialize auth service on startup
 * Loads tokens if available
 */
const initializeAuth = async () => {
  const client = getOAuth2Client();

  if (!client) {
    console.log('⚠️  OAuth not configured - Google Drive sync will not work');
    console.log('   To enable: Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env');
    return;
  }

  const tokens = await loadTokens();

  if (tokens) {
    console.log('✅ Found existing OAuth tokens');
    client.setCredentials(tokens);
  } else {
    console.log('ℹ️  No OAuth tokens found - please login via /api/auth/google');
  }
};

/**
 * Check if OAuth credentials are configured
 * @returns {Object} Status object
 */
const checkCredentials = () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  const isConfigured =
    clientId &&
    clientSecret &&
    clientId !== 'your_client_id_here.apps.googleusercontent.com' &&
    clientSecret !== 'your_client_secret_here';

  return {
    configured: isConfigured,
    clientId: isConfigured ? clientId : null,
    message: isConfigured
      ? 'OAuth credentials are configured'
      : 'OAuth credentials are missing or not configured'
  };
};

/**
 * Save OAuth credentials to .env file
 * @param {string} clientId - Google Client ID
 * @param {string} clientSecret - Google Client Secret
 */
const saveCredentials = async (clientId, clientSecret) => {
  try {
    const envPath = path.join(__dirname, '../../.env');

    // Read existing .env file
    let envContent = '';
    if (await fs.pathExists(envPath)) {
      envContent = await fs.readFile(envPath, 'utf8');
    }

    // Update or add credentials
    const lines = envContent.split('\n');
    let clientIdUpdated = false;
    let clientSecretUpdated = false;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('GOOGLE_CLIENT_ID=')) {
        lines[i] = `GOOGLE_CLIENT_ID=${clientId}`;
        clientIdUpdated = true;
      } else if (lines[i].startsWith('GOOGLE_CLIENT_SECRET=')) {
        lines[i] = `GOOGLE_CLIENT_SECRET=${clientSecret}`;
        clientSecretUpdated = true;
      }
    }

    // Add if not found
    if (!clientIdUpdated) {
      lines.push(`GOOGLE_CLIENT_ID=${clientId}`);
    }
    if (!clientSecretUpdated) {
      lines.push(`GOOGLE_CLIENT_SECRET=${clientSecret}`);
    }

    // Ensure GOOGLE_REDIRECT_URI exists
    const hasRedirectUri = lines.some(line => line.startsWith('GOOGLE_REDIRECT_URI='));
    if (!hasRedirectUri) {
      lines.push('GOOGLE_REDIRECT_URI=http://localhost:3001/api/auth/google/callback');
    }

    // Write back to .env
    await fs.writeFile(envPath, lines.join('\n'));

    // Reload environment variables
    dotenv.config({ path: envPath });

    // Reset OAuth client to pick up new credentials
    oauth2Client = null;

    console.log('✅ OAuth credentials saved successfully');
  } catch (error) {
    console.error('❌ Error saving credentials:', error.message);
    throw new Error('Failed to save credentials to .env file');
  }
};

module.exports = {
  getOAuth2Client,
  saveTokens,
  loadTokens,
  deleteTokens,
  isAuthenticated,
  getAuthenticatedClient,
  exchangeCodeForTokens,
  getDriveClient,
  getAuthStatus,
  initializeAuth,
  checkCredentials,
  saveCredentials
};
