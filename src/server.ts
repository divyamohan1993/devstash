import http from "node:http";
import {
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { detectShells } from "./tools/shell-history/detect.js";
import { backupHistories } from "./tools/shell-history/backup.js";
import { restoreHistories } from "./tools/shell-history/restore.js";
import { detectClaudeMemory } from "./tools/claude-memory/detect.js";
import { backupClaudeMemory } from "./tools/claude-memory/backup.js";
import { restoreClaudeMemory, listClaudeBackups } from "./tools/claude-memory/restore.js";
import { zipAndVerify } from "./tools/zipper.js";
import {
  getDb,
  closeDb,
  insertBackup,
  updateBackupZip,
  softDeleteBackup,
  getBackup,
  listBackupsFromDb,
  getStats,
} from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function json(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function err(res: http.ServerResponse, msg: string, status = 500) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: msg }));
}

async function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function isWithinVault(target: string, vaultDir: string): boolean {
  const resolved = resolve(target);
  return resolved.startsWith(resolve(vaultDir));
}


export function startServer(port: number, vaultDir: string) {
  mkdirSync(vaultDir, { recursive: true });

  const db = getDb(vaultDir);

  const shutdown = () => {
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const htmlPath = join(__dirname, "..", "public", "index.html");
  if (!existsSync(htmlPath)) {
    console.error(`GUI file not found: ${htmlPath}`);
    process.exit(1);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:${port}`);
    const path = url.pathname;
    const method = req.method!;

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");

    try {
      // --- GUI (live reload — reads from disk on every request) ---
      if (method === "GET" && path === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(readFileSync(htmlPath, "utf-8"));
        return;
      }

      // --- API: Detect shells ---
      if (method === "GET" && path === "/api/shells") {
        json(res, detectShells());
        return;
      }

      // --- API: Backup ---
      if (method === "POST" && path === "/api/backup") {
        const body = await parseBody(req);
        const shells = Array.isArray(body.shells) ? (body.shells as string[]) : undefined;
        const results = backupHistories(vaultDir, shells);

        if (results.length > 0) {
          // Extract backup dir name from the first result's destination path
          const destParts = results[0].destination.replace(/\\/g, "/").split("/");
          const vaultIdx = destParts.findIndex((p) => p === "vault");
          const backupDirName = vaultIdx >= 0 ? destParts[vaultIdx + 1] : destParts[destParts.length - 2];

          const totalCommands = results.reduce((s, r) => s + r.lines, 0);
          const totalSize = results.reduce((s, r) => s + r.sizeBytes, 0);
          const shellNames = results.map((r) => r.shell);

          insertBackup(db, {
            name: backupDirName,
            type: "directory",
            shells: shellNames,
            file_count: results.length,
            total_commands: totalCommands,
            original_size: totalSize,
          });
        }

        json(res, { results, vaultDir });
        return;
      }

      // --- API: List backups (O(n) on backup count — unavoidable for listing) ---
      if (method === "GET" && path === "/api/backups") {
        const dbBackups = listBackupsFromDb(db);
        const entries = dbBackups.map((b) => ({
          name: b.compressed_size != null ? b.name + ".zip" : b.name,
          path: join(vaultDir, b.compressed_size != null ? b.name + ".zip" : b.name),
          type: b.compressed_size != null ? "zip" : "directory",
          size: b.compressed_size ?? b.original_size,
          files: b.file_count,
          modified: b.updated_at,
          hasZip: b.compressed_size != null,
          shells: b.shells,
          total_commands: b.total_commands,
          compression_ratio: b.compression_ratio,
          verified: b.verified,
        }));
        json(res, entries);
        return;
      }

      // --- API: Zip a backup ---
      if (method === "POST" && /^\/api\/backups\/([^/]+)\/zip$/.test(path)) {
        const backupName = decodeURIComponent(path.split("/")[3]);
        const backupDir = join(vaultDir, backupName);

        if (!isWithinVault(backupDir, vaultDir)) {
          err(res, "Access denied", 403);
          return;
        }
        if (!existsSync(backupDir) || !statSync(backupDir).isDirectory()) {
          err(res, "Backup directory not found", 404);
          return;
        }

        const result = await zipAndVerify(backupDir);

        updateBackupZip(db, backupName, {
          compressed_size: result.compressedSize,
          compression_ratio: result.compressionRatio,
          verified: result.verified,
        });
        json(res, result);
        return;
      }

      // --- API: Restore from backup ---
      if (method === "POST" && /^\/api\/backups\/([^/]+)\/restore$/.test(path)) {
        const backupName = decodeURIComponent(path.split("/")[3]);
        const backupDir = join(vaultDir, backupName);

        if (!isWithinVault(backupDir, vaultDir)) {
          err(res, "Access denied", 403);
          return;
        }
        if (!existsSync(backupDir)) {
          err(res, "Backup not found", 404);
          return;
        }

        const body = await parseBody(req);
        const mode = body.mode === "overwrite" ? "overwrite" : "merge";

        let restoreDir = backupDir;
        let tmpExtracted = false;

        // If it's a zip, extract first
        if (backupName.endsWith(".zip")) {
          const admZip = new AdmZip(backupDir);
          restoreDir = join(vaultDir, `_restore-tmp-${Date.now()}`);
          admZip.extractAllTo(restoreDir, true);
          tmpExtracted = true;

          // Find the actual content dir inside extraction
          const inner = readdirSync(restoreDir);
          if (inner.length === 1 && statSync(join(restoreDir, inner[0])).isDirectory()) {
            restoreDir = join(restoreDir, inner[0]);
          }
        }

        const results = restoreHistories(restoreDir, mode);

        if (tmpExtracted) {
          const parent = restoreDir.includes("_restore-tmp-")
            ? restoreDir
            : dirname(restoreDir);
          try {
            rmSync(
              parent.includes("_restore-tmp-") ? parent : join(vaultDir, `_restore-tmp-${Date.now()}`),
              { recursive: true, force: true }
            );
          } catch {
            // Best-effort cleanup
          }
        }

        json(res, results);
        return;
      }

      // --- API: Delete backup ---
      if (method === "DELETE" && /^\/api\/backups\/([^/]+)$/.test(path)) {
        const backupName = decodeURIComponent(path.split("/")[3]);
        const backupPath = join(vaultDir, backupName);

        if (!isWithinVault(backupPath, vaultDir)) {
          err(res, "Access denied", 403);
          return;
        }
        if (!existsSync(backupPath)) {
          err(res, "Not found", 404);
          return;
        }

        rmSync(backupPath, { recursive: true, force: true });
        softDeleteBackup(db, backupName);
        json(res, { deleted: backupName });
        return;
      }

      // --- API: Explore directory ---
      if (method === "GET" && path === "/api/explore") {
        const reqPath = url.searchParams.get("path") || "";
        const targetPath = reqPath ? join(vaultDir, reqPath) : vaultDir;

        if (!isWithinVault(targetPath, vaultDir)) {
          err(res, "Access denied", 403);
          return;
        }
        if (!existsSync(targetPath)) {
          err(res, "Path not found", 404);
          return;
        }

        // Handle zip file exploration
        if (targetPath.includes(".zip")) {
          const zipSegment = targetPath.substring(0, targetPath.indexOf(".zip") + 4);
          const innerPath = targetPath.substring(zipSegment.length + 1);

          if (!existsSync(zipSegment)) {
            err(res, "Zip not found", 404);
            return;
          }

          const admZip = new AdmZip(zipSegment);
          const entries = admZip.getEntries();

          if (!innerPath) {
            // List zip root
            const seen = new Set<string>();
            const items: unknown[] = [];
            for (const entry of entries) {
              const parts = entry.entryName.split("/").filter(Boolean);
              const topLevel = parts[0];
              if (!seen.has(topLevel)) {
                seen.add(topLevel);
                items.push({
                  name: topLevel,
                  type: entry.isDirectory || parts.length > 1 ? "directory" : "file",
                  size: entry.header.size,
                });
              }
            }
            json(res, { path: reqPath, items });
          } else {
            // List within zip subdirectory
            const prefix = innerPath.endsWith("/") ? innerPath : innerPath + "/";
            const items: unknown[] = [];
            const seen = new Set<string>();
            for (const entry of entries) {
              if (entry.entryName.startsWith(prefix)) {
                const rest = entry.entryName.substring(prefix.length);
                const parts = rest.split("/").filter(Boolean);
                if (parts.length > 0 && !seen.has(parts[0])) {
                  seen.add(parts[0]);
                  items.push({
                    name: parts[0],
                    type: parts.length > 1 || entry.isDirectory ? "directory" : "file",
                    size: entry.header.size,
                  });
                }
              }
            }
            json(res, { path: reqPath, items });
          }
          return;
        }

        // Regular directory
        const stat = statSync(targetPath);
        if (stat.isDirectory()) {
          const hidden = /^devstash\.db|^\.devstash/;
          const items = readdirSync(targetPath, { withFileTypes: true })
            .filter((entry) => !hidden.test(entry.name))
            .map((entry) => {
            const full = join(targetPath, entry.name);
            const s = statSync(full);
            // For directories: use DB original_size if available (O(1)), else stat size
            let size = s.size;
            if (entry.isDirectory()) {
              const dbRecord = getBackup(db, entry.name);
              size = dbRecord ? dbRecord.original_size : s.size;
            }
            return {
              name: entry.name,
              type: entry.isDirectory() ? "directory" : "file",
              size,
              modified: s.mtime.toISOString(),
            };
          });
          json(res, { path: reqPath, items });
        } else {
          err(res, "Not a directory", 400);
        }
        return;
      }

      // --- API: Read file content ---
      if (method === "GET" && path === "/api/file") {
        const reqPath = url.searchParams.get("path") || "";
        if (!reqPath) {
          err(res, "Path required", 400);
          return;
        }

        const targetPath = join(vaultDir, reqPath);
        if (!isWithinVault(targetPath, vaultDir)) {
          err(res, "Access denied", 403);
          return;
        }

        // Handle file inside zip
        if (reqPath.includes(".zip/")) {
          const zipIdx = reqPath.indexOf(".zip/");
          const zipFile = join(vaultDir, reqPath.substring(0, zipIdx + 4));
          const entryPath = reqPath.substring(zipIdx + 5);

          if (!existsSync(zipFile)) {
            err(res, "Zip not found", 404);
            return;
          }

          const admZip = new AdmZip(zipFile);
          const entry = admZip.getEntry(entryPath);
          if (!entry) {
            err(res, "Entry not found in zip", 404);
            return;
          }

          const content = entry.getData().toString("utf-8");
          json(res, { path: reqPath, content, size: entry.header.size });
          return;
        }

        if (!existsSync(targetPath) || !statSync(targetPath).isFile()) {
          err(res, "File not found", 404);
          return;
        }

        const content = readFileSync(targetPath, "utf-8");
        const stat = statSync(targetPath);
        json(res, { path: reqPath, content, size: stat.size });
        return;
      }

      // --- API: Stats ---
      if (method === "GET" && path === "/api/stats") {
        json(res, getStats(db));
        return;
      }

      // --- API: Detect Claude config ---
      if (method === "GET" && path === "/api/claude/detect") {
        json(res, detectClaudeMemory());
        return;
      }

      // --- API: Backup Claude memory ---
      if (method === "POST" && path === "/api/claude/backup") {
        const result = backupClaudeMemory(vaultDir);

        if (result.filesCopied > 0) {
          const backupDirName = result.backupDir.replace(/\\/g, "/").split("/").pop()!;
          insertBackup(db, {
            name: backupDirName,
            type: "directory",
            shells: [],
            file_count: result.filesCopied,
            total_commands: 0,
            original_size: result.totalSizeBytes,
          });
        }

        json(res, result);
        return;
      }

      // --- API: List Claude memory backups ---
      if (method === "GET" && path === "/api/claude/backups") {
        json(res, listClaudeBackups(vaultDir));
        return;
      }

      // --- API: Restore Claude memory from backup ---
      if (method === "POST" && /^\/api\/claude\/backups\/([^/]+)\/restore$/.test(path)) {
        const backupName = decodeURIComponent(path.split("/")[4]);
        const backupDir = join(vaultDir, backupName);

        if (!isWithinVault(backupDir, vaultDir)) {
          err(res, "Access denied", 403);
          return;
        }
        if (!existsSync(backupDir)) {
          err(res, "Backup not found", 404);
          return;
        }

        const body = await parseBody(req);
        const mode = body.mode === "overwrite" ? "overwrite" : "merge";

        let restoreDir = backupDir;
        let tmpExtracted = false;

        if (backupName.endsWith(".zip")) {
          const admZip = new AdmZip(backupDir);
          restoreDir = join(vaultDir, `_restore-claude-tmp-${Date.now()}`);
          admZip.extractAllTo(restoreDir, true);
          tmpExtracted = true;

          const inner = readdirSync(restoreDir);
          if (inner.length === 1 && statSync(join(restoreDir, inner[0])).isDirectory()) {
            restoreDir = join(restoreDir, inner[0]);
          }
        }

        const results = restoreClaudeMemory(restoreDir, mode as "merge" | "overwrite");

        if (tmpExtracted) {
          try {
            rmSync(
              restoreDir.includes("_restore-claude-tmp-") ? restoreDir : dirname(restoreDir),
              { recursive: true, force: true }
            );
          } catch {
            // Best-effort cleanup
          }
        }

        json(res, results);
        return;
      }

      // --- 404 ---
      err(res, "Not found", 404);
    } catch (e) {
      console.error("Server error:", e);
      err(res, (e as Error).message);
    }
  });

  server.listen(port, () => {
    console.log(`\n  devstash GUI running at http://localhost:${port}`);
    console.log(`  Vault: ${resolve(vaultDir)}\n`);
  });

  return server;
}
