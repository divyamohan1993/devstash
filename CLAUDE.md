# devstash — Project Context

## What This Is

A developer productivity toolkit for preserving important laptop data across OS formats. You backup before formatting, restore after formatting. That's it.

**This tool is used exactly twice per format cycle** — once to backup, once to restore. It is not a continuously running service, not an enterprise application, not a monitoring tool.

## Modules

Each module handles one category of "important things" to preserve:

| Module | Status | What it preserves |
|--------|--------|-------------------|
| Shell History | Done | PowerShell, Bash, Zsh, Fish, Nushell, Git Bash command histories |
| Claude Memory | Done | Claude Code config, project memories, settings, reference docs, plugin list |
| *(more planned)* | — | Other developer artifacts worth preserving across formats |

## Architecture

- **CLI**: `node dist/cli.js` (Commander.js) — headless backup/restore/detect
- **GUI**: `node dist/cli.js gui` — pure HTML/CSS/JS web UI at `http://localhost:51877`
- **DB**: `vault/devstash.db` (better-sqlite3, WAL mode, self-healing)
- **Vault**: `vault/` directory holds all backup data + DB
- **Bundler**: tsup (ESM, `--external better-sqlite3`)

## Design Rules

### DB is minimal
- 2 tables only: `backups` and `settings`
- Writes happen only on user-initiated mutations: 1 per backup, 1 per zip, 1 per delete
- No activity logging, no shell tracking, no counters, no caching layers
- `getStats()` uses a simple aggregation query — sub-ms on <1000 rows, no cache needed
- This is a local tool with ~100 rows max. Do not add enterprise patterns.

### GUI is self-contained
- Single `public/index.html` — pure HTML/CSS/JS, no external CDN, no frameworks
- No `innerHTML` — all DOM via `h()` helper (XSS-safe)
- HTML served from disk per request (live reload during dev)

### Keep it simple
- No over-engineering. No premature abstractions. No features "for later."
- Every DB write must justify its existence. If you can compute it on the fly in <1ms, don't store it.
- Complexity budget: if a module adds more than 3 DB tables, it's too complex.

### Zipping is crash-safe
- Archiver writes to `.tmp` file first
- adm-zip verifies the archive integrity
- Only then renamed to `.zip`
- Original directory removed after verified zip

## Dev Workflow

### One-click start (Windows)
`start.bat` handles everything: dependency install, build, port discovery, live reload.

### Live reload
- `tsup --watch` auto-rebuilds on `src/` changes
- `node --watch-path=dist` auto-restarts server on `dist/` changes
- HTML reads from disk per request — edit `public/index.html`, refresh browser

### Port range
IANA private range 51877–51927, auto-increments if occupied.

## File Map

```
src/
  cli.ts              — Commander.js CLI entry point
  server.ts           — HTTP server, all API routes
  db.ts               — SQLite schema + CRUD (2 tables)
  tools/
    zipper.ts         — Crash-safe zip + verify
    shell-history/
      detect.ts       — Auto-detect installed shells
      backup.ts       — Copy history files to vault
      restore.ts      — Restore histories (merge/overwrite)
      index.ts        — Re-exports
    claude-memory/
      detect.ts       — Find ~/.claude/, enumerate backupable files
      backup.ts       — Copy config/memories/refs to vault
      restore.ts      — Restore with smart MEMORY.md merge
      index.ts        — Re-exports
public/
  index.html          — Single-file GUI (HTML + CSS + JS)
start.bat             — One-click start with live reload
stop.bat              — Kill server + watcher + clean temps
```

## API Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Serve GUI |
| GET | `/api/shells` | Detect installed shells |
| POST | `/api/backup` | Create backup |
| GET | `/api/backups` | List backups (from DB) |
| POST | `/api/backups/:name/zip` | Compress backup |
| POST | `/api/backups/:name/restore` | Restore from backup |
| DELETE | `/api/backups/:name` | Soft-delete backup |
| GET | `/api/explore` | Browse vault contents |
| GET | `/api/file` | Read file content |
| GET | `/api/stats` | Aggregate stats |
| GET | `/api/claude/detect` | Enumerate Claude Code files |
| POST | `/api/claude/backup` | Backup Claude memory + DB record |
| GET | `/api/claude/backups` | List claude backups |
| POST | `/api/claude/backups/:name/restore` | Restore from claude backup |
