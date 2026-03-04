#!/usr/bin/env node

import { Command } from "commander";
import { resolve } from "node:path";
import { detectShells, backupHistories, restoreHistories, listBackups } from "./tools/shell-history/index.js";
import { detectClaudeMemory, backupClaudeMemory, restoreClaudeMemory, listClaudeBackups } from "./tools/claude-memory/index.js";
import { startServer } from "./server.js";

const DEFAULT_VAULT_DIR = resolve("vault");

const program = new Command();

program
  .name("devstash")
  .description("Developer productivity toolkit — backup, restore, and automate your dev workflow.")
  .version("0.1.0");

// --- GUI ---
program
  .command("gui")
  .description("Launch the web-based GUI")
  .option("-p, --port <port>", "Port number (IANA private range)", "51877")
  .option("-v, --vault <dir>", "Vault directory for backups", DEFAULT_VAULT_DIR)
  .action((opts) => {
    startServer(parseInt(opts.port, 10), resolve(opts.vault));
  });

// --- Shell History ---
const history = program
  .command("history")
  .description("Backup and restore shell command histories");

history
  .command("detect")
  .description("Detect installed shells and their history files")
  .action(() => {
    console.log("\n  Scanning for shell histories...\n");
    const shells = detectShells();
    const found = shells.filter((s) => s.exists);
    const missing = shells.filter((s) => !s.exists);

    if (found.length > 0) {
      console.log("  Found:");
      for (const s of found) {
        console.log(`    [+] ${s.name.padEnd(12)} ${s.historyPath}`);
      }
    }

    if (missing.length > 0) {
      console.log("\n  Not found:");
      for (const s of missing) {
        console.log(`    [-] ${s.name.padEnd(12)} ${s.historyPath}`);
      }
    }

    console.log(`\n  Total: ${found.length} shell(s) with history\n`);
  });

history
  .command("backup")
  .description("Backup all detected shell histories")
  .option("-o, --output <dir>", "Output directory", DEFAULT_VAULT_DIR)
  .option("-s, --shells <shells...>", "Specific shells to backup (e.g., bash powershell)")
  .action((opts) => {
    console.log("\n  Backing up shell histories...\n");
    backupHistories(resolve(opts.output), opts.shells);
    console.log();
  });

history
  .command("restore")
  .description("Restore shell histories from a backup")
  .argument("<backup-dir>", "Path to a backup directory (e.g., backups/history-2024-01-15T10-30-00)")
  .option("-m, --mode <mode>", "Restore mode: merge (default) or overwrite", "merge")
  .action((backupDir: string, opts) => {
    const mode = opts.mode === "overwrite" ? "overwrite" : "merge";
    console.log(`\n  Restoring shell histories (${mode} mode)...\n`);
    restoreHistories(resolve(backupDir), mode);
    console.log();
  });

history
  .command("list")
  .description("List available backups")
  .option("-d, --dir <dir>", "Backup directory", DEFAULT_VAULT_DIR)
  .action((opts) => {
    const backups = listBackups(resolve(opts.dir));
    if (backups.length === 0) {
      console.log("\n  No backups found.\n");
      return;
    }
    console.log(`\n  Found ${backups.length} backup(s):\n`);
    for (const b of backups) {
      console.log(`    ${b}`);
    }
    console.log();
  });

// --- Claude Memory ---
const claude = program
  .command("claude")
  .description("Backup and restore Claude Code configuration, memory, and project context");

claude
  .command("detect")
  .description("Detect Claude Code installation and what can be backed up")
  .action(() => {
    console.log("\n  Scanning Claude Code configuration...\n");
    const result = detectClaudeMemory();

    if (!result.claudeDirExists) {
      console.log(`  [!] ~/.claude not found at: ${result.claudeDir}\n`);
      return;
    }

    console.log(`  Claude dir: ${result.claudeDir}\n`);

    const critical = result.files.filter((f) => f.category === "critical");
    const niceToHave = result.files.filter((f) => f.category === "nice-to-have");

    console.log("  Critical files:");
    for (const f of critical) {
      const mark = f.exists ? "[+]" : "[-]";
      const size = f.exists ? ` (${f.sizeBytes} B)` : " (missing)";
      console.log(`    ${mark} ${f.label.padEnd(20)} ${f.relativePath}${size}`);
    }

    console.log("\n  Project memories:");
    if (result.projectMemories.length === 0) {
      console.log("    [-] None found");
    } else {
      for (const m of result.projectMemories) {
        console.log(`    [+] ${m.slug.padEnd(40)} ${m.sizeBytes} B`);
      }
    }

    console.log("\n  Reference docs:");
    if (result.referenceFiles.length === 0) {
      console.log("    [-] None found");
    } else {
      for (const r of result.referenceFiles) {
        console.log(`    [+] ${r.name.padEnd(40)} ${r.sizeBytes} B`);
      }
    }

    console.log("\n  Nice-to-have (plugins):");
    for (const f of niceToHave) {
      const mark = f.exists ? "[+]" : "[-]";
      console.log(`    ${mark} ${f.label}`);
    }

    const totalFiles =
      result.files.filter((f) => f.exists).length +
      result.projectMemories.length +
      result.referenceFiles.length;

    console.log(`\n  Total: ${totalFiles} file(s) ready to backup\n`);
  });

claude
  .command("backup")
  .description("Backup Claude Code configuration, memories, and reference docs")
  .option("-o, --output <dir>", "Output directory", DEFAULT_VAULT_DIR)
  .action((opts) => {
    console.log("\n  Backing up Claude Code memory...\n");
    backupClaudeMemory(resolve(opts.output));
    console.log();
  });

claude
  .command("restore")
  .description("Restore Claude Code configuration from a backup")
  .argument("<backup-dir>", "Path to a backup directory (e.g., vault/claude-2025-01-15T10-30-00)")
  .option("-m, --mode <mode>", "Restore mode: merge (default) or overwrite", "merge")
  .action((backupDir: string, opts) => {
    const mode = opts.mode === "overwrite" ? "overwrite" : "merge";
    console.log(`\n  Restoring Claude Code memory (${mode} mode)...\n`);
    restoreClaudeMemory(resolve(backupDir), mode);
    console.log();
  });

claude
  .command("list")
  .description("List available Claude memory backups")
  .option("-d, --dir <dir>", "Backup directory", DEFAULT_VAULT_DIR)
  .action((opts) => {
    const backups = listClaudeBackups(resolve(opts.dir));
    if (backups.length === 0) {
      console.log("\n  No Claude memory backups found.\n");
      return;
    }
    console.log(`\n  Found ${backups.length} backup(s):\n`);
    for (const b of backups) {
      console.log(`    ${b}`);
    }
    console.log();
  });

program.parse();
