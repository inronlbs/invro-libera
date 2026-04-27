/**
 * Set CORS on Firebase Storage using the Firebase CLI's stored credentials.
 * Run: node set-cors-via-api.mjs
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const BUCKET = 'invronteach.firebasestorage.app';
const CORS_CONFIG = [
  {
    origin: ['*'],
    method: ['GET', 'HEAD'],
    maxAgeSeconds: 3600,
    responseHeader: [
      'Content-Type',
      'Content-Length',
      'Content-Range',
      'Accept-Ranges',
      'Content-Disposition',
    ],
  },
];

async function getAccessToken() {
  // Read Firebase CLI's stored credentials
  const configPath = join(homedir(), '.config', 'configstore', 'firebase-tools.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const tokens = config.tokens;

  if (!tokens || !tokens.refresh_token) {
    throw new Error('No Firebase CLI tokens found. Run: npx firebase login');
  }

  // Exchange refresh token for access token using Google's OAuth2 endpoint
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: tokens.client_id || '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
      client_secret: tokens.client_secret || 'j9iVZfS8kkCEFUPaAeJV0sAi',
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Token refresh failed: ${resp.status} ${errText}`);
  }

  const data = await resp.json();
  return data.access_token;
}

async function setCors(accessToken) {
  // Use the GCS JSON API to patch bucket CORS
  const url = `https://storage.googleapis.com/storage/v1/b/${BUCKET}?fields=cors`;

  const resp = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ cors: CORS_CONFIG }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`CORS update failed: ${resp.status} ${errText}`);
  }

  const data = await resp.json();
  console.log('✓ CORS set on', BUCKET);
  console.log('Current CORS:', JSON.stringify(data.cors, null, 2));
}

try {
  console.log('Getting access token from Firebase CLI credentials...');
  const token = await getAccessToken();
  console.log('Got access token. Setting CORS...');
  await setCors(token);
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
