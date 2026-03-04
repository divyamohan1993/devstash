import Database from "better-sqlite3";
import { join } from "node:path";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";

// --- Types ---

export interface DbBackup {
  id: number;
  name: string;
  type: "directory" | "zip";
  shells: string[];
  file_count: number;
  total_commands: number;
  original_size: number;
  compressed_size: number | null;
  compression_ratio: number | null;
  verified: boolean | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface DbActivity {
  id: number;
  action: string;
  target: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface DbShell {
  name: string;
  history_path: string;
  last_detected_at: string;
  total_backups: number;
  total_commands_backed_up: number;
}

export interface DbStats {
  total_backups: number;
  total_archives: number;
  total_commands: number;
  total_original_size: number;
  total_compressed_size: number;
  shells_tracked: number;
  last_backup_at: string | null;
}

// --- Schema ---

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS backups (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL UNIQUE,
  type            TEXT    NOT NULL DEFAULT 'directory',
  shells          TEXT,
  file_count      INTEGER NOT NULL DEFAULT 0,
  total_commands  INTEGER NOT NULL DEFAULT 0,
  original_size   INTEGER NOT NULL DEFAULT 0,
  compressed_size INTEGER,
  compression_ratio REAL,
  verified        INTEGER,
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      TEXT
);

CREATE TABLE IF NOT EXISTS activity (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT    NOT NULL,
  target     TEXT,
  details    TEXT,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS shells (
  name                     TEXT PRIMARY KEY,
  history_path             TEXT NOT NULL,
  last_detected_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  total_backups            INTEGER NOT NULL DEFAULT 0,
  total_commands_backed_up INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_backups_created  ON backups(created_at);
CREATE INDEX IF NOT EXISTS idx_backups_deleted   ON backups(deleted_at);
CREATE INDEX IF NOT EXISTS idx_activity_created  ON activity(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_action   ON activity(action);
`;

// --- Core ---

let _db: Database.Database | null = null;

export function getDb(vaultDir: string): Database.Database {
  if (_db) return _db;

  mkdirSync(vaultDir, { recursive: true });
  const dbPath = join(vaultDir, "devstash.db");

  try {
    _db = new Database(dbPath);
  } catch {
    if (existsSync(dbPath)) unlinkSync(dbPath);
    _db = new Database(dbPath);
  }

  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.exec(SCHEMA_SQL);

  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// --- Backups ---

export function insertBackup(
  db: Database.Database,
  data: {
    name: string;
    type: "directory" | "zip";
    shells: string[];
    file_count: number;
    total_commands: number;
    original_size: number;
  }
): void {
  db.prepare(`
    INSERT INTO backups (name, type, shells, file_count, total_commands, original_size)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(data.name, data.type, JSON.stringify(data.shells), data.file_count, data.total_commands, data.original_size);
}

export function updateBackupZip(
  db: Database.Database,
  name: string,
  data: { compressed_size: number; compression_ratio: number; verified: boolean }
): void {
  db.prepare(`
    UPDATE backups
    SET compressed_size = ?, compression_ratio = ?, verified = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE name = ? AND deleted_at IS NULL
  `).run(data.compressed_size, data.compression_ratio, data.verified ? 1 : 0, name);
}

export function softDeleteBackup(db: Database.Database, name: string): void {
  const baseName = name.replace(/\.zip$/, "");
  db.prepare(`
    UPDATE backups
    SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE (name = ? OR name = ?) AND deleted_at IS NULL
  `).run(baseName, name);
}

export function listBackupsFromDb(db: Database.Database): DbBackup[] {
  const rows = db.prepare(`
    SELECT * FROM backups WHERE deleted_at IS NULL ORDER BY created_at DESC
  `).all() as Record<string, unknown>[];
  return rows.map(deserializeBackup);
}

export function getBackup(db: Database.Database, name: string): DbBackup | null {
  const row = db.prepare(`
    SELECT * FROM backups WHERE name = ? AND deleted_at IS NULL
  `).get(name) as Record<string, unknown> | undefined;
  return row ? deserializeBackup(row) : null;
}

function deserializeBackup(row: Record<string, unknown>): DbBackup {
  return {
    id: row.id as number,
    name: row.name as string,
    type: row.type as "directory" | "zip",
    shells: row.shells ? JSON.parse(row.shells as string) : [],
    file_count: row.file_count as number,
    total_commands: row.total_commands as number,
    original_size: row.original_size as number,
    compressed_size: row.compressed_size as number | null,
    compression_ratio: row.compression_ratio as number | null,
    verified: row.verified != null ? Boolean(row.verified) : null,
    notes: row.notes as string | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    deleted_at: row.deleted_at as string | null,
  };
}

// --- Activity ---

export function logActivity(
  db: Database.Database,
  action: string,
  target: string | null,
  details?: Record<string, unknown>
): void {
  db.prepare(`
    INSERT INTO activity (action, target, details) VALUES (?, ?, ?)
  `).run(action, target, details ? JSON.stringify(details) : null);
}

export function getRecentActivity(db: Database.Database, limit = 15): DbActivity[] {
  const clamped = Math.min(Math.max(limit, 1), 100);
  const rows = db.prepare(`
    SELECT * FROM activity ORDER BY created_at DESC LIMIT ?
  `).all(clamped) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as number,
    action: row.action as string,
    target: row.target as string | null,
    details: row.details ? JSON.parse(row.details as string) : null,
    created_at: row.created_at as string,
  }));
}

// --- Shells ---

export function upsertShell(
  db: Database.Database,
  name: string,
  historyPath: string,
  commandsBacked: number
): void {
  db.prepare(`
    INSERT INTO shells (name, history_path, total_backups, total_commands_backed_up)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(name) DO UPDATE SET
      history_path = excluded.history_path,
      last_detected_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      total_backups = total_backups + 1,
      total_commands_backed_up = total_commands_backed_up + excluded.total_commands_backed_up
  `).run(name, historyPath, commandsBacked);
}

export function getAllShells(db: Database.Database): DbShell[] {
  return db.prepare(`SELECT * FROM shells ORDER BY name`).all() as DbShell[];
}

// --- Settings ---

export function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).run(key, value);
}

// --- Aggregate Stats ---

export function getStats(db: Database.Database): DbStats {
  const backupStats = db.prepare(`
    SELECT
      COUNT(*) AS total_backups,
      SUM(CASE WHEN compressed_size IS NOT NULL THEN 1 ELSE 0 END) AS total_archives,
      COALESCE(SUM(total_commands), 0) AS total_commands,
      COALESCE(SUM(original_size), 0) AS total_original_size,
      COALESCE(SUM(compressed_size), 0) AS total_compressed_size,
      MAX(created_at) AS last_backup_at
    FROM backups WHERE deleted_at IS NULL
  `).get() as Record<string, unknown>;

  const shellCount = db.prepare(`SELECT COUNT(*) AS count FROM shells`).get() as { count: number };

  return {
    total_backups: (backupStats.total_backups as number) || 0,
    total_archives: (backupStats.total_archives as number) || 0,
    total_commands: (backupStats.total_commands as number) || 0,
    total_original_size: (backupStats.total_original_size as number) || 0,
    total_compressed_size: (backupStats.total_compressed_size as number) || 0,
    shells_tracked: shellCount.count || 0,
    last_backup_at: (backupStats.last_backup_at as string) || null,
  };
}
