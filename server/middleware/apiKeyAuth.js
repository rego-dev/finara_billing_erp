const crypto = require('crypto');

// Static-key auth for machine-to-machine endpoints (X-API-Key header).
// Key comes from LEAD_EXPORT_API_KEY; when unset the endpoint is disabled (404).
const apiKeyAuth = (req, res, next) => {
  const configured = (process.env.LEAD_EXPORT_API_KEY || '').trim();
  if (!configured) {
    return res.status(404).json({ error: 'Not found' });
  }

  const supplied = req.headers['x-api-key'] || '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(configured);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

module.exports = { apiKeyAuth };
