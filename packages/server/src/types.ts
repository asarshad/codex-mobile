export type AdapterKind = "app-server" | "cli";

export type ServerConfig = {
  host: string;
  port: number;
  allowLan: boolean;
  sessionTtlDays: number;
  pairingCodeTtlMinutes: number;
};

export type ProjectsConfig = {
  allowedRoots: string[];
  scanDepth: number;
  maxProjects: number;
  markers: string[];
};

export type CodexConfig = {
  binaryPath: string;
  preferredAdapter: AdapterKind;
  approvalPolicy: "untrusted" | "on-request" | "never";
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
  model: string | null;
};

export type AppConfig = {
  server: ServerConfig;
  projects: ProjectsConfig;
  codex: CodexConfig;
  projectRoot: string;
  dataDir: string;
  configPath: string;
};

export type StoredDevice = {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
};

export type StoredAuthSession = {
  id: string;
  deviceId: string;
  secretHash: string;
  csrfToken: string;
  expiresAt: string;
  createdAt: string;
  lastSeenAt: string;
};

export type StoredSessionRecord = {
  id: string;
  adapter: AdapterKind;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
  title: string | null;
};

export type StoredCliEvent = {
  id: string;
  sessionId: string;
  createdAt: string;
  kind: string;
  text?: string;
  data?: Record<string, unknown>;
};

export type PersistedState = {
  devices: StoredDevice[];
  authSessions: StoredAuthSession[];
  sessions: StoredSessionRecord[];
  cliEvents: StoredCliEvent[];
};

export type AuthDeviceSession = {
  device: StoredDevice;
  session: StoredAuthSession;
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
  adapter: AdapterKind;
  title: string | null;
  preview: string;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  active: boolean;
  source: string;
};

export type MessageAttachmentInput = {
  name: string;
  type: string;
  size: number;
  contentBase64: string;
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

export type ApprovalKind = "command" | "file" | "permissions" | "auth";

export type PendingApproval = {
  id: string;
  sessionId: string;
  turnId: string;
  itemId: string;
  method: string;
  kind: ApprovalKind;
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

export type CodexAuthStatus = {
  loggedIn: boolean;
  authMethod: string | null;
  accountEmail: string | null;
  planType: string | null;
  requiresOpenAiAuth: boolean;
};

export type AdapterHealth = {
  available: boolean;
  kind: AdapterKind;
  reason: string | null;
  approvals: boolean;
  history: boolean;
};

export type HealthResponse = {
  ok: boolean;
  serverTime: string;
  adapter: AdapterHealth;
  fallback: AdapterHealth;
  auth: CodexAuthStatus;
};
