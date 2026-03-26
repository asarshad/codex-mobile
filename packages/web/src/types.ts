export type DeviceInfo = {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
};

export type CodexAuthStatus = {
  loggedIn: boolean;
  authMethod: string | null;
  accountEmail: string | null;
  planType: string | null;
  requiresOpenAiAuth: boolean;
};

export type AuthStatusResponse = {
  paired: boolean;
  device: DeviceInfo | null;
  csrfToken: string | null;
  codexAuth: CodexAuthStatus;
  config: {
    serverUrl: string;
    allowLan: boolean;
  };
};

export type ProjectInfo = {
  id: string;
  name: string;
  path: string;
  root: string;
  relativePath: string;
  recentSessionId: string | null;
};

export type SessionSummary = {
  id: string;
  adapter: "app-server" | "cli";
  title: string | null;
  preview: string;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  active: boolean;
  source: string;
};

export type SessionEvent = {
  id: string;
  sessionId: string;
  createdAt: string;
  type:
    | "status"
    | "user_message"
    | "agent_message"
    | "agent_delta"
    | "command"
    | "command_output"
    | "file_change"
    | "plan"
    | "reasoning"
    | "approval"
    | "approval_resolved"
    | "error"
    | "system";
  turnId?: string;
  itemId?: string;
  text?: string;
  data?: Record<string, unknown>;
};

export type PendingApproval = {
  id: string;
  sessionId: string;
  turnId: string;
  itemId: string;
  method: string;
  kind: "command" | "file" | "permissions" | "auth";
  createdAt: string;
  expiresAt: string;
  summary: string;
  detail?: string;
  data: Record<string, unknown>;
};

export type SessionDetail = {
  session: SessionSummary;
  events: SessionEvent[];
  pendingApprovals: PendingApproval[];
};

