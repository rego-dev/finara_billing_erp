#!/usr/bin/env node
/**
 * scripts/reset-admin-password.js — Safely reset a user's password.
 *
 * Resets the password for ADMIN_EMAIL (default: admin@ph-erp.com), hashes it
 * with bcrypt, reactivates the account, and clears any lockout state.
 *
 * Uses raw SQL so it works regardless of which migration the target database
 * is on (won't reference columns that may not exist yet on production).
 *
 * Usage (locally, or via `railway run` against the production DATABASE_URL):
 *   NEW_ADMIN_PASSWORD="StrongPass123" node scripts/reset-admin-password.js
 *   NEW_ADMIN_PASSWORD="StrongPass123" ADMIN_EMAIL="you@company.com" node scripts/reset-admin-password.js
 *
 * On Railway:  railway run -- node scripts/reset-admin-password.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../server/config/database');

async function main() {
  const email = process.env.ADMIN_EMAIL || 'admin@ph-erp.com';
  const newPassword = process.env.NEW_ADMIN_PASSWORD;

  if (!newPassword || newPassword.length < 8) {
    console.error('✖ Set NEW_ADMIN_PASSWORD (min 8 chars).');
    console.error('  Example: NEW_ADMIN_PASSWORD="StrongPass123" node scripts/reset-admin-password.js');
    process.exit(1);
  }

  const rows = await prisma.$queryRaw`SELECT id, email, role FROM users WHERE email = ${email} LIMIT 1`;
  if (!rows.length) {
    console.error(`✖ No user with email "${email}".`);
    const all = await prisma.$queryRaw`SELECT email, role FROM users`;
    console.error('  Existing users:', all.map((u) => `${u.email} (${u.role})`).join(', ') || '(none)');
    process.exit(1);
  }

  const hashed = await bcrypt.hash(newPassword, 12);

  // Core reset — only columns that exist on every schema version.
  await prisma.$executeRaw`UPDATE users SET password = ${hashed}, isActive = true WHERE email = ${email}`;

  // Best-effort: clear lockout columns if this DB has been migrated.
  try {
    await prisma.$executeRaw`UPDATE users SET failedLoginAttempts = 0, lockedUntil = NULL WHERE email = ${email}`;
  } catch (_) { /* columns not present on older schema — fine */ }

  console.log(`✅ Password reset for ${email} (role: ${rows[0].role}). You can now log in.`);
}

main()
  .catch((e) => { console.error('✖ Failed:', e.message); process.exit(1); })
  .finally(() => process.exit(0));
