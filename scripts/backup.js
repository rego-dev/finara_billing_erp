#!/usr/bin/env node
/**
 * scripts/backup.js — Database backup utility.
 *
 * Creates a timestamped .sql dump in ./backups using mysqldump, parsing
 * connection details from DATABASE_URL. Retains the most recent N backups
 * (default 14; override with BACKUP_RETENTION).
 *
 * Usage:  npm run db:backup
 *
 * Requires mysqldump on PATH, or set MYSQLDUMP_PATH to its full location, e.g.
 *   MYSQLDUMP_PATH="C:/Program Files/MySQL/MySQL Server 9.4/bin/mysqldump.exe"
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const RETENTION = Number(process.env.BACKUP_RETENTION || 14);

function parseDatabaseUrl(url) {
  // mysql://user:pass@host:port/dbname
  const m = url.match(/^mysql:\/\/([^:]+):([^@]*)@([^:/]+):?(\d+)?\/([^?]+)/);
  if (!m) throw new Error('Could not parse DATABASE_URL');
  return { user: m[1], password: decodeURIComponent(m[2] || ''), host: m[3], port: m[4] || '3306', database: m[5] };
}

function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  const cfg = parseDatabaseUrl(process.env.DATABASE_URL);
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outFile = path.join(BACKUP_DIR, `${cfg.database}_${stamp}.sql`);
  const mysqldump = process.env.MYSQLDUMP_PATH || 'mysqldump';

  const args = [
    `-h${cfg.host}`, `-P${cfg.port}`, `-u${cfg.user}`,
    '--single-transaction', '--quick', '--routines', '--triggers',
    cfg.database,
  ];

  console.log(`Backing up "${cfg.database}" -> ${path.relative(process.cwd(), outFile)}`);
  const out = fs.openSync(outFile, 'w');
  const res = spawnSync(mysqldump, args, {
    env: { ...process.env, MYSQL_PWD: cfg.password }, // avoids password on the command line
    stdio: ['ignore', out, 'inherit'],
  });
  fs.closeSync(out);

  if (res.error || res.status !== 0) {
    console.error(`Backup failed: ${res.error?.message || `mysqldump exited ${res.status}`}`);
    try { fs.unlinkSync(outFile); } catch (_) {}
    console.error('Tip: ensure mysqldump is installed, or set MYSQLDUMP_PATH.');
    process.exit(1);
  }

  const sizeKB = (fs.statSync(outFile).size / 1024).toFixed(0);
  console.log(`✅ Backup complete (${sizeKB} KB)`);

  // Retention: keep newest RETENTION dumps
  const dumps = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const old of dumps.slice(RETENTION)) {
    fs.unlinkSync(path.join(BACKUP_DIR, old.f));
    console.log(`Pruned old backup: ${old.f}`);
  }
}

main();
