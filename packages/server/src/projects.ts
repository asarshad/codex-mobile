import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { safeRelative } from "./paths";
import { ProjectInfo, StoredSessionRecord } from "./types";

async function hasProjectMarker(dirPath: string, markers: string[]): Promise<boolean> {
  const entries = await fs.readdir(dirPath);
  return markers.some((marker) => entries.includes(marker));
}

async function walkProjects(
  rootPath: string,
  markers: string[],
  scanDepth: number,
  maxProjects: number
): Promise<string[]> {
  const results = new Set<string>();

  async function visit(currentPath: string, depth: number): Promise<void> {
    if (results.size >= maxProjects) {
      return;
    }

    if (await hasProjectMarker(currentPath, markers)) {
      results.add(currentPath);
    }

    if (depth >= scanDepth) {
      return;
    }

    const children = await fs.readdir(currentPath, { withFileTypes: true });
    for (const child of children) {
      if (!child.isDirectory()) {
        continue;
      }
      if (child.name === "node_modules" || child.name.startsWith(".")) {
        continue;
      }
      await visit(path.join(currentPath, child.name), depth + 1);
    }
  }

  await visit(rootPath, 0);
  return [...results];
}

export async function listProjects(
  allowedRoots: string[],
  scanDepth: number,
  maxProjects: number,
  markers: string[],
  recentSessions: StoredSessionRecord[]
): Promise<ProjectInfo[]> {
  const recentByPath = new Map<string, StoredSessionRecord>();
  for (const session of recentSessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    if (!recentByPath.has(session.projectPath)) {
      recentByPath.set(session.projectPath, session);
    }
  }

  const projects: ProjectInfo[] = [];
  for (const rootPath of allowedRoots) {
    const matches = await walkProjects(rootPath, markers, scanDepth, maxProjects);
    for (const projectPath of matches) {
      const relativePath = safeRelative(rootPath, projectPath);
      projects.push({
        id: crypto.createHash("sha1").update(projectPath).digest("hex"),
        name: relativePath === "." ? path.basename(projectPath) : path.basename(projectPath),
        path: projectPath,
        root: rootPath,
        relativePath,
        recentSessionId: recentByPath.get(projectPath)?.id ?? null
      });
    }
  }

  return projects
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    .slice(0, maxProjects);
}

