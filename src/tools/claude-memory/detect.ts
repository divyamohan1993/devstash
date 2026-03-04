import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ClaudeFileInfo {
  label: string;
  relativePath: string;
  absolutePath: string;
  exists: boolean;
  sizeBytes: number;
  category: "critical" | "nice-to-have";
}

export interface ProjectMemoryInfo {
  slug: string;
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
}

export interface ReferenceFileInfo {
  name: string;
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
}

export interface ClaudeDetectResult {
  claudeDir: string;
  claudeDirExists: boolean;
  files: ClaudeFileInfo[];
  projectMemories: ProjectMemoryInfo[];
  referenceFiles: ReferenceFileInfo[];
}

export function getClaudeDir(): string {
  return join(homedir(), ".claude");
}

export function detectClaudeMemory(): ClaudeDetectResult {
  const claudeDir = getClaudeDir();
  const claudeDirExists = existsSync(claudeDir);

  const files: ClaudeFileInfo[] = [];
  const projectMemories: ProjectMemoryInfo[] = [];
  const referenceFiles: ReferenceFileInfo[] = [];

  if (!claudeDirExists) {
    return { claudeDir, claudeDirExists, files, projectMemories, referenceFiles };
  }

  // Critical files
  const critical: Array<{ label: string; rel: string }> = [
    { label: "Global CLAUDE.md", rel: "CLAUDE.md" },
    { label: "Settings", rel: "settings.json" },
  ];

  for (const { label, rel } of critical) {
    const abs = join(claudeDir, rel);
    const exists = existsSync(abs);
    files.push({
      label,
      relativePath: rel,
      absolutePath: abs,
      exists,
      sizeBytes: exists ? statSync(abs).size : 0,
      category: "critical",
    });
  }

  // Nice-to-have plugin files
  const plugins: Array<{ label: string; rel: string }> = [
    { label: "Installed plugins", rel: "plugins/installed_plugins.json" },
    { label: "Plugin blocklist", rel: "plugins/blocklist.json" },
    { label: "Known marketplaces", rel: "plugins/known_marketplaces.json" },
  ];

  for (const { label, rel } of plugins) {
    const abs = join(claudeDir, rel);
    const exists = existsSync(abs);
    files.push({
      label,
      relativePath: rel,
      absolutePath: abs,
      exists,
      sizeBytes: exists ? statSync(abs).size : 0,
      category: "nice-to-have",
    });
  }

  // Project MEMORY.md files
  const projectsDir = join(claudeDir, "projects");
  if (existsSync(projectsDir)) {
    for (const slug of readdirSync(projectsDir)) {
      const memPath = join(projectsDir, slug, "memory", "MEMORY.md");
      if (existsSync(memPath)) {
        projectMemories.push({
          slug,
          relativePath: `projects/${slug}/memory/MEMORY.md`,
          absolutePath: memPath,
          sizeBytes: statSync(memPath).size,
        });
      }
    }
  }

  // Reference files
  const referenceDir = join(claudeDir, "reference");
  if (existsSync(referenceDir)) {
    for (const name of readdirSync(referenceDir)) {
      const abs = join(referenceDir, name);
      if (statSync(abs).isFile()) {
        referenceFiles.push({
          name,
          relativePath: `reference/${name}`,
          absolutePath: abs,
          sizeBytes: statSync(abs).size,
        });
      }
    }
  }

  return { claudeDir, claudeDirExists, files, projectMemories, referenceFiles };
}
