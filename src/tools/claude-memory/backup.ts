import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { detectClaudeMemory } from "./detect.js";

export interface ClaudeBackupItem {
  relativePath: string;
  category: "critical" | "nice-to-have" | "memory" | "reference";
  sizeBytes: number;
  status: "copied" | "skipped" | "error";
  error?: string;
}

export interface ClaudeBackupResult {
  backupDir: string;
  timestamp: string;
  filesCopied: number;
  filesSkipped: number;
  totalSizeBytes: number;
  items: ClaudeBackupItem[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function copyItem(
  src: string,
  dest: string,
  relPath: string,
  category: ClaudeBackupItem["category"],
  displayLabel: string,
  items: ClaudeBackupItem[]
): void {
  try {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    const size = statSync(dest).size;
    items.push({ relativePath: relPath, category, sizeBytes: size, status: "copied" });
    console.log(`  [+] ${displayLabel}: ${formatSize(size)}`);
  } catch (e) {
    items.push({ relativePath: relPath, category, sizeBytes: 0, status: "error", error: (e as Error).message });
    console.error(`  [!] ${displayLabel}: failed — ${(e as Error).message}`);
  }
}

export function backupClaudeMemory(outputDir: string): ClaudeBackupResult {
  const detected = detectClaudeMemory();

  if (!detected.claudeDirExists) {
    console.log("  [!] ~/.claude directory not found — nothing to backup.");
    return { backupDir: "", timestamp: "", filesCopied: 0, filesSkipped: 0, totalSizeBytes: 0, items: [] };
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupDir = join(outputDir, `claude-${timestamp}`);
  mkdirSync(backupDir, { recursive: true });

  const items: ClaudeBackupItem[] = [];

  // Critical + nice-to-have files
  for (const file of detected.files) {
    if (!file.exists) {
      items.push({ relativePath: file.relativePath, category: file.category, sizeBytes: 0, status: "skipped" });
      console.log(`  [-] ${file.label}: not found, skipping`);
      continue;
    }
    copyItem(file.absolutePath, join(backupDir, file.relativePath), file.relativePath, file.category, file.label, items);
  }

  // Project MEMORY.md files
  for (const mem of detected.projectMemories) {
    copyItem(mem.absolutePath, join(backupDir, mem.relativePath), mem.relativePath, "memory", `memory/${mem.slug}`, items);
  }

  // Reference files
  for (const ref of detected.referenceFiles) {
    copyItem(ref.absolutePath, join(backupDir, ref.relativePath), ref.relativePath, "reference", `reference/${ref.name}`, items);
  }

  const copied = items.filter((i) => i.status === "copied");
  const totalSize = copied.reduce((s, i) => s + i.sizeBytes, 0);

  console.log(
    `\n  Backed up ${copied.length} file(s) (${items.filter((i) => i.status === "skipped").length} skipped): ${formatSize(totalSize)}`
  );
  console.log(`  Location: ${backupDir}`);

  return {
    backupDir,
    timestamp,
    filesCopied: copied.length,
    filesSkipped: items.filter((i) => i.status === "skipped").length,
    totalSizeBytes: totalSize,
    items,
  };
}
