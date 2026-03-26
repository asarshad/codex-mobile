import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "./api";
import { AuthStatusResponse, PendingApproval, ProjectInfo, SessionDetail, SessionEvent, SessionSummary } from "./types";

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

function Shell({
  children,
  title
}: {
  children: React.ReactNode;
  title: string;
}) {
  const location = useLocation();
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Codex Mobile</p>
          <h1>{title}</h1>
        </div>
        <span className="badge subtle">{navigator.onLine ? "Online" : "Offline"}</span>
      </header>
      <main className="page">{children}</main>
      <nav className="tabbar">
        <Link className={location.pathname === "/" ? "active" : ""} to="/">Home</Link>
        <Link className={location.pathname.startsWith("/settings") ? "active" : ""} to="/settings">Settings</Link>
      </nav>
    </div>
  );
}

function StatusRow({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "good" | "warn" }) {
  return (
    <div className="status-row">
      <span>{label}</span>
      <span className={`badge ${tone}`}>{value}</span>
    </div>
  );
}

function PairingCard({
  onPaired
}: {
  onPaired: (csrfToken: string) => Promise<void>;
}) {
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("iPhone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.startPairing();
      setPairingId(response.pairingId);
      setExpiresAt(response.expiresAt);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start pairing.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (!pairingId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await api.verifyPairing(pairingId, code, deviceName);
      await onPaired(response.csrfToken);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Pairing failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack">
      <div>
        <h2>Pair This Phone</h2>
        <p className="muted">Start pairing here, then type the one-time code shown in the Mac terminal.</p>
      </div>
      {!pairingId ? (
        <button className="button primary" onClick={start} disabled={busy}>
          {busy ? "Generating..." : "Generate One-Time Code"}
        </button>
      ) : (
        <form className="stack" onSubmit={verify}>
          <div className="field">
            <label>Mac pairing status</label>
            <div className="inline-note">Code active until {expiresAt ? new Date(expiresAt).toLocaleTimeString() : "soon"}.</div>
          </div>
          <div className="field">
            <label htmlFor="device-name">Device name</label>
            <input id="device-name" value={deviceName} onChange={(event) => setDeviceName(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pairing-code">One-time code</label>
            <input
              id="pairing-code"
              inputMode="numeric"
              placeholder="123456"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <button className="button primary" type="submit" disabled={busy || code.length < 6}>
            {busy ? "Verifying..." : "Pair Device"}
          </button>
        </form>
      )}
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}

function HomePage({
  authStatus,
  csrfToken,
  projects,
  sessions,
  refreshData
}: {
  authStatus: AuthStatusResponse | null;
  csrfToken: string | null;
  projects: ProjectInfo[];
  sessions: SessionSummary[];
  refreshData: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [manualPath, setManualPath] = useState("");
  const [busyPath, setBusyPath] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createSession = async (projectPath?: string, sessionId?: string) => {
    if (!csrfToken) {
      return;
    }
    setError(null);
    setBusyPath(true);
    try {
      const response = await api.createSession(csrfToken, projectPath, sessionId);
      await refreshData();
      navigate(`/sessions/${response.session.id}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not open session.");
    } finally {
      setBusyPath(false);
    }
  };

  if (!authStatus?.paired) {
    return (
      <Shell title="Home">
        <PairingCard onPaired={async () => {
          window.location.reload();
        }} />
      </Shell>
    );
  }

  return (
    <Shell title="Home">
      <section className="card stack">
        <h2>Status</h2>
        <StatusRow label="Pairing" value="Paired" tone="good" />
        <StatusRow
          label="Codex login"
          value={authStatus.codexAuth.loggedIn ? authStatus.codexAuth.authMethod ?? "Logged in" : "Not logged in"}
          tone={authStatus.codexAuth.loggedIn ? "good" : "warn"}
        />
        <StatusRow label="Server" value={window.location.origin} />
      </section>

      <section className="card stack">
        <div className="section-header">
          <div>
            <h2>Projects</h2>
            <p className="muted">Whitelisted folders on the Mac.</p>
          </div>
          <button className="button ghost" onClick={() => void refreshData()}>Refresh</button>
        </div>
        <div className="stack compact">
          {projects.map((project) => (
            <button key={project.id} className="project-card" onClick={() => void createSession(project.path)}>
              <span>{project.name}</span>
              <small>{project.relativePath}</small>
            </button>
          ))}
        </div>
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void createSession(manualPath);
          }}
        >
          <input
            placeholder="/Users/ra/dev/projects/my-app"
            value={manualPath}
            onChange={(event) => setManualPath(event.target.value)}
          />
          <button className="button secondary" type="submit" disabled={busyPath || !manualPath.trim()}>
            Open
          </button>
        </form>
        <p className="muted">Manual paths are only accepted when they stay inside allowed roots.</p>
      </section>

      <section className="card stack">
        <h2>Recent Sessions</h2>
        <div className="stack compact">
          {sessions.length === 0 ? <p className="muted">No sessions yet.</p> : null}
          {sessions.map((session) => (
            <button key={session.id} className="session-card" onClick={() => void createSession(undefined, session.id)}>
              <div>
                <strong>{session.title || session.projectPath.split("/").pop()}</strong>
                <p>{session.projectPath}</p>
              </div>
              <div className="session-meta">
                <span className={`badge ${session.active ? "good" : "subtle"}`}>{session.status}</span>
                <small>{new Date(session.updatedAt).toLocaleString()}</small>
              </div>
            </button>
          ))}
        </div>
      </section>
      {error ? <p className="error-text">{error}</p> : null}
    </Shell>
  );
}

function renderEvent(event: SessionEvent) {
  if (event.type === "command") {
    return (
      <div className="event-card command">
        <div className="event-meta">Command</div>
        <pre>{event.text}</pre>
        {event.data?.aggregatedOutput ? <code>{String(event.data.aggregatedOutput)}</code> : null}
      </div>
    );
  }
  if (event.type === "command_output" || event.type === "agent_delta") {
    return (
      <div className="event-card stream">
        <div className="event-meta">{event.type === "agent_delta" ? "Streaming reply" : "Command output"}</div>
        <pre>{event.text}</pre>
      </div>
    );
  }
  const label = event.type.replace("_", " ");
  return (
    <div className={`event-card ${event.type}`}>
      <div className="event-meta">{label}</div>
      <p>{event.text || JSON.stringify(event.data ?? {})}</p>
    </div>
  );
}

function ApprovalCard({
  approval,
  csrfToken,
  onResolved
}: {
  approval: PendingApproval;
  csrfToken: string;
  onResolved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const approve = async () => {
    setBusy(true);
    try {
      await api.approve(csrfToken, approval.sessionId, approval.id, approval.kind === "permissions" ? { scope: "turn" } : {});
      await onResolved();
    } finally {
      setBusy(false);
    }
  };
  const reject = async () => {
    setBusy(true);
    try {
      await api.reject(csrfToken, approval.sessionId, approval.id);
      await onResolved();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="approval-card">
      <div>
        <strong>{approval.summary}</strong>
        {approval.detail ? <p>{approval.detail}</p> : null}
        <small>Expires {new Date(approval.expiresAt).toLocaleTimeString()}</small>
      </div>
      <div className="approval-actions">
        <button className="button secondary" onClick={reject} disabled={busy}>Reject</button>
        <button className="button primary" onClick={approve} disabled={busy}>Approve</button>
      </div>
    </div>
  );
}

function SessionPage({
  csrfToken
}: {
  csrfToken: string;
}) {
  const params = useParams();
  const sessionId = params.id!;
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [sending, setSending] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

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
    let reconnectTimer: number | null = null;

    const connect = () => {
      const socket = new WebSocket(`${protocol}://${window.location.host}/api/events?sessionId=${encodeURIComponent(sessionId)}&csrfToken=${encodeURIComponent(csrfToken)}`);
      socketRef.current = socket;

      socket.onopen = () => {
        setConnected(true);
      };
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as {
            type: string;
            event?: SessionEvent;
            approval?: PendingApproval;
          };
          if (payload.type === "session_event" && payload.event) {
            setDetail((previous) => previous ? { ...previous, events: [...previous.events, payload.event!] } : previous);
          }
          if (payload.type === "approval" && payload.approval) {
            setDetail((previous) => previous ? { ...previous, pendingApprovals: [...previous.pendingApprovals, payload.approval!] } : previous);
          }
        } catch {
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

  const sendMessage = async (event: FormEvent) => {
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
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send message.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Shell title={detail?.session.title || "Session"}>
      <section className="card stack">
        <StatusRow label="Project" value={detail?.session.projectPath ?? "Loading..."} />
        <StatusRow label="Transport" value={detail?.session.adapter ?? "Unknown"} tone={detail?.session.adapter === "app-server" ? "good" : "warn"} />
        <StatusRow label="Events" value={connected ? "Live" : "Reconnecting"} tone={connected ? "good" : "warn"} />
        <div className="inline-actions">
          <button className="button ghost" onClick={() => void refresh()}>Refresh</button>
          <button className="button ghost" onClick={() => void api.interrupt(csrfToken, sessionId).then(refresh)}>Interrupt</button>
        </div>
      </section>

      {detail?.pendingApprovals.length ? (
        <section className="card stack">
          <h2>Approvals</h2>
          {detail.pendingApprovals.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} csrfToken={csrfToken} onResolved={refresh} />
          ))}
        </section>
      ) : null}

      <section className="card stack">
        <h2>Output</h2>
        <div className="events">
          {mergedEvents.map((event) => (
            <div key={`${event.id}-${event.createdAt}`}>{renderEvent(event)}</div>
          ))}
        </div>
      </section>

      <form className="composer" onSubmit={sendMessage}>
        <textarea
          placeholder="Ask Codex to inspect, edit, review, or continue the session..."
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={4}
        />
        <button className="button primary" type="submit" disabled={sending || !message.trim()}>
          {sending ? "Sending..." : "Send"}
        </button>
      </form>

      {error ? <p className="error-text">{error}</p> : null}
    </Shell>
  );
}

function SettingsPage({
  authStatus,
  theme,
  setTheme
}: {
  authStatus: AuthStatusResponse | null;
  theme: string;
  setTheme: (theme: string) => void;
}) {
  const [serverUrl, setServerUrl] = useState(localStorage.getItem(SERVER_URL_STORAGE_KEY) ?? window.location.origin);
  const [saved, setSaved] = useState(false);

  return (
    <Shell title="Settings">
      <section className="card stack">
        <h2>Server URL</h2>
        <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} />
        <button
          className="button secondary"
          onClick={() => {
            localStorage.setItem(SERVER_URL_STORAGE_KEY, serverUrl);
            setSaved(true);
            if (serverUrl && serverUrl !== window.location.origin) {
              window.location.href = serverUrl;
            }
          }}
        >
          Save
        </button>
        {saved ? <p className="muted">Saved.</p> : null}
      </section>

      <section className="card stack">
        <h2>Appearance</h2>
        <div className="inline-actions">
          <button className={`button ${theme === "light" ? "primary" : "secondary"}`} onClick={() => setTheme("light")}>Light</button>
          <button className={`button ${theme === "dark" ? "primary" : "secondary"}`} onClick={() => setTheme("dark")}>Dark</button>
        </div>
      </section>

      <section className="card stack">
        <h2>Paired Device</h2>
        {authStatus?.device ? (
          <>
            <StatusRow label="Name" value={authStatus.device.name} />
            <StatusRow label="Last seen" value={new Date(authStatus.device.lastSeenAt).toLocaleString()} />
          </>
        ) : (
          <p className="muted">This browser is not paired yet.</p>
        )}
      </section>
    </Shell>
  );
}

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
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
    } else {
      setProjects([]);
      setSessions([]);
    }
  };

  useEffect(() => {
    void refreshData().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Could not load app data.");
    });
  }, []);

  return (
    <BrowserRouter>
      {error ? <div className="global-error">{error}</div> : null}
      <Routes>
        <Route path="/" element={
          <HomePage
            authStatus={authStatus}
            csrfToken={authStatus?.csrfToken ?? null}
            projects={projects}
            sessions={sessions}
            refreshData={refreshData}
          />
        } />
        <Route
          path="/sessions/:id"
          element={authStatus?.csrfToken ? <SessionPage csrfToken={authStatus.csrfToken} /> : <Shell title="Session"><p className="muted">Pair this phone first.</p></Shell>}
        />
        <Route
          path="/settings"
          element={<SettingsPage authStatus={authStatus} theme={theme} setTheme={setTheme} />}
        />
      </Routes>
    </BrowserRouter>
  );
}
