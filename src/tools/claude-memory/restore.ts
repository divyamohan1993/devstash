import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  appendFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { getClaudeDir } from "./detect.js";

export interface ClaudeRestoreResult {
  relativePath: string;
  mode: "copied" | "merged" | "skipped" | "error";
  detail?: string;
}

function collectFiles(dir: string, base = ""): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isFile()) result.push(rel);
    else if (entry.isDirectory()) result.push(...collectFiles(join(dir, entry.name), rel));
  }
  return result;
}

/**
 * Merge MEMORY.md: append ## sections from backup that don't exist in current file.
 * Returns number of new sections appended.
 */
function mergeMemoryMd(destPath: string, backupContent: string): number {
  const current = existsSync(destPath) ? readFileSync(destPath, "utf-8") : "";

  const parts = backupContent.split(/(?=^## )/m);
  const toAppend: string[] = [];

  for (const part of parts) {
    const match = part.match(/^## (.+)/m);
    if (!match) continue;
    const heading = match[1].trim();
    if (!current.includes(`## ${heading}`)) {
      toAppend.push(part.trimEnd());
    }
  }

  if (toAppend.length > 0) {
    if (!existsSync(destPath)) {
      mkdirSync(dirname(destPath), { recursive: true });
      appendFileSync(destPath, toAppend.join("\n\n") + "\n");
    } else {
      const sep = current.endsWith("\n") ? "\n" : "\n\n";
      appendFileSync(destPath, sep + toAppend.join("\n\n") + "\n");
    }
  }

  return toAppend.length;
}

// Security: never restore these even if they end up in a backup
const BLOCKED = [
  /\.credentials\.json$/,
  /security_warnings_state_/,
  /stats-cache\.json$/,
  /mcp-needs-auth-cache\.json$/,
];

export function restoreClaudeMemory(
  backupDir: string,
  mode: "merge" | "overwrite" = "merge"
): ClaudeRestoreResult[] {
  if (!existsSync(backupDir)) {
    console.error(`  [!] Backup directory not found: ${backupDir}`);
    return [];
  }

  const claudeDir = getClaudeDir();
  mkdirSync(claudeDir, { recursive: true });

  const allFiles = collectFiles(backupDir);
  const results: ClaudeRestoreResult[] = [];

  for (const relPath of allFiles) {
    const normalized = relPath.replace(/\\/g, "/");

    if (BLOCKED.some((p) => p.test(normalized))) {
      console.log(`  [!] Security skip: ${normalized}`);
      results.push({ relativePath: normalized, mode: "skipped", detail: "blocked — security-sensitive" });
      continue;
    }

    const src = join(backupDir, relPath);
    const dest = join(claudeDir, relPath);

    try {
      const isMemory = normalized.includes("/memory/MEMORY.md");

      if (isMemory && mode === "merge") {
        const content = readFileSync(src, "utf-8");
        const newSections = mergeMemoryMd(dest, content);
        if (newSections > 0) {
          console.log(`  [+] ${normalized}: merged ${newSections} new section(s)`);
          results.push({ relativePath: normalized, mode: "merged", detail: `${newSections} section(s) appended` });
        } else {
          console.log(`  [-] ${normalized}: already up to date`);
          results.push({ relativePath: normalized, mode: "skipped", detail: "all sections present" });
        }
      } else if (mode === "merge" && existsSync(dest)) {
        console.log(`  [-] ${normalized}: exists, skipping (use --mode overwrite to replace)`);
        results.push({ relativePath: normalized, mode: "skipped", detail: "already exists" });
      } else {
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(src, dest);
        console.log(`  [+] ${normalized}: restored (${statSync(dest).size} B)`);
        results.push({ relativePath: normalized, mode: "copied" });
      }
    } catch (e) {
      console.error(`  [!] ${normalized}: failed — ${(e as Error).message}`);
      results.push({ relativePath: normalized, mode: "error", detail: (e as Error).message });
    }
  }

  const copied = results.filter((r) => r.mode === "copied").length;
  const merged = results.filter((r) => r.mode === "merged").length;
  const skipped = results.filter((r) => r.mode === "skipped").length;

  console.log(`\n  Restore complete: ${copied} copied, ${merged} merged, ${skipped} skipped`);
  console.log(`  Target: ${claudeDir}`);

  if (results.some((r) => r.relativePath.includes("projects/"))) {
    console.log(`\n  Note: Project memory paths encode workspace paths (e.g., r--devstash = R:\\devstash).`);
    console.log(`  If drive letters changed on this machine, rename project directories manually.`);
  }

  return results;
}

export function listClaudeBackups(backupRoot: string): string[] {
  if (!existsSync(backupRoot)) return [];
  return readdirSync(backupRoot)
    .filter((d) => d.startsWith("claude-"))
    .sort()
    .reverse();
}
