async function request(path, options = {}) {
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
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "Request failed.");
    }
    return response.json();
}
export const api = {
    getAuthStatus: () => request("/api/auth/status"),
    startPairing: () => request("/api/pair/start", { method: "POST" }),
    verifyPairing: (pairingId, code, deviceName) => request("/api/pair/verify", {
        method: "POST",
        body: { pairingId, code, deviceName }
    }),
    getProjects: (csrfToken) => request("/api/projects", { csrfToken }),
    getSessions: (csrfToken) => request("/api/sessions", { csrfToken }),
    createSession: (csrfToken, projectPath, sessionId) => request("/api/sessions", {
        method: "POST",
        csrfToken,
        body: { projectPath, sessionId }
    }),
    getSession: (csrfToken, sessionId) => request(`/api/sessions/${sessionId}`, { csrfToken }),
    sendMessage: (csrfToken, sessionId, text) => request(`/api/sessions/${sessionId}/message`, {
        method: "POST",
        csrfToken,
        body: { text }
    }),
    approve: (csrfToken, sessionId, approvalId, payload = {}) => request(`/api/sessions/${sessionId}/approve`, {
        method: "POST",
        csrfToken,
        body: { approvalId, ...payload }
    }),
    reject: (csrfToken, sessionId, approvalId) => request(`/api/sessions/${sessionId}/reject`, {
        method: "POST",
        csrfToken,
        body: { approvalId }
    }),
    interrupt: (csrfToken, sessionId) => request(`/api/sessions/${sessionId}/interrupt`, {
        method: "POST",
        csrfToken
    })
};
