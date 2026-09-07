// Validation for public marketing lead submissions (POST /api/leads).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function validateLead(body = {}) {
  const name    = clean(body.name, 100);
  const company = clean(body.company, 150);
  const email   = clean(body.email, 150);
  const phone   = clean(body.phone, 30);
  const message = clean(body.message, 2000);
  const source  = clean(body.source, 50) || 'contact';

  const errors = {};
  if (!name) errors.name = 'Name is required';
  if (!email) errors.email = 'Email is required';
  else if (!EMAIL_RE.test(email)) errors.email = 'Invalid email address';
  if (!message) errors.message = 'Message is required';

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    data: {
      name,
      company: company || null,
      email,
      phone: phone || null,
      message,
      source,
    },
  };
}

module.exports = { validateLead };
