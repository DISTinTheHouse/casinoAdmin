// SQLite integrado en Node (sin dependencias). Dinero siempre en centavos enteros.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { sha256 } from './engine.js';

const DB_PATH = process.env.BJ_DB || fileURLToPath(new URL('./blackjack.db', import.meta.url));
export const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nights (id INTEGER PRIMARY KEY, opened_at TEXT NOT NULL, closed_at TEXT);
CREATE TABLE IF NOT EXISTS cards (uid TEXT PRIMARY KEY, name TEXT, balance INTEGER NOT NULL DEFAULT 0,
  machine_id INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS machines (id INTEGER PRIMARY KEY, name TEXT NOT NULL, token TEXT UNIQUE NOT NULL,
  card_uid TEXT, last_seen TEXT);
CREATE TABLE IF NOT EXISTS rounds (id INTEGER PRIMARY KEY, night_id INTEGER NOT NULL, machine_id INTEGER NOT NULL,
  card_uid TEXT NOT NULL, bet INTEGER NOT NULL, payout INTEGER, state TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT);
CREATE TABLE IF NOT EXISTS cash (id INTEGER PRIMARY KEY, night_id INTEGER NOT NULL, card_uid TEXT NOT NULL,
  kind TEXT NOT NULL, amount INTEGER NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY, at TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL,
  prev TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS shifts (id INTEGER PRIMARY KEY, cashier TEXT NOT NULL, opened_at TEXT NOT NULL, closed_at TEXT);
CREATE INDEX IF NOT EXISTS rounds_night ON rounds(night_id);
CREATE INDEX IF NOT EXISTS rounds_card ON rounds(card_uid);
CREATE INDEX IF NOT EXISTS cash_night ON cash(night_id);
`);

// Columnas agregadas después de la primera versión (bases ya creadas).
for (const sql of ['ALTER TABLE cash ADD COLUMN shift_id INTEGER', 'ALTER TABLE cash ADD COLUMN ref INTEGER']) {
  try { db.exec(sql); } catch { /* ya existe */ }
}
db.exec('CREATE INDEX IF NOT EXISTS cash_card ON cash(card_uid); CREATE INDEX IF NOT EXISTS cash_shift ON cash(shift_id)');

export const now = () => new Date().toISOString();
export const one = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Bitácora encadenada: cada evento incluye el hash del anterior; alterar uno rompe la cadena.
export function log(type, data) {
  const prev = one('SELECT hash FROM log ORDER BY id DESC LIMIT 1')?.hash || '0'.repeat(64);
  const at = now(), json = JSON.stringify(data);
  run('INSERT INTO log (at, type, data, prev, hash) VALUES (?, ?, ?, ?, ?)', at, type, json, prev, sha256(prev + at + type + json));
}

export function verifyLog() {
  let prev = '0'.repeat(64), n = 0;
  for (const e of db.prepare('SELECT * FROM log ORDER BY id').iterate()) {
    if (e.prev !== prev || e.hash !== sha256(prev + e.at + e.type + e.data)) return { ok: false, brokenAt: e.id, checked: n };
    prev = e.hash; n++;
  }
  return { ok: true, checked: n };
}

export function getSetting(key, fallback) {
  const r = one('SELECT value FROM settings WHERE key = ?', key);
  return r ? JSON.parse(r.value) : fallback;
}
export const setSetting = (key, v) =>
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(v));

export function currentNight() {
  return one('SELECT * FROM nights WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1')
    || one('SELECT * FROM nights WHERE id = ?', run('INSERT INTO nights (opened_at) VALUES (?)', now()).lastInsertRowid);
}

// Respaldo: una copia por día en la carpeta respaldos/ junto a la base; se guardan las últimas 30.
export const BACKUP_DIR = process.env.BJ_BACKUPS || join(dirname(DB_PATH), 'respaldos');
export function backup(force = false) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, force ? 19 : 10).replace(/:/g, '-');
  const file = join(BACKUP_DIR, `blackjack-${stamp}.db`);
  if (existsSync(file)) return null;
  db.prepare('VACUUM INTO ?').run(file);
  const files = readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 30))) rmSync(join(BACKUP_DIR, f));
  return file;
}
