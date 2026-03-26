import { EventEmitter } from "node:events";
import { AdapterHealth, CodexAuthStatus, PendingApproval, SessionDetail, SessionEvent, SessionSummary } from "../types";

export type RuntimeEventPayload = {
  sessionId: string;
  event: SessionEvent;
};

export type ApprovalEventPayload = {
  sessionId: string;
  approval: PendingApproval;
};

export type AdapterEventMap = {
  event: [RuntimeEventPayload];
  approval: [ApprovalEventPayload];
  "approval-resolved": [RuntimeEventPayload];
};

export abstract class CodexAdapter extends EventEmitter {
  abstract readonly kind: "app-server" | "cli";
  abstract readonly capabilities: { approvals: boolean; history: boolean };
  abstract health(): Promise<AdapterHealth>;
  abstract getAuthStatus(): Promise<CodexAuthStatus>;
  abstract listSessions(): Promise<SessionSummary[]>;
  abstract getSession(sessionId: string): Promise<SessionDetail>;
  abstract createSession(projectPath: string): Promise<SessionSummary>;
  abstract resumeSession(sessionId: string): Promise<SessionSummary>;
  abstract sendMessage(sessionId: string, text: string): Promise<{ turnId: string | null }>;
  abstract approve(sessionId: string, approvalId: string, payload?: Record<string, unknown>): Promise<void>;
  abstract reject(sessionId: string, approvalId: string): Promise<void>;
  abstract interrupt(sessionId: string): Promise<void>;
  abstract close(): Promise<void>;
}

