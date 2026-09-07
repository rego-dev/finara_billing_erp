/**
 * Keyword → GL account mapping for cash request and liquidation lines.
 *
 * Pure module: no Prisma, no I/O, no business context. Returns COA *codes*;
 * the caller resolves a code to an account id within its own business.
 *
 * Ordering matters — the first rule with a keyword hit wins. More specific
 * work (printing) is declared before the raw materials it is made from, so
 * "tarpaulin printing" books as printing rather than as materials.
 *
 * Accounting policy (confirmed with the business owner, 2026-08-04): build
 * materials and printing map to Cost of Sales (50xx) because the spend is
 * consumed producing work billed to clients, so the cost matches that job's
 * revenue. The COA reinforces this — 6530 is named "Marketing & Promotions
 * (Internal)" precisely to hold the company's own promo spend instead.
 *
 * Spend on the company's own booths still belongs in 6530; that is what the
 * per-line override in the UI is for. Do not flip these defaults without
 * revisiting the decision.
 */

const FALLBACK_ACCOUNT = '6390'; // Miscellaneous Expense

const KEYWORD_RULES = [
  { accountCode: '5029', keywords: ['print', 'printing', 'tarpaulin', 'tarp', 'sticker', 'decal', 'photocopy', 'xerox', 'reproduction'] },
  { accountCode: '5028', keywords: ['photography', 'videography', 'photo', 'video', 'shoot', 'drone'] },
  { accountCode: '5027', keywords: ['studio'] },
  { accountCode: '5026', keywords: ['rental', 'generator', 'genset', 'sound system', 'lights rental'] },
  { accountCode: '5025', keywords: ['talent', 'model', 'host', 'emcee', 'voice over'] },
  { accountCode: '5024', keywords: ['subcon', 'subcontractor', 'freelance', 'freelancer'] },
  { accountCode: '5021', keywords: ['plywood', 'paint', 'nails', 'screws', 'lumber', 'vinyl', 'sintra', 'acrylic', 'foam', 'glue', 'tape', 'wood', 'steel'] },
  { accountCode: '6520', keywords: ['grab', 'taxi', 'fare', 'gas', 'gasoline', 'diesel', 'toll', 'parking', 'fuel', 'jeep', 'tricycle', 'habal'] },
  { accountCode: '6510', keywords: ['meal', 'meals', 'food', 'snack', 'snacks', 'merienda', 'lunch', 'dinner', 'breakfast', 'catering', 'drinks', 'water'] },
  { accountCode: '6320', keywords: ['bond paper', 'ink', 'ballpen', 'pen', 'folder', 'stapler', 'office supplies', 'envelope', 'notebook'] },
  { accountCode: '6330', keywords: ['courier', 'lbc', 'jrs', 'delivery', 'freight', 'padala'] },
  { accountCode: '6370', keywords: ['permit', 'license', 'clearance', 'registration', 'barangay', 'mayor', 'bir'] },
  { accountCode: '6240', keywords: ['repair', 'maintenance', 'fix'] },
  { accountCode: '6310', keywords: ['internet', 'wifi', 'load', 'data plan', 'sim'] },
  { accountCode: '6360', keywords: ['bank charge', 'transfer fee', 'service fee', 'remittance fee'] },
];

// Escape regex metacharacters so a keyword is always treated literally.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Word-boundary match so "gas" does not fire on "gastos" and "pen" not on "penalty".
const hasKeyword = (haystack, keyword) =>
  new RegExp(`\\b${escapeRe(keyword)}\\b`, 'i').test(haystack);

function matchAccount(description) {
  const text = String(description || '').trim();
  if (!text) return { accountCode: FALLBACK_ACCOUNT, matched: false };

  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((kw) => hasKeyword(text, kw))) {
      return { accountCode: rule.accountCode, matched: true };
    }
  }
  return { accountCode: FALLBACK_ACCOUNT, matched: false };
}

function matchAccountCode(description) {
  return matchAccount(description).accountCode;
}

module.exports = { matchAccount, matchAccountCode, KEYWORD_RULES, FALLBACK_ACCOUNT };
