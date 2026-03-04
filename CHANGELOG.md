# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-03-05

### Added

- `devstash claude` module — backup and restore Claude Code configuration, project memories, settings, reference docs, and plugin manifests
- Smart MEMORY.md merge: appends new `## Section` blocks from backup without overwriting existing sections
- Security blocklist in restore prevents credential/session files from being restored
- Drive letter change detection with user guidance on project memory path remapping
- API routes: `GET /api/claude/detect`, `POST /api/claude/backup`, `GET /api/claude/backups`, `POST /api/claude/backups/:name/restore`

## [0.2.0] - 2026-03-05

### Added

- Web GUI (`devstash gui`) with Dashboard, Backups, and Explorer views
- SQLite database (`vault/devstash.db`) for backup metadata persistence
- Crash-safe zip compression with `.tmp` write + adm-zip verification
- Vault explorer with zip-browsing support (navigate inside archives)
- File viewer for reading backup contents from GUI
- Aggregate stats endpoint (`/api/stats`)
- `start.bat` — one-click start with dependency install, build, port discovery, and live reload
- `stop.bat` — clean shutdown of server + watcher + temp file cleanup
- `pnpm dev` / `pnpm dev:gui` scripts for development with auto-rebuild and auto-restart

### Changed

- Backup listing now reads from DB instead of filesystem scanning
- Directory sizes use DB-stored `original_size` (O(1) lookup) instead of recursive stat

## [0.1.0] - 2026-03-05

### Added

- `devstash history detect` — auto-detect installed shells and their history files
- `devstash history backup` — backup shell histories (Bash, Zsh, Fish, PowerShell, Nushell, Git Bash)
- `devstash history restore` — restore histories with merge or overwrite mode
- `devstash history list` — list available backups
- Cross-platform support (Windows, macOS, Linux)
