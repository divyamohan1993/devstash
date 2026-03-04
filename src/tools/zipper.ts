import archiver from "archiver";
import AdmZip from "adm-zip";
import {
  createWriteStream,
  readdirSync,
  statSync,
  mkdirSync,
  rmSync,
  renameSync,
} from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

export interface ZipResult {
  zipPath: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  verified: boolean;
  verifyDetails: string;
}

function getDirSize(dir: string): number {
  let size = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isFile()) size += statSync(full).size;
    else if (entry.isDirectory()) size += getDirSize(full);
  }
  return size;
}

function getDirFiles(dir: string, base = ""): { path: string; size: number }[] {
  const files: { path: string; size: number }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = join(dir, entry.name);
    if (entry.isFile()) files.push({ path: rel, size: statSync(full).size });
    else if (entry.isDirectory()) files.push(...getDirFiles(full, rel));
  }
  return files;
}

export async function zipAndVerify(sourceDir: string): Promise<ZipResult> {
  const dirName = basename(sourceDir);
  const zipPath = `${sourceDir}.zip`;
  const tmpPath = `${zipPath}.tmp`;
  const originalSize = getDirSize(sourceDir);
  const originalFiles = getDirFiles(sourceDir);

  // Create zip with max deflate compression to temp file first (crash-safe)
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(tmpPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(sourceDir, dirName);
    archive.finalize();
  });

  // Verify by extracting to a temp directory
  const tmpExtract = join(tmpdir(), `devstash-verify-${randomUUID()}`);
  let verified = false;
  let verifyDetails = "";

  try {
    mkdirSync(tmpExtract, { recursive: true });
    const zip = new AdmZip(tmpPath);
    zip.extractAllTo(tmpExtract, true);

    const extractedDir = join(tmpExtract, dirName);
    const extractedFiles = getDirFiles(extractedDir);

    if (extractedFiles.length !== originalFiles.length) {
      verifyDetails = `File count mismatch: original=${originalFiles.length}, extracted=${extractedFiles.length}`;
    } else {
      const mismatches: string[] = [];
      for (const orig of originalFiles) {
        const ext = extractedFiles.find((e) => e.path === orig.path);
        if (!ext) mismatches.push(`Missing: ${orig.path}`);
        else if (ext.size !== orig.size)
          mismatches.push(`Size mismatch: ${orig.path} (${orig.size} vs ${ext.size})`);
      }
      if (mismatches.length > 0) {
        verifyDetails = mismatches.join("; ");
      } else {
        verified = true;
        verifyDetails = `All ${originalFiles.length} file(s) verified OK`;
      }
    }
  } catch (err) {
    verifyDetails = `Verification error: ${(err as Error).message}`;
  } finally {
    // Always delete temp extraction files
    try {
      rmSync(tmpExtract, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }

  if (verified) {
    renameSync(tmpPath, zipPath);
  } else {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // Best-effort cleanup
    }
    throw new Error(`Zip verification failed: ${verifyDetails}`);
  }

  const compressedSize = statSync(zipPath).size;

  return {
    zipPath,
    originalSize,
    compressedSize,
    compressionRatio: originalSize > 0 ? +(1 - compressedSize / originalSize).toFixed(4) : 0,
    verified,
    verifyDetails,
  };
}
