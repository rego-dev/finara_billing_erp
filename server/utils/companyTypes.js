// Company types offered at self-service onboarding. `industry` on the business
// stores the label; the key drives what gets set up.
//
// Only SCHOOL has type-specific setup today (school COA, fee types, grade
// levels, payment schemes). Every other type gets the default cloned COA and
// has the School module switched off, since it would only get in the way.
const COMPANY_TYPES = {
  SCHOOL:   { label: 'School' },
  SERVICES: { label: 'Services / Agency' },
  TRADING:  { label: 'Retail / Trading' },
  OTHER:    { label: 'Other' },
};

// Tax registration. VAT = 12% VAT-registered; NON_VAT = percentage tax.
const TAX_TYPES = ['VAT', 'NON_VAT'];

module.exports = { COMPANY_TYPES, TAX_TYPES };
