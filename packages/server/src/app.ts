import http from "node:http";
import crypto from "node:crypto";
import express, { NextFunction, Request, Response } from "express";
import { WebSocketServer } from "ws";
import { loadConfig } from "./config";
import { HttpError, isHttpError } from "./errors";
import { listProjects } from "./projects";
import { StateStore } from "./store";
import { AuthService, readCsrfHeader } from "./security/auth";
import { isLoopbackRequest, isPrivateRequest } from "./security/network";
import { AppConfig, HealthResponse, PendingApproval } from "./types";
import { CodexCoordinator } from "./codex";
import { SessionService } from "./session-service";

type PairingRecord = {
  id: string;
  code: string;
  expiresAt: number;
};

export async function createRuntime(
  providedConfig?: AppConfig,
  overrides?: {
    store?: StateStore;
    codex?: CodexCoordinator;
  }
) {
  const config = providedConfig ?? loadConfig();
  const store = overrides?.store ?? new StateStore(config.dataDir);
  const auth = new AuthService(store, config.server.sessionTtlDays);
  const codex = overrides?.codex ?? new CodexCoordinator(config, store);
  const sessions = new SessionService(config, store, codex);
  const pairings = new Map<string, PairingRecord>();
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const socketsBySession = new Map<string, Set<import("ws").WebSocket>>();

  function broadcast(sessionId: string, payload: Record<string, unknown>): void {
    for (const socket of socketsBySession.get(sessionId) ?? []) {
      socket.send(JSON.stringify(payload));
    }
    for (const socket of socketsBySession.get("*") ?? []) {
      socket.send(JSON.stringify(payload));
    }
  }

  const health = async (): Promise<HealthResponse> => ({
    ok: true,
    serverTime: new Date().toISOString(),
    adapter: await codex.appAdapter.health(),
    fallback: await codex.cliAdapter.health(),
    auth: await (await codex.preferredAdapter()).getAuthStatus()
  });

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use((req, _res, next) => {
    if (!config.server.allowLan && !isLoopbackRequest(req)) {
      next(new HttpError(403, "localhost_only", "LAN access is disabled. Use localhost or enable allowLan."));
      return;
    }
    if (config.server.allowLan && !isPrivateRequest(req)) {
      next(new HttpError(403, "lan_only", "This server only accepts requests from the local network."));
      return;
    }
    next();
  });

  const requireAuth = (req: Request, _res: Response, next: NextFunction) => {
    try {
      const deviceSession = auth.requireAuth(req);
      const csrfHeader = readCsrfHeader(req);
      if (req.method !== "GET" && csrfHeader !== deviceSession.session.csrfToken) {
        throw new HttpError(403, "csrf_invalid", "Missing or invalid CSRF token.");
      }
      (req as Request & { deviceSession: typeof deviceSession }).deviceSession = deviceSession;
      next();
    } catch (error) {
      next(error);
    }
  };

  app.get("/api/health", async (_req, res, next) => {
    try {
      res.json(await health());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/status", async (req, res, next) => {
    try {
      const deviceSession = auth.readAuthSession(req);
      const adapter = await codex.preferredAdapter();
      const codexAuth = await adapter.getAuthStatus();
      res.json({
        paired: Boolean(deviceSession),
        device: deviceSession?.device ?? null,
        csrfToken: deviceSession?.session.csrfToken ?? null,
        codexAuth,
        config: {
          serverUrl: `http://${config.server.host}:${config.server.port}`,
          allowLan: config.server.allowLan
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/pair/start", (_req, res) => {
    const id = crypto.randomUUID();
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + config.server.pairingCodeTtlMinutes * 60 * 1000;
    pairings.set(id, { id, code, expiresAt });

    console.log(`\nCodex Mobile pairing code: ${code}`);
    console.log(`This code expires at ${new Date(expiresAt).toLocaleTimeString()}\n`);

    res.json({
      pairingId: id,
      expiresAt: new Date(expiresAt).toISOString()
    });
  });

  app.post("/api/pair/verify", (req, res, next) => {
    try {
      const { pairingId, code, deviceName } = req.body as {
        pairingId?: string;
        code?: string;
        deviceName?: string;
      };
      if (!pairingId || !code) {
        throw new HttpError(400, "pairing_invalid", "Pairing code is required.");
      }

      const pairing = pairings.get(pairingId);
      if (!pairing || pairing.expiresAt < Date.now() || pairing.code !== code) {
        throw new HttpError(400, "pairing_invalid", "Pairing code is invalid or has expired.");
      }

      pairings.delete(pairingId);
      const result = auth.createDeviceSession(deviceName?.trim() || "iPhone");
      auth.setSessionCookie(res, result.cookieValue, result.session.expiresAt);
      res.json({
        paired: true,
        device: result.device,
        csrfToken: result.session.csrfToken
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects", requireAuth, async (_req, res, next) => {
    try {
      const projects = await listProjects(
        config.projects.allowedRoots,
        config.projects.scanDepth,
        config.projects.maxProjects,
        config.projects.markers,
        store.listSessions()
      );
      res.json({ projects });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/sessions", requireAuth, async (_req, res, next) => {
    try {
      res.json({ sessions: await sessions.listSessions() });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sessions", requireAuth, async (req, res, next) => {
    try {
      const { projectPath, sessionId } = req.body as {
        projectPath?: string;
        sessionId?: string;
      };
      if (!projectPath && !sessionId) {
        throw new HttpError(400, "invalid_folder", "Provide a project path or an existing session id.");
      }
      const session = projectPath
        ? await sessions.createSession(projectPath, sessionId)
        : await sessions.resumeSession(sessionId!);
      res.json({ session });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/sessions/:id", requireAuth, async (req, res, next) => {
    try {
      res.json(await sessions.getSession(String(req.params.id)));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sessions/:id/message", requireAuth, async (req, res, next) => {
    try {
      const text = String(req.body?.text ?? "").trim();
      if (!text) {
        throw new HttpError(400, "message_invalid", "Message text is required.");
      }
      res.json(await sessions.sendMessage(String(req.params.id), text));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sessions/:id/approve", requireAuth, async (req, res, next) => {
    try {
      const approvalId = String(req.body?.approvalId ?? "");
      if (!approvalId) {
        throw new HttpError(400, "approval_invalid", "Approval id is required.");
      }
      await sessions.approve(String(req.params.id), approvalId, req.body ?? {});
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sessions/:id/reject", requireAuth, async (req, res, next) => {
    try {
      const approvalId = String(req.body?.approvalId ?? "");
      if (!approvalId) {
        throw new HttpError(400, "approval_invalid", "Approval id is required.");
      }
      await sessions.reject(String(req.params.id), approvalId);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sessions/:id/interrupt", requireAuth, async (req, res, next) => {
    try {
      await sessions.interrupt(String(req.params.id));
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  const frontendDist = `${config.projectRoot}/packages/web/dist`;
  app.use(express.static(frontendDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next(new HttpError(404, "not_found", "Route not found."));
      return;
    }
    res.sendFile(`${frontendDist}/index.html`, (error) => {
      if (error) {
        next(error);
      }
    });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isHttpError(error)) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(500).json({ error: { code: "internal_error", message } });
  });

  codex.appAdapter.on("event", ({ sessionId, event }) => {
    broadcast(sessionId, { type: "session_event", sessionId, event });
  });
  codex.appAdapter.on("approval", ({ sessionId, approval }) => {
    broadcast(sessionId, { type: "approval", sessionId, approval });
  });
  codex.appAdapter.on("approval-resolved", ({ sessionId, event }) => {
    broadcast(sessionId, { type: "session_event", sessionId, event });
  });
  codex.cliAdapter.on("event", ({ sessionId, event }) => {
    broadcast(sessionId, { type: "session_event", sessionId, event });
  });

  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/api/events") {
      socket.destroy();
      return;
    }

    const fakeReq = req as Request;
    try {
      const deviceSession = auth.requireAuth(fakeReq);
      const requestUrl = new URL(req.url ?? "", `http://${req.headers.host}`);
      const csrfToken = requestUrl.searchParams.get("csrfToken");
      if (csrfToken !== deviceSession.session.csrfToken) {
        throw new HttpError(403, "csrf_invalid", "Missing or invalid CSRF token.");
      }
    } catch {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const url = new URL(req.url ?? "", `http://${req.headers.host}`);
      const sessionId = url.searchParams.get("sessionId") || "*";
      if (!socketsBySession.has(sessionId)) {
        socketsBySession.set(sessionId, new Set());
      }
      socketsBySession.get(sessionId)!.add(ws);
      ws.on("close", () => {
        socketsBySession.get(sessionId)?.delete(ws);
      });
      ws.send(JSON.stringify({ type: "connected", sessionId }));
    });
  });

  return {
    app,
    server,
    config,
    health,
    close: async () => {
      await codex.close();
      if (!server.listening) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}
