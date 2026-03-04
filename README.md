# devstash

Developer productivity toolkit — backup, restore, and automate your dev workflow. Never lose your setup again.

## Why?

Formatting your laptop shouldn't mean losing years of shell history, custom configs, or workflow state. **devstash** is a growing collection of tools that preserve the invisible parts of your dev environment — the stuff that takes months to rebuild.

## Tools

### `devstash history` — Shell History Backup & Restore

Automatically detects and backs up command history from every shell on your system.

**Supported shells:** Bash, Zsh, Fish, PowerShell, Nushell, Git Bash

```bash
# See what shells you have
devstash history detect

# Backup all shell histories
devstash history backup

# Backup to a specific directory
devstash history backup -o ~/my-backups

# Backup only specific shells
devstash history backup -s bash powershell

# List available backups
devstash history list

# Restore (merge mode — adds new commands, skips duplicates)
devstash history restore backups/history-2024-01-15T10-30-00

# Restore (overwrite mode — replaces current history)
devstash history restore backups/history-2024-01-15T10-30-00 -m overwrite
```

## Installation

```bash
# Clone and build
git clone https://github.com/divyamohan1993/devstash.git
cd devstash
pnpm install
pnpm build

# Run directly
node dist/cli.js history detect

# Or link globally
pnpm link --global
devstash history detect
```

## Roadmap

- [ ] **SSH key backup/restore** — safely export and import SSH keys
- [ ] **Git config preserver** — backup `.gitconfig`, aliases, hooks
- [ ] **VS Code extensions snapshot** — export/import extension lists
- [ ] **Dotfiles manager** — sync shell configs, aliases, `.bashrc`, `.zshrc`
- [ ] **Cron/scheduled tasks backup** — preserve crontab, Windows Task Scheduler jobs
- [ ] **Package list snapshot** — export installed packages (brew, apt, choco, winget, pnpm global)
- [ ] **Browser bookmarks backup** — export bookmarks from Chrome, Firefox, Edge
- [ ] **Clipboard history export** — save clipboard manager history
- [ ] **Cloud sync** — encrypted backup to S3/R2/GCS

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
