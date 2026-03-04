import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  appendFileSync,
  statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { detectShells } from "./detect.js";

export interface RestoreResult {
  shell: string;
  backupFile: string;
  targetPath: string;
  mode: "overwrite" | "merge";
  linesRestored: number;
}

const SHELL_FILE_MAP: Record<string, string> = {
  bash_history: "bash",
  zsh_history: "zsh",
  fish_history: "fish",
  "fish_history.fish": "fish",
  powershell_history: "powershell",
  "powershell_history.txt": "powershell",
  "git-bash_history": "bash",
  nushell_history: "nushell",
  "nushell_history.txt": "nushell",
};

function identifyShell(filename: string): string | null {
  if (SHELL_FILE_MAP[filename]) return SHELL_FILE_MAP[filename];

  for (const [pattern, shell] of Object.entries(SHELL_FILE_MAP)) {
    if (filename.includes(pattern.replace(/\.[^.]+$/, ""))) return shell;
  }
  return null;
}

export function restoreHistories(
  backupDir: string,
  mode: "overwrite" | "merge" = "merge"
): RestoreResult[] {
  if (!existsSync(backupDir)) {
    console.error(`Backup directory not found: ${backupDir}`);
    return [];
  }

  const files = readdirSync(backupDir);
  const shells = detectShells();
  const results: RestoreResult[] = [];

  for (const file of files) {
    const shellName = identifyShell(file);
    if (!shellName) {
      console.log(`  [?] Skipping unrecognized file: ${file}`);
      continue;
    }

    const shellInfo = shells.find((s) => s.name === shellName);
    if (!shellInfo) {
      console.log(`  [?] No target path known for ${shellName}, skipping ${file}`);
      continue;
    }

    const backupPath = join(backupDir, file);
    const targetPath = shellInfo.historyPath;

    try {
      mkdirSync(dirname(targetPath), { recursive: true });

      const backupContent = readFileSync(backupPath, "utf-8");
      const backupLines = backupContent.split("\n").filter((l) => l.trim());

      if (mode === "merge" && existsSync(targetPath)) {
        const existingContent = readFileSync(targetPath, "utf-8");
        const existingLines = new Set(existingContent.split("\n").map((l) => l.trim()));

        const newLines = backupLines.filter((l) => !existingLines.has(l.trim()));
        if (newLines.length > 0) {
          appendFileSync(targetPath, "\n" + newLines.join("\n") + "\n");
        }

        results.push({
          shell: shellName,
          backupFile: file,
          targetPath,
          mode: "merge",
          linesRestored: newLines.length,
        });

        console.log(
          `  [+] ${shellName}: merged ${newLines.length} new commands (${backupLines.length - newLines.length} duplicates skipped)`
        );
      } else {
        copyFileSync(backupPath, targetPath);
        results.push({
          shell: shellName,
          backupFile: file,
          targetPath,
          mode: "overwrite",
          linesRestored: backupLines.length,
        });

        console.log(`  [+] ${shellName}: restored ${backupLines.length} commands`);
      }
    } catch (err) {
      console.error(`  [!] ${shellName}: restore failed — ${(err as Error).message}`);
    }
  }

  if (results.length > 0) {
    const totalLines = results.reduce((sum, r) => sum + r.linesRestored, 0);
    console.log(`\n  Restored ${results.length} shell(s): ${totalLines.toLocaleString()} commands`);
  }

  return results;
}

export function listBackups(backupRoot: string): string[] {
  if (!existsSync(backupRoot)) return [];

  return readdirSync(backupRoot)
    .filter((d) => d.startsWith("history-"))
    .sort()
    .reverse();
}
