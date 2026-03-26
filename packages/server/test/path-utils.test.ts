import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isInsidePath, normalizeInsideRoots } from "../src/paths";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-mobile-paths-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("path validation", () => {
  it("accepts directories inside allowed roots", () => {
    const root = makeTempDir();
    const project = path.join(root, "project-a");
    fs.mkdirSync(project);

    expect(isInsidePath(root, project)).toBe(true);
    expect(normalizeInsideRoots(project, [root])).toBe(fs.realpathSync.native(project));
  });

  it("rejects directories outside allowed roots", () => {
    const root = makeTempDir();
    const outside = makeTempDir();

    expect(() => normalizeInsideRoots(outside, [root])).toThrow(/allowed root/i);
  });
});

