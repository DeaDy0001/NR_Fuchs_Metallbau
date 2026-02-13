const { google } = require('googleapis');

/**
 * OAuth 2.0 Configuration
 *
 * Scopes:
 * - drive.readonly: Read files from Drive
 * - drive.file: Manage files created by this app
 * - drive: Full Drive access (needed for deleting files)
 */

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file'
];

/**
 * Create OAuth2 Client
 * @returns {OAuth2Client} Configured OAuth2 client
 */
const createOAuth2Client = () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/auth/google/callback';

  if (!clientId || !clientSecret) {
    console.warn('⚠️  Google OAuth credentials not configured');
    console.warn('   Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env');
    return null;
  }

  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );
};

/**
 * Get authorization URL for OAuth flow
 * @param {OAuth2Client} oauth2Client - OAuth2 client instance
 * @returns {string} Authorization URL
 */
const getAuthUrl = (oauth2Client) => {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline', // Gets refresh token
    scope: SCOPES,
    prompt: 'consent' // Force consent screen to always get refresh token
  });
};

module.exports = {
  createOAuth2Client,
  getAuthUrl,
  SCOPES
};
