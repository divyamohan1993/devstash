import http from "node:http";
import {
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { join, resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { detectShells } from "./tools/shell-history/detect.js";
import { backupHistories } from "./tools/shell-history/backup.js";
import { restoreHistories, listBackups } from "./tools/shell-history/restore.js";
import { zipAndVerify } from "./tools/zipper.js";

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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getDirSize(dir: string): number {
  let size = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isFile()) size += statSync(full).size;
      else if (entry.isDirectory()) size += getDirSize(full);
    }
  } catch {
    // Ignore permission errors
  }
  return size;
}

export function startServer(port: number, vaultDir: string) {
  mkdirSync(vaultDir, { recursive: true });

  const htmlPath = join(__dirname, "..", "public", "index.html");
  if (!existsSync(htmlPath)) {
    console.error(`GUI file not found: ${htmlPath}`);
    process.exit(1);
  }
  const html = readFileSync(htmlPath, "utf-8");

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:${port}`);
    const path = url.pathname;
    const method = req.method!;

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");

    try {
      // --- GUI ---
      if (method === "GET" && path === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
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
        json(res, { results, vaultDir });
        return;
      }

      // --- API: List backups ---
      if (method === "GET" && path === "/api/backups") {
        const entries: unknown[] = [];

        if (existsSync(vaultDir)) {
          for (const name of readdirSync(vaultDir).sort().reverse()) {
            const full = join(vaultDir, name);
            const stat = statSync(full);
            const isZip = name.endsWith(".zip");
            const isDir = stat.isDirectory();
            if (!isDir && !isZip) continue;

            const entry: Record<string, unknown> = {
              name,
              path: full,
              type: isZip ? "zip" : "directory",
              modified: stat.mtime.toISOString(),
            };

            if (isDir) {
              entry.size = getDirSize(full);
              entry.files = readdirSync(full).length;
              // Check if a corresponding zip exists
              entry.hasZip = existsSync(`${full}.zip`);
            } else {
              entry.size = stat.size;
            }

            entries.push(entry);
          }
        }

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
          const items = readdirSync(targetPath, { withFileTypes: true }).map((entry) => {
            const full = join(targetPath, entry.name);
            const s = statSync(full);
            return {
              name: entry.name,
              type: entry.isDirectory() ? "directory" : "file",
              size: entry.isDirectory() ? getDirSize(full) : s.size,
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
