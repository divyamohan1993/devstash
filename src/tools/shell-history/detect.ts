import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export interface ShellInfo {
  name: string;
  historyPath: string;
  exists: boolean;
}

function getHome(): string {
  return homedir();
}

function getPowerShellHistoryPath(): string | null {
  const isWindows = platform() === "win32";

  if (isWindows) {
    const defaultPath = join(
      getHome(),
      "AppData",
      "Roaming",
      "Microsoft",
      "Windows",
      "PowerShell",
      "PSReadLine",
      "ConsoleHost_history.txt"
    );
    if (existsSync(defaultPath)) return defaultPath;

    try {
      const result = execFileSync(
        "powershell",
        ["-NoProfile", "-Command", "(Get-PSReadLineOption).HistorySavePath"],
        { encoding: "utf-8", timeout: 5000 }
      ).trim();
      if (result && existsSync(result)) return result;
    } catch {
      // PowerShell not available or PSReadLine not installed
    }
  }

  return null;
}

export function detectShells(): ShellInfo[] {
  const home = getHome();
  const isWindows = platform() === "win32";
  const shells: ShellInfo[] = [];

  // Bash
  const bashHistory = join(home, ".bash_history");
  shells.push({
    name: "bash",
    historyPath: bashHistory,
    exists: existsSync(bashHistory),
  });

  // Zsh
  const zshHistory = join(home, ".zsh_history");
  shells.push({
    name: "zsh",
    historyPath: zshHistory,
    exists: existsSync(zshHistory),
  });

  // Fish
  const fishHistory = isWindows
    ? join(home, "AppData", "Local", "fish", "fish_history")
    : join(home, ".local", "share", "fish", "fish_history");
  shells.push({
    name: "fish",
    historyPath: fishHistory,
    exists: existsSync(fishHistory),
  });

  // PowerShell
  const psPath = getPowerShellHistoryPath();
  if (psPath) {
    shells.push({
      name: "powershell",
      historyPath: psPath,
      exists: true,
    });
  }

  // Git Bash (Windows) — uses same .bash_history usually
  if (isWindows) {
    const gitBashHistory = join(home, ".bash_history");
    if (existsSync(gitBashHistory) && !shells.some((s) => s.name === "bash" && s.exists)) {
      shells.push({
        name: "git-bash",
        historyPath: gitBashHistory,
        exists: true,
      });
    }
  }

  // Nushell
  const nuHistory = isWindows
    ? join(home, "AppData", "Roaming", "nushell", "history.txt")
    : join(home, ".config", "nushell", "history.txt");
  shells.push({
    name: "nushell",
    historyPath: nuHistory,
    exists: existsSync(nuHistory),
  });

  return shells;
}
