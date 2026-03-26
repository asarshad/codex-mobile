import fs from "node:fs";
import path from "node:path";
import { AppConfig } from "./types";
import { ensureDirectory, findProjectRoot, normalizeExistingDirectory, resolveConfigPath, resolveDataDir } from "./paths";

export function loadConfig(): AppConfig {
  const projectRoot = findProjectRoot();
  const configPath = resolveConfigPath(projectRoot);
  const dataDir = resolveDataDir(projectRoot);
  ensureDirectory(dataDir);

  const raw = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, "utf8"))
    : {};

  const server = {
    host: raw.server?.host ?? "127.0.0.1",
    port: raw.server?.port ?? 4318,
    allowLan: raw.server?.allowLan ?? false,
    sessionTtlDays: raw.server?.sessionTtlDays ?? 14,
    pairingCodeTtlMinutes: raw.server?.pairingCodeTtlMinutes ?? 10
  };

  const defaultRoot = path.resolve(projectRoot, "..");
  const allowedRoots = Array.isArray(raw.projects?.allowedRoots) && raw.projects.allowedRoots.length > 0
    ? raw.projects.allowedRoots.map((entry: string) => normalizeExistingDirectory(entry))
    : [normalizeExistingDirectory(defaultRoot)];

  const projects = {
    allowedRoots,
    scanDepth: raw.projects?.scanDepth ?? 2,
    maxProjects: raw.projects?.maxProjects ?? 200,
    markers: Array.isArray(raw.projects?.markers) && raw.projects.markers.length > 0
      ? raw.projects.markers
      : [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod"]
  };

  const codex = {
    binaryPath: raw.codex?.binaryPath ?? "codex",
    preferredAdapter: raw.codex?.preferredAdapter === "cli" ? "cli" : "app-server",
    approvalPolicy: raw.codex?.approvalPolicy === "never"
      ? "never"
      : raw.codex?.approvalPolicy === "untrusted"
        ? "untrusted"
        : "on-request",
    sandboxMode: raw.codex?.sandboxMode === "read-only"
      ? "read-only"
      : raw.codex?.sandboxMode === "danger-full-access"
        ? "danger-full-access"
        : "workspace-write",
    model: typeof raw.codex?.model === "string" ? raw.codex.model : null
  } as const;

  return {
    server,
    projects,
    codex,
    projectRoot,
    dataDir,
    configPath
  };
}

