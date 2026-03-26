import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/app";
import { AppConfig, SessionDetail, SessionSummary } from "../src/types";

class FakeAdapter extends EventEmitter {
  readonly kind = "app-server" as const;
  readonly capabilities = { approvals: true, history: true };

  async health() {
    return { available: true, kind: "app-server" as const, reason: null, approvals: true, history: true };
  }

  async getAuthStatus() {
    return {
      loggedIn: true,
      authMethod: "chatgpt",
      accountEmail: "dev@example.com",
      planType: "plus",
      requiresOpenAiAuth: false
    };
  }

  async listSessions(): Promise<SessionSummary[]> {
    return [];
  }

  async getSession(sessionId: string): Promise<SessionDetail> {
    return {
      session: {
        id: sessionId,
        adapter: "app-server",
        title: "Fake Session",
        preview: "",
        projectPath: "/tmp/project",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "idle",
        active: false,
        source: "test"
      },
      events: [],
      pendingApprovals: []
    };
  }

  async createSession(projectPath: string): Promise<SessionSummary> {
    return {
      id: "session-1",
      adapter: "app-server",
      title: "Fake Session",
      preview: "",
      projectPath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "idle",
      active: false,
      source: "test"
    };
  }

  async resumeSession(sessionId: string): Promise<SessionSummary> {
    return this.createSession("/tmp/project").then((session) => ({ ...session, id: sessionId }));
  }

  async sendMessage() {
    return { turnId: "turn-1" };
  }

  async approve() {}
  async reject() {}
  async interrupt() {}
  async close() {}
}

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("API behavior", () => {
  it("pairs a device and allows project listing", async () => {
    const projectRoot = makeTempDir("codex-mobile-api-");
    const allowedRoot = path.join(projectRoot, "projects");
    const nestedProject = path.join(allowedRoot, "sample-app");
    fs.mkdirSync(path.join(nestedProject, ".git"), { recursive: true });
    const dataDir = path.join(projectRoot, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "packages", "web", "dist"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "packages", "web", "dist", "index.html"), "<html></html>");

    const config: AppConfig = {
      server: { host: "127.0.0.1", port: 4318, allowLan: true, sessionTtlDays: 14, pairingCodeTtlMinutes: 10 },
      projects: { allowedRoots: [allowedRoot], scanDepth: 2, maxProjects: 50, markers: [".git"] },
      codex: {
        binaryPath: "codex",
        preferredAdapter: "app-server",
        approvalPolicy: "on-request",
        sandboxMode: "workspace-write",
        model: null
      },
      projectRoot,
      dataDir,
      configPath: path.join(projectRoot, "codex-mobile.config.json")
    };

    const fakeAdapter = new FakeAdapter();
    const fakeCodex = {
      appAdapter: fakeAdapter,
      cliAdapter: fakeAdapter,
      preferredAdapter: async () => fakeAdapter,
      adapterForSession: () => fakeAdapter,
      close: async () => {}
    };

    const runtime = await createRuntime(config, { codex: fakeCodex as never });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      const pairStart = await request(runtime.app).post("/api/pair/start").expect(200);
      const codeLog = logSpy.mock.calls
        .flat()
        .map(String)
        .find((entry) => entry.includes("Codex Mobile pairing code"));
      const pairingCode = codeLog?.match(/(\d{6})/)?.[1];

      expect(pairingCode).toBeTruthy();

      const pairVerify = await request(runtime.app)
        .post("/api/pair/verify")
        .send({ pairingId: pairStart.body.pairingId, code: pairingCode, deviceName: "Phone" })
        .expect(200);

      const cookie = pairVerify.header["set-cookie"][0].split(";")[0];
      const authStatus = await request(runtime.app).get("/api/auth/status").set("Cookie", cookie).expect(200);
      expect(authStatus.body.paired).toBe(true);

      const projects = await request(runtime.app).get("/api/projects").set("Cookie", cookie).expect(200);
      expect(projects.body.projects).toHaveLength(1);
      expect(projects.body.projects[0].path).toBe(nestedProject);

      const invalidCreate = await request(runtime.app)
        .post("/api/sessions")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", pairVerify.body.csrfToken)
        .send({ projectPath: path.join(projectRoot, "outside") })
        .expect(400);

      expect(invalidCreate.body.error.code).toBe("invalid_folder");
    } finally {
      logSpy.mockRestore();
      await runtime.close();
    }
  });
});
