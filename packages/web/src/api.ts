import { AuthStatusResponse, ProjectInfo, SessionDetail, SessionSummary } from "./types";

type RequestOptions = {
  method?: string;
  csrfToken?: string | null;
  body?: unknown;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.csrfToken ? { "X-CSRF-Token": options.csrfToken } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "include"
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message ?? "Request failed.");
  }

  return response.json() as Promise<T>;
}

export const api = {
  getAuthStatus: () => request<AuthStatusResponse>("/api/auth/status"),
  startPairing: () => request<{ pairingId: string; expiresAt: string }>("/api/pair/start", { method: "POST" }),
  verifyPairing: (pairingId: string, code: string, deviceName: string) =>
    request<{ paired: boolean; csrfToken: string }>("/api/pair/verify", {
      method: "POST",
      body: { pairingId, code, deviceName }
    }),
  getProjects: (csrfToken: string) =>
    request<{ projects: ProjectInfo[] }>("/api/projects", { csrfToken }),
  getSessions: (csrfToken: string) =>
    request<{ sessions: SessionSummary[] }>("/api/sessions", { csrfToken }),
  createSession: (csrfToken: string, projectPath?: string, sessionId?: string) =>
    request<{ session: SessionSummary }>("/api/sessions", {
      method: "POST",
      csrfToken,
      body: { projectPath, sessionId }
    }),
  getSession: (csrfToken: string, sessionId: string) =>
    request<SessionDetail>(`/api/sessions/${sessionId}`, { csrfToken }),
  sendMessage: (csrfToken: string, sessionId: string, text: string) =>
    request<{ turnId: string | null }>(`/api/sessions/${sessionId}/message`, {
      method: "POST",
      csrfToken,
      body: { text }
    }),
  approve: (csrfToken: string, sessionId: string, approvalId: string, payload: Record<string, unknown> = {}) =>
    request<{ ok: true }>(`/api/sessions/${sessionId}/approve`, {
      method: "POST",
      csrfToken,
      body: { approvalId, ...payload }
    }),
  reject: (csrfToken: string, sessionId: string, approvalId: string) =>
    request<{ ok: true }>(`/api/sessions/${sessionId}/reject`, {
      method: "POST",
      csrfToken,
      body: { approvalId }
    }),
  interrupt: (csrfToken: string, sessionId: string) =>
    request<{ ok: true }>(`/api/sessions/${sessionId}/interrupt`, {
      method: "POST",
      csrfToken
    })
};

