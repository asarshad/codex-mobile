import path from "node:path";
import crypto from "node:crypto";
import { normalizeInsideRoots } from "./paths";
import { HttpError } from "./errors";
import { StateStore } from "./store";
import { AppConfig, MessageAttachmentInput, SessionDetail, SessionEvent, SessionSummary } from "./types";
import { CodexCoordinator } from "./codex";

export class SessionService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: StateStore,
    private readonly codex: CodexCoordinator
  ) {}

  private isAllowedProject(projectPath: string): string {
    return normalizeInsideRoots(projectPath, this.config.projects.allowedRoots);
  }

  async listSessions(): Promise<SessionSummary[]> {
    const appSessions = await this.codex.appAdapter.listSessions().catch(() => []);
    const cliSessions = await this.codex.cliAdapter.listSessions();
    const persisted = this.store.listSessions();

    const merged = new Map<string, SessionSummary>();
    for (const session of [...appSessions, ...cliSessions]) {
      if (session.projectPath && this.config.projects.allowedRoots.some((root) => session.projectPath === root || session.projectPath.startsWith(`${root}${path.sep}`))) {
        merged.set(session.id, session);
      }
    }
    for (const persistedSession of persisted) {
      if (!merged.has(persistedSession.id)) {
        merged.set(persistedSession.id, {
          id: persistedSession.id,
          adapter: persistedSession.adapter,
          title: persistedSession.title,
          preview: "",
          projectPath: persistedSession.projectPath,
          createdAt: persistedSession.createdAt,
          updatedAt: persistedSession.updatedAt,
          status: "idle",
          active: false,
          source: persistedSession.adapter === "cli" ? "codex-cli" : "codex-mobile"
        });
      }
    }

    return [...merged.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createSession(projectPath: string, existingSessionId?: string): Promise<SessionSummary> {
    const validatedPath = this.isAllowedProject(projectPath);
    if (existingSessionId) {
      return this.resumeSession(existingSessionId);
    }

    const adapter = await this.codex.preferredAdapter();
    const session = await adapter.createSession(validatedPath);
    this.store.upsertSession({
      id: session.id,
      adapter: session.adapter,
      projectPath: session.projectPath,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      title: session.title
    });
    return session;
  }

  async resumeSession(sessionId: string): Promise<SessionSummary> {
    const existing = (await this.listSessions()).find((entry) => entry.id === sessionId);
    if (!existing) {
      throw new HttpError(404, "session_not_found", "Session not found.");
    }
    const adapter = this.codex.adapterForSession(existing);
    const session = await adapter.resumeSession(sessionId);
    this.store.upsertSession({
      id: session.id,
      adapter: session.adapter,
      projectPath: session.projectPath,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      title: session.title
    });
    return session;
  }

  async getSession(sessionId: string): Promise<SessionDetail> {
    const existing = (await this.listSessions()).find((entry) => entry.id === sessionId);
    if (!existing) {
      throw new HttpError(404, "session_not_found", "Session not found.");
    }

    const detail = await this.codex.adapterForSession(existing).getSession(sessionId);
    detail.events = this.sortEvents(detail.events);
    return detail;
  }

  private sortEvents(events: SessionEvent[]): SessionEvent[] {
    return [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async sendMessage(sessionId: string, text: string, attachments: MessageAttachmentInput[] = []): Promise<{ turnId: string | null }> {
    const existing = (await this.listSessions()).find((entry) => entry.id === sessionId);
    if (!existing) {
      throw new HttpError(404, "session_not_found", "Session not found.");
    }

    const now = new Date().toISOString();
    const userEvent: SessionEvent = {
      id: crypto.randomUUID(),
      sessionId,
      createdAt: now,
      type: "user_message",
      text,
      data: attachments.length > 0 ? {
        attachments: attachments.map((attachment) => ({
          name: attachment.name,
          type: attachment.type,
          size: attachment.size
        }))
      } : undefined
    };

    this.codex.adapterForSession(existing).emit("event", { sessionId, event: userEvent });
    const response = await this.codex.adapterForSession(existing).sendMessage(sessionId, text, attachments);
    this.store.upsertSession({
      id: existing.id,
      adapter: existing.adapter,
      projectPath: existing.projectPath,
      createdAt: existing.createdAt,
      updatedAt: now,
      title: existing.title
    });
    return response;
  }

  async approve(sessionId: string, approvalId: string, payload?: Record<string, unknown>): Promise<void> {
    const detail = await this.getSession(sessionId);
    await this.codex.adapterForSession(detail.session).approve(sessionId, approvalId, payload);
  }

  async reject(sessionId: string, approvalId: string): Promise<void> {
    const detail = await this.getSession(sessionId);
    await this.codex.adapterForSession(detail.session).reject(sessionId, approvalId);
  }

  async interrupt(sessionId: string): Promise<void> {
    const detail = await this.getSession(sessionId);
    await this.codex.adapterForSession(detail.session).interrupt(sessionId);
  }
}
