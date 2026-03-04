# devstash

Backup before you format. Restore after you install. Never lose your dev setup again.

## Why?

Formatting your laptop shouldn't mean losing years of shell history, custom configs, or workflow state. **devstash** preserves the invisible parts of your dev environment — the stuff that takes months to rebuild.

It's used exactly twice per format cycle: once to backup, once to restore.

## Quick Start

### Windows (one-click)

```
git clone https://github.com/divyamohan1993/devstash.git
cd devstash
start.bat
```

Double-click `start.bat` — it installs dependencies, builds, finds an open port, and opens the GUI in your browser. That's it.

To stop: close the window or run `stop.bat`.

### Manual

```bash
git clone https://github.com/divyamohan1993/devstash.git
cd devstash
pnpm install
pnpm build
node dist/cli.js gui
```

Opens at `http://localhost:51877` (auto-increments if occupied).

## Modules

### Shell History — `devstash history`

Detects and backs up command history from every shell on your system.

**Supported:** Bash, Zsh, Fish, PowerShell, Nushell, Git Bash

```bash
devstash history detect                    # See what shells you have
devstash history backup                    # Backup all shell histories
devstash history backup -s bash powershell # Backup specific shells
devstash history list                      # List available backups
devstash history restore <backup-dir>      # Restore (merge mode)
devstash history restore <backup-dir> -m overwrite  # Restore (overwrite)
```

### Claude Memory — `devstash claude`

Backs up Claude Code's configuration, learned project context, and reference docs.

**What it preserves:**
- `~/.claude/CLAUDE.md` (global instructions)
- `~/.claude/settings.json` (plugins, env vars, permissions)
- `~/.claude/projects/*/memory/MEMORY.md` (per-project learned context)
- `~/.claude/reference/*` (reference docs)
- Plugin manifests (installed list, blocklist, marketplaces)

**What it skips:** Credentials, session data, telemetry, cache — anything ephemeral or security-sensitive.

```bash
devstash claude detect                     # See what can be backed up
devstash claude backup                     # Backup Claude Code memory
devstash claude list                       # List available backups
devstash claude restore <backup-dir>       # Restore (merge — smart MEMORY.md merge)
devstash claude restore <backup-dir> -m overwrite  # Restore (full replace)
```

**Smart merge:** In merge mode, MEMORY.md files are merged by `## Section` heading — new sections from the backup are appended, existing sections are left untouched.

### GUI

The web GUI (`devstash gui`) provides:

- **Dashboard** — detected shells, total backups, commands saved, vault size
- **Backups** — create, compress, restore, delete backups with per-shell detail
- **Explorer** — browse vault contents including inside zip archives

All data persists in a local SQLite database (`vault/devstash.db`).

## How It Works

1. **Backup**: Copies shell history files into a timestamped directory in `vault/`
2. **Compress**: Optionally zips the backup (crash-safe: writes to `.tmp`, verifies, then renames)
3. **Restore**: Reads backup and writes history back to the correct shell paths (merge or overwrite)
4. **DB**: Tracks backup metadata (shells, file counts, sizes, compression stats) — no logging, no tracking, just the data you need

## Tech Stack

- Node.js + TypeScript (ESM)
- Commander.js (CLI)
- better-sqlite3 (local DB, WAL mode)
- tsup (bundler)
- Pure HTML/CSS/JS GUI (no frameworks, no CDN)

## Development

```bash
start.bat           # Full dev environment with live reload
# OR manually:
pnpm dev            # Watch mode — rebuilds on src/ changes
pnpm dev:gui        # Server with auto-restart on dist/ changes
```

`start.bat` runs both — edit TypeScript, it rebuilds and restarts. Edit HTML, refresh the browser.

## Roadmap

- [ ] SSH key backup/restore
- [ ] Git config preserver (`.gitconfig`, aliases, hooks)
- [ ] VS Code extensions snapshot
- [ ] Dotfiles manager (`.bashrc`, `.zshrc`, shell configs)
- [ ] Cron/scheduled tasks backup
- [ ] Package list snapshot (brew, apt, choco, winget, pnpm global)
- [ ] Browser bookmarks backup
- [ ] Cloud sync (encrypted backup to S3/R2/GCS)

## License

[MIT](LICENSE)
