import fs from "node:fs";
import path from "node:path";
import { HttpError } from "./errors";

export const APP_CONFIG_ENV = "CODEX_MOBILE_CONFIG";
export const APP_DATA_ENV = "CODEX_MOBILE_DATA_DIR";

export function findProjectRoot(startDir = process.cwd()): string {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, "config", "codex-mobile.config.example.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return startDir;
    }
    current = parent;
  }
}

export function resolveConfigPath(projectRoot: string): string {
  return process.env[APP_CONFIG_ENV]
    ? path.resolve(process.env[APP_CONFIG_ENV]!)
    : path.join(projectRoot, "codex-mobile.config.json");
}

export function resolveDataDir(projectRoot: string): string {
  return process.env[APP_DATA_ENV]
    ? path.resolve(process.env[APP_DATA_ENV]!)
    : path.join(projectRoot, "data");
}

export function ensureDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function normalizeExistingDirectory(targetPath: string): string {
  let resolved: string;
  try {
    resolved = fs.realpathSync.native(path.resolve(targetPath));
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw new HttpError(400, "invalid_folder", "Folder path must point to a directory.");
    }
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(400, "invalid_folder", "Folder path must point to an existing directory.");
  }
  return resolved;
}

export function normalizeInsideRoots(targetPath: string, allowedRoots: string[]): string {
  const resolved = normalizeExistingDirectory(targetPath);
  const normalizedRoots = allowedRoots.map((root) => normalizeExistingDirectory(root));
  const match = normalizedRoots.find((root) => isInsidePath(root, resolved));
  if (!match) {
    throw new HttpError(400, "invalid_folder", "Folder is not inside an allowed root.");
  }
  return resolved;
}

export function isInsidePath(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function safeRelative(rootPath: string, targetPath: string): string {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" ? "." : relative;
}
