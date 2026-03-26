import { EventEmitter } from "node:events";
import { spawn, ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import net from "node:net";
import WebSocket from "ws";
import { AppConfig, PendingApproval, SessionDetail, SessionEvent, SessionSummary, AdapterHealth, CodexAuthStatus } from "../types";
import { CodexAdapter } from "./types";
import { HttpError } from "../errors";
import { attachmentToBinaryNote, attachmentToTextContext, isImageAttachment, isTextAttachment } from "../attachments";
import { MessageAttachmentInput } from "../types";

type JsonRpcResponse = {
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type PendingResolver = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

type PendingApprovalRecord = PendingApproval & {
  requestId: number | string;
  timer: NodeJS.Timeout;
};

export class AppServerAdapter extends CodexAdapter {
  readonly kind = "app-server" as const;
  readonly capabilities = { approvals: true, history: true };
  private child: ChildProcess | null = null;
  private socket: WebSocket | null = null;
  private readonly pendingRequests = new Map<number, PendingResolver>();
  private readonly pendingApprovals = new Map<string, PendingApprovalRecord>();
  private readonly activeTurns = new Map<string, string>();
  private readonly loadedThreads = new Set<string>();
  private nextRequestId = 1;
  private connectPromise: Promise<void> | null = null;
  private unavailableReason: string | null = null;

  constructor(private readonly config: AppConfig) {
    super();
  }

  private buildTurnSandboxPolicy(): Record<string, unknown> {
    if (this.config.codex.sandboxMode === "danger-full-access") {
      return { type: "dangerFullAccess" };
    }

    if (this.config.codex.sandboxMode === "read-only") {
      return {
        type: "readOnly",
        access: { type: "fullAccess" },
        networkAccess: false
      };
    }

    return {
      type: "workspaceWrite",
      writableRoots: [],
      readOnlyAccess: { type: "fullAccess" },
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false
    };
  }

  private async getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Could not allocate an app-server port."));
          return;
        }
        const { port } = address;
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(port);
        });
      });
      server.on("error", reject);
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      const port = await this.getFreePort();
      const listenUrl = `ws://127.0.0.1:${port}`;

      const child = spawn(this.config.codex.binaryPath, [
        "app-server",
        "--listen",
        listenUrl,
        "--session-source",
        "codex-mobile"
      ], {
        cwd: this.config.projectRoot,
        env: {
          ...process.env,
          PATH: process.env.PATH
        },
        stdio: ["ignore", "pipe", "pipe"]
      });
      this.child = child;

      child.stderr?.on("data", (chunk) => {
        const message = chunk.toString("utf8").trim();
        if (message) {
          this.unavailableReason = message;
        }
      });

      child.on("exit", (code) => {
        this.socket = null;
        this.child = null;
        this.unavailableReason = `app-server exited with code ${code ?? "unknown"}`;
      });

      this.socket = await this.connectWebSocket(listenUrl);

      this.socket.on("message", (payload) => {
        const parsed = JSON.parse(payload.toString("utf8")) as Record<string, unknown>;
        this.handleMessage(parsed).catch((error) => {
          this.unavailableReason = error instanceof Error ? error.message : String(error);
        });
      });

      this.socket.on("close", () => {
        this.socket = null;
      });

      await this.request("initialize", {
        clientInfo: {
          name: "codex-mobile-app",
          title: "Codex Mobile",
          version: "0.1.0"
        },
        capabilities: {
          experimentalApi: true,
          optOutNotificationMethods: []
        }
      });
      this.unavailableReason = null;
    })();

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async connectWebSocket(listenUrl: string): Promise<WebSocket> {
    const deadline = Date.now() + 8000;
    let lastError: Error | null = null;

    while (Date.now() < deadline) {
      try {
        return await new Promise<WebSocket>((resolve, reject) => {
          const socket = new WebSocket(listenUrl);
          const timer = setTimeout(() => {
            socket.terminate();
            reject(new Error("Timed out waiting for app-server websocket."));
          }, 1200);
          socket.once("open", () => {
            clearTimeout(timer);
            resolve(socket);
          });
          socket.once("error", (error) => {
            clearTimeout(timer);
            reject(error instanceof Error ? error : new Error(String(error)));
          });
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    throw lastError ?? new Error("Timed out connecting to codex app-server.");
  }

  private async handleMessage(message: Record<string, unknown>): Promise<void> {
    if ("id" in message && !("method" in message)) {
      const response = message as JsonRpcResponse;
      const pending = this.pendingRequests.get(Number(response.id));
      if (!pending) {
        return;
      }
      this.pendingRequests.delete(Number(response.id));
      if (response.error) {
        pending.reject(new Error(response.error.message));
      } else {
        pending.resolve(response.result);
      }
      return;
    }

    const method = String(message.method);
    if ("id" in message) {
      await this.handleServerRequest(Number(message.id), method, (message.params ?? {}) as Record<string, unknown>);
      return;
    }

    this.handleNotification(method, (message.params ?? {}) as Record<string, unknown>);
  }

  private async handleServerRequest(id: number, method: string, params: Record<string, unknown>): Promise<void> {
    if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval" || method === "item/permissions/requestApproval") {
      const approval = this.buildApproval(method, id, params);
      const timer = setTimeout(() => {
        this.reject(approval.sessionId, approval.id).catch(() => undefined);
      }, 2 * 60 * 1000);
      this.pendingApprovals.set(approval.id, { ...approval, requestId: id, timer });
      this.emit("approval", { sessionId: approval.sessionId, approval });
      this.emit("event", {
        sessionId: approval.sessionId,
        event: {
          id: `approval-${approval.id}`,
          sessionId: approval.sessionId,
          createdAt: approval.createdAt,
          turnId: approval.turnId,
          itemId: approval.itemId,
          type: "approval",
          text: approval.summary,
          data: approval.data
        }
      });
      return;
    }

    if (method === "account/chatgptAuthTokens/refresh") {
      await this.respondWithError(id, -32001, "Codex Mobile cannot refresh ChatGPT tokens. Run `codex login` on the Mac.");
      return;
    }

    await this.respondWithError(id, -32601, `Unsupported server request: ${method}`);
  }

  private buildApproval(method: string, requestId: number, params: Record<string, unknown>): PendingApproval {
    const sessionId = String(params.threadId ?? "");
    const base = {
      id: String(requestId),
      sessionId,
      turnId: String(params.turnId ?? ""),
      itemId: String(params.itemId ?? ""),
      method,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString()
    };

    if (method === "item/commandExecution/requestApproval") {
      return {
        ...base,
        kind: "command",
        summary: `Approve command: ${String(params.command ?? "command")}`,
        detail: params.reason ? String(params.reason) : undefined,
        data: {
          command: params.command,
          cwd: params.cwd,
          availableDecisions: params.availableDecisions,
          reason: params.reason
        }
      };
    }

    if (method === "item/fileChange/requestApproval") {
      return {
        ...base,
        kind: "file",
        summary: "Approve file changes",
        detail: params.reason ? String(params.reason) : undefined,
        data: {
          reason: params.reason,
          grantRoot: params.grantRoot
        }
      };
    }

    return {
      ...base,
      kind: "permissions",
      summary: "Approve additional permissions",
      detail: params.reason ? String(params.reason) : undefined,
      data: {
        permissions: params.permissions,
        reason: params.reason
      }
    };
  }

  private handleNotification(method: string, params: Record<string, unknown>): void {
    const sessionId = typeof params.threadId === "string" ? params.threadId : null;
    if (method === "turn/started" && typeof params.threadId === "string" && typeof (params.turn as Record<string, unknown>)?.id === "string") {
      this.activeTurns.set(params.threadId, String((params.turn as Record<string, unknown>).id));
    }
    if (method === "turn/completed" && typeof params.threadId === "string") {
      this.activeTurns.delete(params.threadId);
    }
    if (method === "thread/closed" && typeof params.threadId === "string") {
      this.activeTurns.delete(params.threadId);
      this.loadedThreads.delete(params.threadId);
    }
    if ((method === "thread/started" || method === "thread/status/changed") && typeof params.threadId === "string") {
      this.loadedThreads.add(params.threadId);
    }

    if (!sessionId) {
      return;
    }

    const event = this.normalizeNotification(sessionId, method, params);
    if (event) {
      this.emit("event", { sessionId, event });
    }
  }

  private normalizeNotification(sessionId: string, method: string, params: Record<string, unknown>): SessionEvent | null {
    const now = new Date().toISOString();
    if (method === "item/agentMessage/delta") {
      return {
        id: crypto.randomUUID(),
        sessionId,
        createdAt: now,
        type: "agent_delta",
        turnId: String(params.turnId ?? ""),
        itemId: String(params.itemId ?? ""),
        text: String(params.delta ?? "")
      };
    }

    if (method === "item/commandExecution/outputDelta") {
      return {
        id: crypto.randomUUID(),
        sessionId,
        createdAt: now,
        type: "command_output",
        turnId: String(params.turnId ?? ""),
        itemId: String(params.itemId ?? ""),
        text: String(params.delta ?? "")
      };
    }

    if (method === "command/exec/outputDelta") {
      return {
        id: crypto.randomUUID(),
        sessionId,
        createdAt: now,
        type: "command_output",
        turnId: String(params.turnId ?? ""),
        itemId: String(params.itemId ?? params.processId ?? ""),
        text: String(params.delta ?? "")
      };
    }

    if (method === "item/fileChange/outputDelta") {
      return {
        id: crypto.randomUUID(),
        sessionId,
        createdAt: now,
        type: "file_change",
        turnId: String(params.turnId ?? ""),
        itemId: String(params.itemId ?? ""),
        text: String(params.delta ?? "")
      };
    }

    if (method === "turn/started" || method === "turn/completed" || method === "thread/status/changed") {
      return {
        id: crypto.randomUUID(),
        sessionId,
        createdAt: now,
        type: "status",
        turnId: typeof params.turnId === "string" ? params.turnId : undefined,
        text: method,
        data: params
      };
    }

    if (method === "error") {
      return {
        id: crypto.randomUUID(),
        sessionId,
        createdAt: now,
        type: "error",
        turnId: typeof params.turnId === "string" ? params.turnId : undefined,
        text: String((params.error as Record<string, unknown>)?.message ?? "Codex error"),
        data: params
      };
    }

    if (method === "item/completed") {
      const item = params.item as Record<string, unknown> | undefined;
      if (!item) {
        return null;
      }
      const type = item.type;
      if (type === "agentMessage") {
        return {
          id: String(item.id ?? crypto.randomUUID()),
          sessionId,
          createdAt: now,
          type: "agent_message",
          turnId: String(params.turnId ?? ""),
          itemId: String(item.id ?? ""),
          text: String(item.text ?? "")
        };
      }
      if (type === "commandExecution") {
        return {
          id: String(item.id ?? crypto.randomUUID()),
          sessionId,
          createdAt: now,
          type: "command",
          turnId: String(params.turnId ?? ""),
          itemId: String(item.id ?? ""),
          text: String(item.command ?? ""),
          data: item as Record<string, unknown>
        };
      }
      if (type === "plan") {
        return {
          id: String(item.id ?? crypto.randomUUID()),
          sessionId,
          createdAt: now,
          type: "plan",
          turnId: String(params.turnId ?? ""),
          itemId: String(item.id ?? ""),
          text: String(item.text ?? "")
        };
      }
      if (type === "reasoning") {
        return {
          id: String(item.id ?? crypto.randomUUID()),
          sessionId,
          createdAt: now,
          type: "reasoning",
          turnId: String(params.turnId ?? ""),
          itemId: String(item.id ?? ""),
          text: Array.isArray(item.summary) ? item.summary.join("\n") : ""
        };
      }
    }

    if (method === "item/started") {
      const item = params.item as Record<string, unknown> | undefined;
      if (!item) {
        return null;
      }
      const type = String(item.type ?? "");
      if (type === "commandExecution") {
        return {
          id: String(item.id ?? crypto.randomUUID()),
          sessionId,
          createdAt: now,
          type: "command",
          turnId: String(params.turnId ?? ""),
          itemId: String(item.id ?? ""),
          text: String(item.command ?? ""),
          data: {
            cwd: item.cwd,
            status: item.status
          }
        };
      }
      if (type === "plan") {
        return {
          id: String(item.id ?? crypto.randomUUID()),
          sessionId,
          createdAt: now,
          type: "plan",
          turnId: String(params.turnId ?? ""),
          itemId: String(item.id ?? ""),
          text: String(item.text ?? "")
        };
      }
    }

    if (method === "item/plan/delta") {
      return {
        id: crypto.randomUUID(),
        sessionId,
        createdAt: now,
        type: "plan",
        turnId: String(params.turnId ?? ""),
        itemId: String(params.itemId ?? ""),
        text: String(params.delta ?? "")
      };
    }

    if (method === "turn/plan/updated") {
      const plan = Array.isArray(params.plan) ? params.plan : [];
      const text = plan
        .map((step) => {
          const value = step as Record<string, unknown>;
          return `${String(value.status ?? "").toUpperCase()} ${String(value.step ?? "")}`.trim();
        })
        .join("\n");
      return {
        id: crypto.randomUUID(),
        sessionId,
        createdAt: now,
        type: "plan",
        turnId: String(params.turnId ?? ""),
        text: text || String(params.explanation ?? "")
      };
    }

    if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
      return {
        id: crypto.randomUUID(),
        sessionId,
        createdAt: now,
        type: "reasoning",
        turnId: String(params.turnId ?? ""),
        itemId: String(params.itemId ?? ""),
        text: String(params.delta ?? "")
      };
    }

    if (method === "item/reasoning/summaryPartAdded") {
      const part = params.part as Record<string, unknown> | undefined;
      return {
        id: crypto.randomUUID(),
        sessionId,
        createdAt: now,
        type: "reasoning",
        turnId: String(params.turnId ?? ""),
        itemId: String(params.itemId ?? ""),
        text: String(part?.text ?? "")
      };
    }

    if (method === "turn/diff/updated") {
      return {
        id: crypto.randomUUID(),
        sessionId,
        createdAt: now,
        type: "file_change",
        turnId: String(params.turnId ?? ""),
        text: String(params.diff ?? ""),
        data: {
          diff: params.diff
        }
      };
    }

    if (method === "hook/started" || method === "hook/completed") {
      const run = params.run as Record<string, unknown> | undefined;
      const entries = Array.isArray(run?.entries) ? run.entries as Array<Record<string, unknown>> : [];
      const text = entries.map((entry) => String(entry.text ?? "")).filter(Boolean).join("\n");
      return {
        id: crypto.randomUUID(),
        sessionId,
        createdAt: now,
        type: "system",
        turnId: typeof params.turnId === "string" ? params.turnId : undefined,
        text: text || `${method}: ${String(run?.eventName ?? "hook")}`,
        data: {
          method,
          eventName: run?.eventName,
          status: run?.status,
          handlerType: run?.handlerType
        }
      };
    }

    if (method === "item/autoApprovalReview/started" || method === "item/autoApprovalReview/completed") {
      const review = params.review as Record<string, unknown> | undefined;
      return {
        id: crypto.randomUUID(),
        sessionId,
        createdAt: now,
        type: "system",
        turnId: String(params.turnId ?? ""),
        itemId: String(params.targetItemId ?? ""),
        text: `${method}: ${String(review?.status ?? "unknown")}`,
        data: {
          status: review?.status,
          riskLevel: review?.riskLevel,
          rationale: review?.rationale
        }
      };
    }

    if (method === "terminalInteraction") {
      return {
        id: crypto.randomUUID(),
        sessionId,
        createdAt: now,
        type: "system",
        turnId: String(params.turnId ?? ""),
        itemId: String(params.itemId ?? ""),
        text: String(params.stdin ?? ""),
        data: {
          processId: params.processId
        }
      };
    }

    return null;
  }

  private formatThreadStatus(status: unknown): string {
    if (!status || typeof status !== "object") {
      return "unknown";
    }
    const value = status as Record<string, unknown>;
    const type = String(value.type ?? "unknown");
    if (type === "active") {
      const activeFlags = Array.isArray(value.activeFlags) ? value.activeFlags.length : 0;
      return activeFlags > 0 ? `active (${activeFlags})` : "active";
    }
    return type;
  }

  private isActiveStatus(status: unknown): boolean {
    return typeof status === "object" && status !== null && (status as Record<string, unknown>).type === "active";
  }

  private async ensureThreadLoaded(sessionId: string): Promise<void> {
    await this.ensureConnected();
    if (this.loadedThreads.has(sessionId)) {
      return;
    }
    const loaded = await this.request<{ data: string[] }>("thread/loaded/list", {});
    for (const threadId of loaded.data ?? []) {
      this.loadedThreads.add(String(threadId));
    }
    if (this.loadedThreads.has(sessionId)) {
      return;
    }
    await this.request("thread/resume", {
      threadId: sessionId,
      persistExtendedHistory: true
    });
    this.loadedThreads.add(sessionId);
  }

  private async respondWithError(id: number, code: number, message: string): Promise<void> {
    this.socket?.send(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));
  }

  private async request<T = unknown>(method: string, params: Record<string, unknown> | undefined): Promise<T> {
    await this.ensureConnected();
    const id = this.nextRequestId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.socket?.send(payload, (error) => {
        if (error) {
          this.pendingRequests.delete(id);
          reject(error);
        }
      });
    });
  }

  async health(): Promise<AdapterHealth> {
    try {
      await this.ensureConnected();
      return { available: true, kind: this.kind, reason: null, approvals: true, history: true };
    } catch (error) {
      return {
        available: false,
        kind: this.kind,
        reason: error instanceof Error ? error.message : this.unavailableReason,
        approvals: true,
        history: true
      };
    }
  }

  async getAuthStatus(): Promise<CodexAuthStatus> {
    try {
      const accountResponse = await this.request<{ account: { type: string; email?: string; planType?: string } | null; requiresOpenaiAuth: boolean }>("account/read", {});
      return {
        loggedIn: Boolean(accountResponse.account),
        authMethod: accountResponse.account?.type ?? null,
        accountEmail: accountResponse.account?.email ?? null,
        planType: accountResponse.account?.planType ?? null,
        requiresOpenAiAuth: Boolean(accountResponse.requiresOpenaiAuth)
      };
    } catch {
      const fallback = await this.request<{ authMethod: string | null; requiresOpenaiAuth: boolean | null }>("getAuthStatus", {});
      return {
        loggedIn: Boolean(fallback.authMethod),
        authMethod: fallback.authMethod,
        accountEmail: null,
        planType: null,
        requiresOpenAiAuth: Boolean(fallback.requiresOpenaiAuth)
      };
    }
  }

  async listSessions(): Promise<SessionSummary[]> {
    const response = await this.request<{ data: Array<Record<string, unknown>> }>("thread/list", {
      limit: 100,
      archived: false
    });
    return response.data.map((thread) => ({
      id: String(thread.id),
      adapter: this.kind,
      title: typeof thread.name === "string" ? thread.name : null,
      preview: String(thread.preview ?? ""),
      projectPath: String(thread.cwd ?? ""),
      createdAt: new Date(Number(thread.createdAt ?? 0) * 1000).toISOString(),
      updatedAt: new Date(Number(thread.updatedAt ?? 0) * 1000).toISOString(),
      status: this.formatThreadStatus(thread.status),
      active: this.isActiveStatus(thread.status),
      source: typeof (thread.source as Record<string, unknown>)?.kind === "string"
        ? String((thread.source as Record<string, unknown>).kind)
        : "codex"
    }));
  }

  private mapThreadEvents(sessionId: string, turns: Array<Record<string, unknown>>): SessionEvent[] {
    const events: SessionEvent[] = [];
    for (const turn of turns) {
      const turnId = String(turn.id ?? "");
      const items = Array.isArray(turn.items) ? (turn.items as Array<Record<string, unknown>>) : [];
      for (const item of items) {
        const type = String(item.type ?? "");
        if (type === "userMessage") {
          const content = Array.isArray(item.content) ? item.content : [];
          const text = content
            .filter((entry) => (entry as Record<string, unknown>).type === "text")
            .map((entry) => String((entry as Record<string, unknown>).text ?? ""))
            .join("\n");
          events.push({
            id: String(item.id),
            sessionId,
            createdAt: new Date().toISOString(),
            type: "user_message",
            turnId,
            itemId: String(item.id),
            text
          });
        } else if (type === "agentMessage") {
          events.push({
            id: String(item.id),
            sessionId,
            createdAt: new Date().toISOString(),
            type: "agent_message",
            turnId,
            itemId: String(item.id),
            text: String(item.text ?? "")
          });
        } else if (type === "commandExecution") {
          events.push({
            id: String(item.id),
            sessionId,
            createdAt: new Date().toISOString(),
            type: "command",
            turnId,
            itemId: String(item.id),
            text: String(item.command ?? ""),
            data: {
              cwd: item.cwd,
              aggregatedOutput: item.aggregatedOutput,
              exitCode: item.exitCode
            }
          });
        } else if (type === "plan") {
          events.push({
            id: String(item.id),
            sessionId,
            createdAt: new Date().toISOString(),
            type: "plan",
            turnId,
            itemId: String(item.id),
            text: String(item.text ?? "")
          });
        } else if (type === "reasoning") {
          events.push({
            id: String(item.id),
            sessionId,
            createdAt: new Date().toISOString(),
            type: "reasoning",
            turnId,
            itemId: String(item.id),
            text: Array.isArray(item.summary) ? item.summary.join("\n") : ""
          });
        } else if (type === "fileChange") {
          events.push({
            id: String(item.id),
            sessionId,
            createdAt: new Date().toISOString(),
            type: "file_change",
            turnId,
            itemId: String(item.id),
            text: `Changed ${Array.isArray(item.changes) ? item.changes.length : 0} file(s).`
          });
        }
      }
    }
    return events;
  }

  async getSession(sessionId: string): Promise<SessionDetail> {
    await this.ensureThreadLoaded(sessionId);
    const response = await this.request<{ thread: Record<string, unknown> }>("thread/read", {
      threadId: sessionId,
      includeTurns: true
    });
    const thread = response.thread;
    const turns = Array.isArray(thread.turns) ? (thread.turns as Array<Record<string, unknown>>) : [];
    return {
      session: {
        id: sessionId,
        adapter: this.kind,
        title: typeof thread.name === "string" ? thread.name : null,
        preview: String(thread.preview ?? ""),
        projectPath: String(thread.cwd ?? ""),
        createdAt: new Date(Number(thread.createdAt ?? 0) * 1000).toISOString(),
        updatedAt: new Date(Number(thread.updatedAt ?? 0) * 1000).toISOString(),
        status: this.formatThreadStatus(thread.status),
        active: this.isActiveStatus(thread.status),
        source: typeof (thread.source as Record<string, unknown>)?.kind === "string"
          ? String((thread.source as Record<string, unknown>).kind)
          : "codex"
      },
      events: this.mapThreadEvents(sessionId, turns),
      pendingApprovals: [...this.pendingApprovals.values()]
        .filter((entry) => entry.sessionId === sessionId)
        .map(({ timer: _timer, requestId: _requestId, ...approval }) => approval)
    };
  }

  async createSession(projectPath: string): Promise<SessionSummary> {
    const response = await this.request<{
      thread: Record<string, unknown>;
      cwd: string;
    }>("thread/start", {
      cwd: projectPath,
      approvalPolicy: this.config.codex.approvalPolicy,
      approvalsReviewer: "user",
      sandbox: this.config.codex.sandboxMode,
      model: this.config.codex.model,
      serviceName: "Codex Mobile",
      experimentalRawEvents: false,
      persistExtendedHistory: true
    });
    this.loadedThreads.add(String(response.thread.id));

    return {
      id: String(response.thread.id),
      adapter: this.kind,
      title: typeof response.thread.name === "string" ? response.thread.name : null,
      preview: String(response.thread.preview ?? ""),
      projectPath: String(response.cwd ?? projectPath),
      createdAt: new Date(Number(response.thread.createdAt ?? 0) * 1000).toISOString(),
      updatedAt: new Date(Number(response.thread.updatedAt ?? 0) * 1000).toISOString(),
      status: this.formatThreadStatus(response.thread.status),
      active: this.isActiveStatus(response.thread.status),
      source: "codex-mobile"
    };
  }

  async resumeSession(sessionId: string): Promise<SessionSummary> {
    const response = await this.request<{
      thread: Record<string, unknown>;
      cwd: string;
    }>("thread/resume", {
      threadId: sessionId,
      approvalPolicy: this.config.codex.approvalPolicy,
      approvalsReviewer: "user",
      sandbox: this.config.codex.sandboxMode,
      model: this.config.codex.model,
      persistExtendedHistory: true
    });
    this.loadedThreads.add(sessionId);
    return {
      id: String(response.thread.id),
      adapter: this.kind,
      title: typeof response.thread.name === "string" ? response.thread.name : null,
      preview: String(response.thread.preview ?? ""),
      projectPath: String(response.cwd ?? response.thread.cwd ?? ""),
      createdAt: new Date(Number(response.thread.createdAt ?? 0) * 1000).toISOString(),
      updatedAt: new Date(Number(response.thread.updatedAt ?? 0) * 1000).toISOString(),
      status: this.formatThreadStatus(response.thread.status),
      active: this.isActiveStatus(response.thread.status),
      source: "codex-mobile"
    };
  }

  async sendMessage(sessionId: string, text: string, attachments: MessageAttachmentInput[] = []): Promise<{ turnId: string | null }> {
    await this.ensureThreadLoaded(sessionId);
    const input: Array<Record<string, unknown>> = [];
    if (text.trim()) {
      input.push({ type: "text", text, text_elements: [] });
    }
    for (const attachment of attachments) {
      if (isImageAttachment(attachment)) {
        input.push({
          type: "image",
          url: `data:${attachment.type || "application/octet-stream"};base64,${attachment.contentBase64}`
        });
      } else if (isTextAttachment(attachment)) {
        input.push({
          type: "text",
          text: attachmentToTextContext(attachment),
          text_elements: []
        });
      } else {
        input.push({
          type: "text",
          text: attachmentToBinaryNote(attachment),
          text_elements: []
        });
      }
    }
    const response = await this.request<{ turn: { id: string } }>("turn/start", {
      threadId: sessionId,
      approvalPolicy: this.config.codex.approvalPolicy,
      approvalsReviewer: "user",
      sandboxPolicy: this.buildTurnSandboxPolicy(),
      model: this.config.codex.model,
      input
    });
    return { turnId: response.turn?.id ?? null };
  }

  private async respondToApproval(approvalId: string, body: Record<string, unknown>): Promise<void> {
    const approval = this.pendingApprovals.get(approvalId);
    if (!approval) {
      throw new HttpError(404, "approval_not_found", "Approval request not found.");
    }
    clearTimeout(approval.timer);
    this.socket?.send(JSON.stringify({ jsonrpc: "2.0", id: approval.requestId, result: body }));
    this.pendingApprovals.delete(approvalId);
    this.emit("approval-resolved", {
      sessionId: approval.sessionId,
      event: {
        id: crypto.randomUUID(),
        sessionId: approval.sessionId,
        createdAt: new Date().toISOString(),
        turnId: approval.turnId,
        itemId: approval.itemId,
        type: "approval_resolved",
        text: `Resolved approval: ${approval.summary}`,
        data: {
          approvalId,
          kind: approval.kind,
          resolution: body
        }
      }
    });
  }

  async approve(_sessionId: string, approvalId: string, payload?: Record<string, unknown>): Promise<void> {
    const approval = this.pendingApprovals.get(approvalId);
    if (!approval) {
      throw new HttpError(404, "approval_not_found", "Approval request not found.");
    }
    if (approval.kind === "command") {
      await this.respondToApproval(approvalId, { decision: payload?.decision ?? "accept" });
      return;
    }
    if (approval.kind === "file") {
      await this.respondToApproval(approvalId, { decision: payload?.decision ?? "accept" });
      return;
    }
    await this.respondToApproval(approvalId, {
      permissions: approval.data.permissions ?? {},
      scope: payload?.scope ?? "turn"
    });
  }

  async reject(_sessionId: string, approvalId: string): Promise<void> {
    const approval = this.pendingApprovals.get(approvalId);
    if (!approval) {
      throw new HttpError(404, "approval_not_found", "Approval request not found.");
    }
    if (approval.kind === "command") {
      await this.respondToApproval(approvalId, { decision: "decline" });
      return;
    }
    if (approval.kind === "file") {
      await this.respondToApproval(approvalId, { decision: "decline" });
      return;
    }
    await this.respondToApproval(approvalId, { permissions: {}, scope: "turn" });
  }

  async interrupt(sessionId: string): Promise<void> {
    const turnId = this.activeTurns.get(sessionId);
    if (!turnId) {
      throw new HttpError(409, "no_active_turn", "There is no active turn to interrupt.");
    }
    await this.request("turn/interrupt", { threadId: sessionId, turnId });
  }

  async close(): Promise<void> {
    for (const approval of this.pendingApprovals.values()) {
      clearTimeout(approval.timer);
    }
    this.pendingApprovals.clear();
    this.socket?.close();
    this.child?.kill("SIGTERM");
  }
}
