import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { AppConfig, AdapterHealth, CodexAuthStatus, MessageAttachmentInput, SessionDetail, SessionEvent, SessionSummary } from "../types";
import { HttpError } from "../errors";
import { StateStore } from "../store";
import { CodexAdapter } from "./types";
import { attachmentToBinaryNote, attachmentToTextContext, isImageAttachment, isTextAttachment } from "../attachments";

type CliSummary = {
  threadId: string | null;
  preview: string;
  events: SessionEvent[];
};

export class CliAdapter extends CodexAdapter {
  readonly kind = "cli" as const;
  readonly capabilities = { approvals: false, history: false };

  constructor(
    private readonly config: AppConfig,
    private readonly store: StateStore
  ) {
    super();
  }

  private async runJsonCommand(args: string[], cwd?: string): Promise<CliSummary> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.codex.binaryPath, args, {
        cwd: cwd ?? this.config.projectRoot,
        env: {
          ...process.env,
          PATH: process.env.PATH
        }
      });

      const events: SessionEvent[] = [];
      let stdout = "";
      let stderr = "";
      let threadId: string | null = null;
      let agentText = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
        const lines = stdout.split("\n");
        stdout = lines.pop() ?? "";
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("{")) {
            continue;
          }
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            const type = String(parsed.type ?? "");
            if (type === "thread.started") {
              threadId = String(parsed.thread_id ?? "");
            } else if (type === "agent_message.delta") {
              agentText += String(parsed.delta ?? "");
              events.push({
                id: crypto.randomUUID(),
                sessionId: threadId ?? "pending",
                createdAt: new Date().toISOString(),
                type: "agent_delta",
                text: String(parsed.delta ?? "")
              });
            } else if (type === "agent_message.completed") {
              agentText = String(parsed.text ?? agentText);
            }
          } catch {
            continue;
          }
        }
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      child.on("close", (code) => {
        if (code !== 0) {
          reject(new HttpError(502, "cli_failed", stderr.trim() || "Codex CLI command failed."));
          return;
        }

        if (agentText) {
          events.push({
            id: crypto.randomUUID(),
            sessionId: threadId ?? "pending",
            createdAt: new Date().toISOString(),
            type: "agent_message",
            text: agentText
          });
        }

        resolve({
          threadId,
          preview: agentText.slice(0, 160),
          events
        });
      });
    });
  }

  async health(): Promise<AdapterHealth> {
    return { available: true, kind: this.kind, reason: null, approvals: false, history: false };
  }

  async getAuthStatus(): Promise<CodexAuthStatus> {
    return new Promise((resolve) => {
      const child = spawn(this.config.codex.binaryPath, ["login", "status"], {
        cwd: this.config.projectRoot
      });

      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk.toString("utf8");
      });
      child.on("close", () => {
        const loggedIn = output.includes("Logged in");
        resolve({
          loggedIn,
          authMethod: loggedIn && output.includes("ChatGPT") ? "chatgpt" : null,
          accountEmail: null,
          planType: null,
          requiresOpenAiAuth: !loggedIn
        });
      });
    });
  }

  async listSessions(): Promise<SessionSummary[]> {
    return this.store.listSessions()
      .filter((entry) => entry.adapter === "cli")
      .map((entry) => ({
        id: entry.id,
        adapter: "cli",
        title: entry.title,
        preview: "",
        projectPath: entry.projectPath,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        status: "idle",
        active: false,
        source: "codex-cli"
      }));
  }

  async getSession(sessionId: string): Promise<SessionDetail> {
    const session = this.store.listSessions().find((entry) => entry.id === sessionId);
    if (!session) {
      throw new HttpError(404, "session_not_found", "Session not found.");
    }

    return {
      session: {
        id: session.id,
        adapter: "cli",
        title: session.title,
        preview: "",
        projectPath: session.projectPath,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        status: "idle",
        active: false,
        source: "codex-cli"
      },
      events: this.store.listCliEvents(sessionId).map((entry) => ({
        id: entry.id,
        sessionId: entry.sessionId,
        createdAt: entry.createdAt,
        type: entry.kind as SessionEvent["type"],
        text: entry.text,
        data: entry.data
      })),
      pendingApprovals: []
    };
  }

  async createSession(projectPath: string): Promise<SessionSummary> {
    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();
    this.store.upsertSession({
      id: sessionId,
      adapter: "cli",
      projectPath,
      createdAt: now,
      updatedAt: now,
      title: path.basename(projectPath)
    });

    return {
      id: sessionId,
      adapter: "cli",
      title: path.basename(projectPath),
      preview: "",
      projectPath,
      createdAt: now,
      updatedAt: now,
      status: "idle",
      active: false,
      source: "codex-cli"
    };
  }

  async resumeSession(sessionId: string): Promise<SessionSummary> {
    const session = this.store.listSessions().find((entry) => entry.id === sessionId);
    if (!session) {
      throw new HttpError(404, "session_not_found", "Session not found.");
    }
    return {
      id: session.id,
      adapter: "cli",
      title: session.title,
      preview: "",
      projectPath: session.projectPath,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      status: "idle",
      active: false,
      source: "codex-cli"
    };
  }

  async sendMessage(sessionId: string, text: string, attachments: MessageAttachmentInput[] = []): Promise<{ turnId: string | null }> {
    const session = this.store.listSessions().find((entry) => entry.id === sessionId);
    if (!session) {
      throw new HttpError(404, "session_not_found", "Session not found.");
    }

    const attachmentContext = attachments.map((attachment) => {
      if (isTextAttachment(attachment)) {
        return attachmentToTextContext(attachment);
      }
      if (isImageAttachment(attachment)) {
        return `Attached image: ${attachment.name} (${attachment.type}, ${attachment.size} bytes). Image attachments are best supported through the App Server path.`;
      }
      return attachmentToBinaryNote(attachment);
    }).join("\n\n");

    const summary = await this.runJsonCommand([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "-C",
      session.projectPath,
      attachmentContext ? `${text}\n\n${attachmentContext}` : text
    ], session.projectPath);

    for (const event of summary.events) {
      const cliEvent = {
        id: event.id,
        sessionId,
        createdAt: event.createdAt,
        kind: event.type,
        text: event.text,
        data: event.data
      };
      this.store.appendCliEvent(cliEvent);
      this.emit("event", { sessionId, event: { ...event, sessionId } });
    }

    this.store.upsertSession({
      ...session,
      updatedAt: new Date().toISOString()
    });

    return { turnId: summary.threadId };
  }

  async approve(): Promise<void> {
    throw new HttpError(409, "approval_unsupported", "CLI fallback does not support interactive approvals.");
  }

  async reject(): Promise<void> {
    throw new HttpError(409, "approval_unsupported", "CLI fallback does not support interactive approvals.");
  }

  async interrupt(): Promise<void> {
    throw new HttpError(409, "interrupt_unsupported", "CLI fallback runs one turn at a time.");
  }

  async close(): Promise<void> {}
}
