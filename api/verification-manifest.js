const { sendJson } = require('../lib/http');

module.exports = async function verificationManifest(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });

  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const code = String(url.searchParams.get('code') || '').trim();
  if (!/^[A-Za-z0-9_-]{32}$/.test(code)) {
    return sendJson(res, 400, { error: 'A valid verification code is required.' });
  }

  const launchPath = `/verify/${encodeURIComponent(code)}`;
  const manifest = {
    id: launchPath,
    name: 'Voterlist Status',
    short_name: 'Voter Status',
    description: 'View this QR code’s voter registration status.',
    start_url: launchPath,
    scope: launchPath,
    display: 'standalone',
    background_color: '#f3f7f7',
    theme_color: '#0f766e',
    icons: [
      {
        src: '/icons/voterlist-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/voterlist-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(manifest));
};
