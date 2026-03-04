import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { detectShells, type ShellInfo } from "./detect.js";

export interface BackupResult {
  shell: string;
  source: string;
  destination: string;
  lines: number;
  sizeBytes: number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function backupHistories(outputDir: string, shells?: string[]): BackupResult[] {
  const detected = detectShells().filter((s) => s.exists);
  const targets = shells?.length
    ? detected.filter((s) => shells.includes(s.name))
    : detected;

  if (targets.length === 0) {
    console.log("No shell histories found to backup.");
    return [];
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupDir = join(outputDir, `history-${timestamp}`);
  mkdirSync(backupDir, { recursive: true });

  const results: BackupResult[] = [];

  for (const shell of targets) {
    const dest = join(backupDir, `${shell.name}_history${getExtension(shell)}`);
    try {
      copyFileSync(shell.historyPath, dest);
      const stat = statSync(dest);
      const content = readFileSync(dest, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim()).length;

      results.push({
        shell: shell.name,
        source: shell.historyPath,
        destination: dest,
        lines,
        sizeBytes: stat.size,
      });

      console.log(
        `  [+] ${shell.name}: ${lines.toLocaleString()} commands (${formatSize(stat.size)})`
      );
    } catch (err) {
      console.error(`  [!] ${shell.name}: failed to backup — ${(err as Error).message}`);
    }
  }

  if (results.length > 0) {
    const totalLines = results.reduce((sum, r) => sum + r.lines, 0);
    const totalSize = results.reduce((sum, r) => sum + r.sizeBytes, 0);
    console.log(
      `\n  Backed up ${results.length} shell(s): ${totalLines.toLocaleString()} commands (${formatSize(totalSize)})`
    );
    console.log(`  Location: ${backupDir}`);
  }

  return results;
}

function getExtension(shell: ShellInfo): string {
  if (shell.name === "powershell") return ".txt";
  if (shell.name === "fish") return ".fish";
  return "";
}
