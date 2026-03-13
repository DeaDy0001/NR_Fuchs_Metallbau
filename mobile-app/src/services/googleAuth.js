import { getSetting, setSetting } from './database';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

// Wrapper with timeout so auth calls never block the loading screen forever
const fetchWithTimeout = (url, options = {}, timeoutMs = 8000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
};

/**
 * Get the stored Google Client ID (set via QR code scan)
 */
export const getGoogleClientId = async () => {
  return await getSetting('googleClientId');
};

/**
 * Store OAuth tokens in the local database
 */
export const storeTokens = async (accessToken, refreshToken, expiresIn) => {
  await setSetting('googleAccessToken', accessToken);
  if (refreshToken) await setSetting('googleRefreshToken', refreshToken);
  const expiresAt = Date.now() + (expiresIn || 3600) * 1000;
  await setSetting('googleTokenExpiry', String(expiresAt));
};

/**
 * Store which OAuth scope was granted (e.g. 'drive' vs 'drive.file')
 */
export const storeGrantedScope = async (scopeString) => {
  await setSetting('grantedScope', scopeString);
};

/**
 * Check if the token has full Drive access (not just drive.file)
 */
export const hasFullDriveScope = async () => {
  const scope = await getSetting('grantedScope');
  if (!scope) return false;
  const scopes = scope.split(' ');
  return scopes.includes('https://www.googleapis.com/auth/drive');
};

/**
 * Get a valid access token (refreshes automatically if expired)
 * Uses the backend OAuth proxy for refresh since Web-type client IDs require client_secret.
 */
export const getAccessToken = async () => {
  const token = await getSetting('googleAccessToken');
  const expiry = await getSetting('googleTokenExpiry');

  if (!token) return null;

  // Check if expired (with 5 min buffer)
  if (expiry && Date.now() > parseInt(expiry) - 300000) {
    const refreshToken = await getSetting('googleRefreshToken');

    // Try refreshing via backend proxy (preferred - has client_secret)
    if (refreshToken) {
      const serverUrl = await getSetting('serverUrl');
      if (serverUrl) {
        try {
          const response = await fetchWithTimeout(`${serverUrl}/api/mobile/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken }),
          });

          if (response.ok) {
            const data = await response.json();
            await storeTokens(data.access_token, refreshToken, data.expires_in);
            return data.access_token;
          }
        } catch (e) {
          console.log('[Fuchs] Backend token refresh failed (server unreachable?):', e.message);
        }
      }

      // Fallback: try direct refresh (only works with non-Web client types)
      try {
        const result = await refreshAccessToken(refreshToken);
        return result.accessToken;
      } catch (e) {
        console.error('[Fuchs] Direct token refresh failed:', e.message);
      }
    }
    return null;
  }

  return token;
};

/**
 * Try to refresh the access token with a specific client ID / secret pair.
 * Returns the new access token on success, null on failure.
 */
const tryRefreshWithClient = async (refreshToken, clientId, clientSecret) => {
  if (!clientId) return null;
  const params = [
    'grant_type=refresh_token',
    `refresh_token=${encodeURIComponent(refreshToken)}`,
    `client_id=${encodeURIComponent(clientId)}`,
  ];
  if (clientSecret) params.push(`client_secret=${encodeURIComponent(clientSecret)}`);

  try {
    const response = await fetchWithTimeout(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.join('&'),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.access_token) return null;
    await storeTokens(data.access_token, refreshToken, data.expires_in);
    return data.access_token;
  } catch {
    return null;
  }
};

/**
 * Refresh the access token using a refresh token.
 * Tries the device-flow client first, then the web-OAuth client as fallback –
 * because we don't know which one was used at login time.
 */
const refreshAccessToken = async (refreshToken) => {
  // Attempt 1: device-flow / installed-app client (TVs and Limited Input)
  const deviceClientId = await getGoogleClientId();
  const deviceClientSecret = await getSetting('googleClientSecret');
  const token1 = await tryRefreshWithClient(refreshToken, deviceClientId, deviceClientSecret);
  if (token1) return { accessToken: token1 };

  // Attempt 2: web-application client (used when device flow is unavailable)
  const webClientId = await getSetting('webClientId');
  const webClientSecret = await getSetting('webClientSecret');
  const token2 = await tryRefreshWithClient(refreshToken, webClientId, webClientSecret);
  if (token2) return { accessToken: token2 };

  throw new Error('Token refresh fehlgeschlagen (beide OAuth-Clients versucht)');
};

/**
 * Exchange authorization code for tokens
 */
export const exchangeCodeForTokens = async (code, redirectUri) => {
  const clientId = await getGoogleClientId();
  if (!clientId) throw new Error('Keine Google Client ID konfiguriert');
  const clientSecret = await getSetting('googleClientSecret');

  const params = [
    'grant_type=authorization_code',
    `code=${encodeURIComponent(code)}`,
    `client_id=${encodeURIComponent(clientId)}`,
    `redirect_uri=${encodeURIComponent(redirectUri)}`,
  ];
  if (clientSecret) params.push(`client_secret=${encodeURIComponent(clientSecret)}`);

  const response = await fetchWithTimeout(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.join('&'),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error_description || 'Token-Austausch fehlgeschlagen');
  }

  const data = await response.json();
  await storeTokens(data.access_token, data.refresh_token, data.expires_in);

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  };
};

/**
 * Fetch user info from Google
 */
export const fetchUserInfo = async (accessToken) => {
  const response = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) throw new Error('Benutzerinfo konnte nicht abgerufen werden');

  return response.json();
};

/**
 * Store user info in the database
 */
export const storeUserInfo = async (userInfo) => {
  if (userInfo.email) await setSetting('googleUserEmail', userInfo.email);
  if (userInfo.name) await setSetting('googleUserName', userInfo.name);
  if (userInfo.picture) await setSetting('googleUserPhoto', userInfo.picture);
  // Use Google name as default userName if not set
  const existingName = await getSetting('userName');
  if (!existingName && userInfo.name) {
    await setSetting('userName', userInfo.name);
  }
};

/**
 * Check if user is authenticated with Google
 */
export const isAuthenticated = async () => {
  const token = await getAccessToken();
  return !!token;
};

/**
 * Clear all Google auth data
 */
export const clearAuth = async () => {
  await setSetting('googleAccessToken', '');
  await setSetting('googleRefreshToken', '');
  await setSetting('googleTokenExpiry', '');
  await setSetting('googleUserEmail', '');
  await setSetting('googleUserName', '');
  await setSetting('googleUserPhoto', '');
};
