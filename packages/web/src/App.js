import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "./api";
const THEME_STORAGE_KEY = "codex-mobile-theme";
const SERVER_URL_STORAGE_KEY = "codex-mobile-server-url";
function useTheme() {
    const [theme, setTheme] = useState(() => localStorage.getItem(THEME_STORAGE_KEY) ?? "light");
    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    }, [theme]);
    return { theme, setTheme };
}
function Shell({ children, title }) {
    const location = useLocation();
    return (_jsxs("div", { className: "app-shell", children: [_jsxs("header", { className: "topbar", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "Codex Mobile" }), _jsx("h1", { children: title })] }), _jsx("span", { className: "badge subtle", children: navigator.onLine ? "Online" : "Offline" })] }), _jsx("main", { className: "page", children: children }), _jsxs("nav", { className: "tabbar", children: [_jsx(Link, { className: location.pathname === "/" ? "active" : "", to: "/", children: "Home" }), _jsx(Link, { className: location.pathname.startsWith("/settings") ? "active" : "", to: "/settings", children: "Settings" })] })] }));
}
function StatusRow({ label, value, tone = "default" }) {
    return (_jsxs("div", { className: "status-row", children: [_jsx("span", { children: label }), _jsx("span", { className: `badge ${tone}`, children: value })] }));
}
function PairingCard({ onPaired }) {
    const [pairingId, setPairingId] = useState(null);
    const [expiresAt, setExpiresAt] = useState(null);
    const [code, setCode] = useState("");
    const [deviceName, setDeviceName] = useState("iPhone");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const start = async () => {
        setBusy(true);
        setError(null);
        try {
            const response = await api.startPairing();
            setPairingId(response.pairingId);
            setExpiresAt(response.expiresAt);
        }
        catch (startError) {
            setError(startError instanceof Error ? startError.message : "Could not start pairing.");
        }
        finally {
            setBusy(false);
        }
    };
    const verify = async (event) => {
        event.preventDefault();
        if (!pairingId) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const response = await api.verifyPairing(pairingId, code, deviceName);
            await onPaired(response.csrfToken);
        }
        catch (verifyError) {
            setError(verifyError instanceof Error ? verifyError.message : "Pairing failed.");
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs("section", { className: "card stack", children: [_jsxs("div", { children: [_jsx("h2", { children: "Pair This Phone" }), _jsx("p", { className: "muted", children: "Start pairing here, then type the one-time code shown in the Mac terminal." })] }), !pairingId ? (_jsx("button", { className: "button primary", onClick: start, disabled: busy, children: busy ? "Generating..." : "Generate One-Time Code" })) : (_jsxs("form", { className: "stack", onSubmit: verify, children: [_jsxs("div", { className: "field", children: [_jsx("label", { children: "Mac pairing status" }), _jsxs("div", { className: "inline-note", children: ["Code active until ", expiresAt ? new Date(expiresAt).toLocaleTimeString() : "soon", "."] })] }), _jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "device-name", children: "Device name" }), _jsx("input", { id: "device-name", value: deviceName, onChange: (event) => setDeviceName(event.target.value) })] }), _jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "pairing-code", children: "One-time code" }), _jsx("input", { id: "pairing-code", inputMode: "numeric", placeholder: "123456", value: code, onChange: (event) => setCode(event.target.value) })] }), _jsx("button", { className: "button primary", type: "submit", disabled: busy || code.length < 6, children: busy ? "Verifying..." : "Pair Device" })] })), error ? _jsx("p", { className: "error-text", children: error }) : null] }));
}
function HomePage({ authStatus, csrfToken, projects, sessions, refreshData }) {
    const navigate = useNavigate();
    const [manualPath, setManualPath] = useState("");
    const [busyPath, setBusyPath] = useState(false);
    const [error, setError] = useState(null);
    const createSession = async (projectPath, sessionId) => {
        if (!csrfToken) {
            return;
        }
        setError(null);
        setBusyPath(true);
        try {
            const response = await api.createSession(csrfToken, projectPath, sessionId);
            await refreshData();
            navigate(`/sessions/${response.session.id}`);
        }
        catch (createError) {
            setError(createError instanceof Error ? createError.message : "Could not open session.");
        }
        finally {
            setBusyPath(false);
        }
    };
    if (!authStatus?.paired) {
        return (_jsx(Shell, { title: "Home", children: _jsx(PairingCard, { onPaired: async () => {
                    window.location.reload();
                } }) }));
    }
    return (_jsxs(Shell, { title: "Home", children: [_jsxs("section", { className: "card stack", children: [_jsx("h2", { children: "Status" }), _jsx(StatusRow, { label: "Pairing", value: "Paired", tone: "good" }), _jsx(StatusRow, { label: "Codex login", value: authStatus.codexAuth.loggedIn ? authStatus.codexAuth.authMethod ?? "Logged in" : "Not logged in", tone: authStatus.codexAuth.loggedIn ? "good" : "warn" }), _jsx(StatusRow, { label: "Server", value: window.location.origin })] }), _jsxs("section", { className: "card stack", children: [_jsxs("div", { className: "section-header", children: [_jsxs("div", { children: [_jsx("h2", { children: "Projects" }), _jsx("p", { className: "muted", children: "Whitelisted folders on the Mac." })] }), _jsx("button", { className: "button ghost", onClick: () => void refreshData(), children: "Refresh" })] }), _jsx("div", { className: "stack compact", children: projects.map((project) => (_jsxs("button", { className: "project-card", onClick: () => void createSession(project.path), children: [_jsx("span", { children: project.name }), _jsx("small", { children: project.relativePath })] }, project.id))) }), _jsxs("form", { className: "inline-form", onSubmit: (event) => {
                            event.preventDefault();
                            void createSession(manualPath);
                        }, children: [_jsx("input", { placeholder: "/Users/ra/dev/projects/my-app", value: manualPath, onChange: (event) => setManualPath(event.target.value) }), _jsx("button", { className: "button secondary", type: "submit", disabled: busyPath || !manualPath.trim(), children: "Open" })] }), _jsx("p", { className: "muted", children: "Manual paths are only accepted when they stay inside allowed roots." })] }), _jsxs("section", { className: "card stack", children: [_jsx("h2", { children: "Recent Sessions" }), _jsxs("div", { className: "stack compact", children: [sessions.length === 0 ? _jsx("p", { className: "muted", children: "No sessions yet." }) : null, sessions.map((session) => (_jsxs("button", { className: "session-card", onClick: () => void createSession(undefined, session.id), children: [_jsxs("div", { children: [_jsx("strong", { children: session.title || session.projectPath.split("/").pop() }), _jsx("p", { children: session.projectPath })] }), _jsxs("div", { className: "session-meta", children: [_jsx("span", { className: `badge ${session.active ? "good" : "subtle"}`, children: session.status }), _jsx("small", { children: new Date(session.updatedAt).toLocaleString() })] })] }, session.id)))] })] }), error ? _jsx("p", { className: "error-text", children: error }) : null] }));
}
function renderEvent(event) {
    if (event.type === "command") {
        return (_jsxs("div", { className: "event-card command", children: [_jsx("div", { className: "event-meta", children: "Command" }), _jsx("pre", { children: event.text }), event.data?.aggregatedOutput ? _jsx("code", { children: String(event.data.aggregatedOutput) }) : null] }));
    }
    if (event.type === "command_output" || event.type === "agent_delta") {
        return (_jsxs("div", { className: "event-card stream", children: [_jsx("div", { className: "event-meta", children: event.type === "agent_delta" ? "Streaming reply" : "Command output" }), _jsx("pre", { children: event.text })] }));
    }
    const label = event.type.replace("_", " ");
    return (_jsxs("div", { className: `event-card ${event.type}`, children: [_jsx("div", { className: "event-meta", children: label }), _jsx("p", { children: event.text || JSON.stringify(event.data ?? {}) })] }));
}
function ApprovalCard({ approval, csrfToken, onResolved }) {
    const [busy, setBusy] = useState(false);
    const approve = async () => {
        setBusy(true);
        try {
            await api.approve(csrfToken, approval.sessionId, approval.id, approval.kind === "permissions" ? { scope: "turn" } : {});
            await onResolved();
        }
        finally {
            setBusy(false);
        }
    };
    const reject = async () => {
        setBusy(true);
        try {
            await api.reject(csrfToken, approval.sessionId, approval.id);
            await onResolved();
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs("div", { className: "approval-card", children: [_jsxs("div", { children: [_jsx("strong", { children: approval.summary }), approval.detail ? _jsx("p", { children: approval.detail }) : null, _jsxs("small", { children: ["Expires ", new Date(approval.expiresAt).toLocaleTimeString()] })] }), _jsxs("div", { className: "approval-actions", children: [_jsx("button", { className: "button secondary", onClick: reject, disabled: busy, children: "Reject" }), _jsx("button", { className: "button primary", onClick: approve, disabled: busy, children: "Approve" })] })] }));
}
function SessionPage({ csrfToken }) {
    const params = useParams();
    const sessionId = params.id;
    const [detail, setDetail] = useState(null);
    const [message, setMessage] = useState("");
    const [error, setError] = useState(null);
    const [connected, setConnected] = useState(false);
    const [sending, setSending] = useState(false);
    const socketRef = useRef(null);
    const refresh = async () => {
        const session = await api.getSession(csrfToken, sessionId);
        setDetail(session);
    };
    useEffect(() => {
        void refresh().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Could not load session."));
    }, [csrfToken, sessionId]);
    useEffect(() => {
        const protocol = window.location.protocol === "https:" ? "wss" : "ws";
        let cancelled = false;
        let reconnectTimer = null;
        const connect = () => {
            const socket = new WebSocket(`${protocol}://${window.location.host}/api/events?sessionId=${encodeURIComponent(sessionId)}&csrfToken=${encodeURIComponent(csrfToken)}`);
            socketRef.current = socket;
            socket.onopen = () => {
                setConnected(true);
            };
            socket.onmessage = (event) => {
                try {
                    const payload = JSON.parse(event.data);
                    if (payload.type === "session_event" && payload.event) {
                        setDetail((previous) => previous ? { ...previous, events: [...previous.events, payload.event] } : previous);
                    }
                    if (payload.type === "approval" && payload.approval) {
                        setDetail((previous) => previous ? { ...previous, pendingApprovals: [...previous.pendingApprovals, payload.approval] } : previous);
                    }
                }
                catch {
                    return;
                }
            };
            socket.onclose = () => {
                setConnected(false);
                if (!cancelled) {
                    reconnectTimer = window.setTimeout(connect, 1500);
                }
            };
            socket.onerror = () => {
                socket.close();
            };
        };
        connect();
        return () => {
            cancelled = true;
            if (reconnectTimer) {
                window.clearTimeout(reconnectTimer);
            }
            socketRef.current?.close();
        };
    }, [csrfToken, sessionId]);
    const mergedEvents = useMemo(() => detail?.events ?? [], [detail?.events]);
    const sendMessage = async (event) => {
        event.preventDefault();
        if (!message.trim()) {
            return;
        }
        setSending(true);
        setError(null);
        try {
            await api.sendMessage(csrfToken, sessionId, message.trim());
            setMessage("");
            await refresh();
        }
        catch (sendError) {
            setError(sendError instanceof Error ? sendError.message : "Could not send message.");
        }
        finally {
            setSending(false);
        }
    };
    return (_jsxs(Shell, { title: detail?.session.title || "Session", children: [_jsxs("section", { className: "card stack", children: [_jsx(StatusRow, { label: "Project", value: detail?.session.projectPath ?? "Loading..." }), _jsx(StatusRow, { label: "Transport", value: detail?.session.adapter ?? "Unknown", tone: detail?.session.adapter === "app-server" ? "good" : "warn" }), _jsx(StatusRow, { label: "Events", value: connected ? "Live" : "Reconnecting", tone: connected ? "good" : "warn" }), _jsxs("div", { className: "inline-actions", children: [_jsx("button", { className: "button ghost", onClick: () => void refresh(), children: "Refresh" }), _jsx("button", { className: "button ghost", onClick: () => void api.interrupt(csrfToken, sessionId).then(refresh), children: "Interrupt" })] })] }), detail?.pendingApprovals.length ? (_jsxs("section", { className: "card stack", children: [_jsx("h2", { children: "Approvals" }), detail.pendingApprovals.map((approval) => (_jsx(ApprovalCard, { approval: approval, csrfToken: csrfToken, onResolved: refresh }, approval.id)))] })) : null, _jsxs("section", { className: "card stack", children: [_jsx("h2", { children: "Output" }), _jsx("div", { className: "events", children: mergedEvents.map((event) => (_jsx("div", { children: renderEvent(event) }, `${event.id}-${event.createdAt}`))) })] }), _jsxs("form", { className: "composer", onSubmit: sendMessage, children: [_jsx("textarea", { placeholder: "Ask Codex to inspect, edit, review, or continue the session...", value: message, onChange: (event) => setMessage(event.target.value), rows: 4 }), _jsx("button", { className: "button primary", type: "submit", disabled: sending || !message.trim(), children: sending ? "Sending..." : "Send" })] }), error ? _jsx("p", { className: "error-text", children: error }) : null] }));
}
function SettingsPage({ authStatus, theme, setTheme }) {
    const [serverUrl, setServerUrl] = useState(localStorage.getItem(SERVER_URL_STORAGE_KEY) ?? window.location.origin);
    const [saved, setSaved] = useState(false);
    return (_jsxs(Shell, { title: "Settings", children: [_jsxs("section", { className: "card stack", children: [_jsx("h2", { children: "Server URL" }), _jsx("input", { value: serverUrl, onChange: (event) => setServerUrl(event.target.value) }), _jsx("button", { className: "button secondary", onClick: () => {
                            localStorage.setItem(SERVER_URL_STORAGE_KEY, serverUrl);
                            setSaved(true);
                            if (serverUrl && serverUrl !== window.location.origin) {
                                window.location.href = serverUrl;
                            }
                        }, children: "Save" }), saved ? _jsx("p", { className: "muted", children: "Saved." }) : null] }), _jsxs("section", { className: "card stack", children: [_jsx("h2", { children: "Appearance" }), _jsxs("div", { className: "inline-actions", children: [_jsx("button", { className: `button ${theme === "light" ? "primary" : "secondary"}`, onClick: () => setTheme("light"), children: "Light" }), _jsx("button", { className: `button ${theme === "dark" ? "primary" : "secondary"}`, onClick: () => setTheme("dark"), children: "Dark" })] })] }), _jsxs("section", { className: "card stack", children: [_jsx("h2", { children: "Paired Device" }), authStatus?.device ? (_jsxs(_Fragment, { children: [_jsx(StatusRow, { label: "Name", value: authStatus.device.name }), _jsx(StatusRow, { label: "Last seen", value: new Date(authStatus.device.lastSeenAt).toLocaleString() })] })) : (_jsx("p", { className: "muted", children: "This browser is not paired yet." }))] })] }));
}
export default function App() {
    const [authStatus, setAuthStatus] = useState(null);
    const [projects, setProjects] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [error, setError] = useState(null);
    const { theme, setTheme } = useTheme();
    const refreshData = async () => {
        const auth = await api.getAuthStatus();
        setAuthStatus(auth);
        if (auth.paired && auth.csrfToken) {
            const [projectResponse, sessionResponse] = await Promise.all([
                api.getProjects(auth.csrfToken),
                api.getSessions(auth.csrfToken)
            ]);
            setProjects(projectResponse.projects);
            setSessions(sessionResponse.sessions);
        }
        else {
            setProjects([]);
            setSessions([]);
        }
    };
    useEffect(() => {
        void refreshData().catch((loadError) => {
            setError(loadError instanceof Error ? loadError.message : "Could not load app data.");
        });
    }, []);
    return (_jsxs(BrowserRouter, { children: [error ? _jsx("div", { className: "global-error", children: error }) : null, _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(HomePage, { authStatus: authStatus, csrfToken: authStatus?.csrfToken ?? null, projects: projects, sessions: sessions, refreshData: refreshData }) }), _jsx(Route, { path: "/sessions/:id", element: authStatus?.csrfToken ? _jsx(SessionPage, { csrfToken: authStatus.csrfToken }) : _jsx(Shell, { title: "Session", children: _jsx("p", { className: "muted", children: "Pair this phone first." }) }) }), _jsx(Route, { path: "/settings", element: _jsx(SettingsPage, { authStatus: authStatus, theme: theme, setTheme: setTheme }) })] })] }));
}
