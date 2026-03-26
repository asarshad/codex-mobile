import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "./api";
import { AuthStatusResponse, DraftAttachment, PendingApproval, ProjectInfo, SessionDetail, SessionEvent, SessionSummary } from "./types";

const THEME_STORAGE_KEY = "codex-mobile-theme";
const SERVER_URL_STORAGE_KEY = "codex-mobile-server-url";
const FEED_FILTERS = ["all", "conversation", "terminal"] as const;

type FeedFilter = (typeof FEED_FILTERS)[number];

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function attachmentNamesFromEvent(event: SessionEvent): string[] {
  const attachments = event.data?.attachments;
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const name = (entry as { name?: unknown }).name;
    return typeof name === "string" ? [name] : [];
  });
}

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_STORAGE_KEY) ?? "dark");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  return { theme, setTheme };
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 11.5 12 5l8 6.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 10.5V19h9v-8.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a8.2 8.2 0 0 0-1.7-1l-.3-2.5h-4l-.3 2.5a8.2 8.2 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a8.2 8.2 0 0 0 1.7 1l.3 2.5h4l.3-2.5a8.2 8.2 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5c.1-.3.1-.7.1-1Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.5 12.5 14.8 6.2a3 3 0 1 1 4.2 4.2L10.6 18.8a5 5 0 1 1-7.1-7.1l8.1-8.1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 12 5 5l4.5 7L5 19l15-7Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Shell({
  children,
  title,
  mode = "default"
}: {
  children: React.ReactNode;
  title: string;
  mode?: "default" | "session";
}) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <div className={`app-shell ${mode === "session" ? "session-shell" : ""}`}>
      <header className="topbar">
        <div>
          <p className="eyebrow">Codex Mobile</p>
          <h1>{title}</h1>
        </div>
        <div className="topbar-actions">
          <span className="badge subtle">{navigator.onLine ? "Online" : "Offline"}</span>
          <button
            className="icon-button ghost"
            type="button"
            aria-label="Open navigation menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MenuIcon />
          </button>
        </div>
        {menuOpen ? (
          <div className="topbar-menu">
            <Link className={location.pathname === "/" ? "active" : ""} to="/">
              <HomeIcon />
              <span>Home</span>
            </Link>
            <Link className={location.pathname.startsWith("/settings") ? "active" : ""} to="/settings">
              <SettingsIcon />
              <span>Settings</span>
            </Link>
          </div>
        ) : null}
      </header>
      <main className={`page ${mode === "session" ? "session-page" : ""}`}>{children}</main>
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

function identityForEvent(event: SessionEvent): string {
  if (event.itemId || event.turnId) {
    return `${event.type}:${event.turnId ?? ""}:${event.itemId ?? event.id}`;
  }
  return `${event.type}:${event.id}:${event.text ?? ""}`;
}

function mergeSessionDetail(
  previous: SessionDetail | null,
  incoming: SessionDetail,
  options: { replaceApprovals?: boolean } = {}
): SessionDetail {
  if (!previous) {
    return incoming;
  }

  const events = [...previous.events];
  const indexByIdentity = new Map<string, number>();

  events.forEach((event, index) => {
    indexByIdentity.set(identityForEvent(event), index);
  });

  for (const nextEvent of incoming.events) {
    if (nextEvent.itemId) {
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const existing = events[index];
        if (!existing) {
          continue;
        }
        if (existing.turnId === nextEvent.turnId && existing.itemId === nextEvent.itemId && (existing.type === "agent_delta" || existing.type === "command_output")) {
          events.splice(index, 1);
        }
      }
    }

    const identity = identityForEvent(nextEvent);
    const existingIndex = indexByIdentity.get(identity);
    if (existingIndex === undefined) {
      indexByIdentity.set(identity, events.length);
      events.push(nextEvent);
    } else {
      events[existingIndex] = { ...events[existingIndex], ...nextEvent };
    }
  }

  const approvalMap = new Map(previous.pendingApprovals.map((approval) => [approval.id, approval]));

  for (const event of incoming.events) {
    if (event.type === "approval_resolved") {
      const resolvedApprovalId = typeof event.data?.approvalId === "string" ? event.data.approvalId : null;
      if (resolvedApprovalId) {
        approvalMap.delete(resolvedApprovalId);
        continue;
      }
      if (event.itemId) {
        for (const [approvalId, approval] of approvalMap.entries()) {
          if (approval.itemId === event.itemId) {
            approvalMap.delete(approvalId);
          }
        }
      }
    }
  }

  if (options.replaceApprovals) {
    approvalMap.clear();
  }

  for (const approval of incoming.pendingApprovals) {
    approvalMap.set(approval.id, approval);
  }

  events.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  return {
    session: incoming.session,
    events,
    pendingApprovals: [...approvalMap.values()]
  };
}

function formatProjectName(projectPath: string, title: string | null): string {
  return title || projectPath.split("/").pop() || projectPath;
}

function EventMeta({ label, createdAt }: { label: string; createdAt: string }) {
  return (
    <div className="event-meta">
      <span>{label}</span>
      <time className="event-time" dateTime={createdAt}>
        {new Date(createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </time>
    </div>
  );
}

function eventMatchesFilter(event: SessionEvent, filter: FeedFilter): boolean {
  if (filter === "all") {
    return true;
  }

  if (filter === "conversation") {
    return ["user_message", "agent_message", "agent_delta", "plan", "reasoning"].includes(event.type);
  }

  return ["command", "command_output", "file_change", "system", "error", "approval", "approval_resolved", "status"].includes(event.type);
}

function filterLabel(filter: FeedFilter): string {
  if (filter === "conversation") {
    return "Conversation";
  }
  if (filter === "terminal") {
    return "Terminal";
  }
  return "Everything";
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
      <section className="card compact stack">
        <div className="chip-row">
          <span className="badge good">Paired</span>
          <span className={`badge ${authStatus.codexAuth.loggedIn ? "good" : "warn"}`}>
            {authStatus.codexAuth.loggedIn ? authStatus.codexAuth.authMethod ?? "Logged in" : "Codex login needed"}
          </span>
          <span className="badge subtle">LAN</span>
        </div>
        <p className="muted">Server: {window.location.origin}</p>
      </section>

      <section className="card compact stack">
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

      <section className="card compact stack">
        <h2>Recent Sessions</h2>
        <div className="stack compact">
          {sessions.length === 0 ? <p className="muted">No sessions yet.</p> : null}
          {sessions.map((session) => (
            <button key={session.id} className="session-card" onClick={() => void createSession(undefined, session.id)}>
              <div>
                <strong>{formatProjectName(session.projectPath, session.title)}</strong>
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

function ReasoningCard({ event }: { event: SessionEvent }) {
  const [open, setOpen] = useState(false);
  if (!event.text) return null;
  return (
    <div className="event-card reasoning-card">
      <button className="reasoning-toggle" type="button" onClick={() => setOpen((v) => !v)}>
        <span className="reasoning-icon">💭</span>
        <span>Thinking{open ? "" : "…"}</span>
        <span className="reasoning-chevron">{open ? "▲" : "▼"}</span>
      </button>
      {open ? <p className="reasoning-body">{event.text}</p> : null}
    </div>
  );
}

function renderEvent(event: SessionEvent) {
  if (event.type === "status") {
    return null;
  }
  if (event.type === "reasoning") {
    return <ReasoningCard event={event} />;
  }
  if (event.type === "plan") {
    return (
      <div className="event-card plan-card">
        <EventMeta label="Plan" createdAt={event.createdAt} />
        <pre>{event.text}</pre>
      </div>
    );
  }
  if (event.type === "file_change") {
    return (
      <div className="event-card file-change-card">
        <EventMeta label="Files changed" createdAt={event.createdAt} />
        <p>{event.text}</p>
      </div>
    );
  }
  if (event.type === "user_message") {
    const attachmentNames = attachmentNamesFromEvent(event);
    return (
      <div className="event-card user">
        <EventMeta label="You" createdAt={event.createdAt} />
        <p>{event.text}</p>
        {attachmentNames.length ? (
          <div className="attachment-list">
            {attachmentNames.map((name) => (
              <span key={name} className="attachment-pill">{name}</span>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  if (event.type === "agent_message") {
    return (
      <div className="event-card agent">
        <EventMeta label="Codex" createdAt={event.createdAt} />
        <p>{event.text}</p>
      </div>
    );
  }
  if (event.type === "command") {
    return (
      <div className="event-card command">
        <EventMeta label="Command" createdAt={event.createdAt} />
        <pre>{event.text}</pre>
        {event.data?.aggregatedOutput ? <code>{String(event.data.aggregatedOutput)}</code> : null}
      </div>
    );
  }
  if (event.type === "command_output" || event.type === "agent_delta") {
    return (
      <div className="event-card stream">
        <EventMeta label={event.type === "agent_delta" ? "Streaming reply" : "Command output"} createdAt={event.createdAt} />
        <pre>{event.text}</pre>
      </div>
    );
  }
  const label = event.type.replace("_", " ");
  return (
    <div className={`event-card ${event.type}`}>
      <EventMeta label={label} createdAt={event.createdAt} />
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
  const [localError, setLocalError] = useState<string | null>(null);
  const approve = async () => {
    setBusy(true);
    setLocalError(null);
    try {
      await api.approve(csrfToken, approval.sessionId, approval.id, approval.kind === "permissions" ? { scope: "turn" } : {});
      await onResolved();
    } catch (approvalError) {
      setLocalError(approvalError instanceof Error ? approvalError.message : "Could not approve request.");
    } finally {
      setBusy(false);
    }
  };
  const reject = async () => {
    setBusy(true);
    setLocalError(null);
    try {
      await api.reject(csrfToken, approval.sessionId, approval.id);
      await onResolved();
    } catch (approvalError) {
      setLocalError(approvalError instanceof Error ? approvalError.message : "Could not reject request.");
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
        {localError ? <p className="error-text">{localError}</p> : null}
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
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedFilter, setFeedFilter] = useState<FeedFilter>("all");
  const socketRef = useRef<WebSocket | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const forceBottomRef = useRef(true);
  const [isThinking, setIsThinking] = useState(false);

  const refresh = async () => {
    const session = await api.getSession(csrfToken, sessionId);
    setDetail((previous) => mergeSessionDetail(previous, session, { replaceApprovals: true }));
  };

  useEffect(() => {
    void refresh().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Could not load session."));
  }, [csrfToken, sessionId]);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      try {
        const session = await api.getSession(csrfToken, sessionId);
        if (!cancelled) {
          setDetail((previous) => mergeSessionDetail(previous, session, { replaceApprovals: true }));
        }
      } catch (pollError) {
        if (!cancelled) {
          setError(pollError instanceof Error ? pollError.message : "Could not refresh session.");
        }
      }
    };

    const intervalId = window.setInterval(() => {
      void tick();
    }, 2000);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void tick();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
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
            const ev = payload.event;
            if (ev.type === "status") {
              if (ev.text === "turn/started") setIsThinking(true);
              if (ev.text === "turn/completed") setIsThinking(false);
            }
            setDetail((previous) => previous ? mergeSessionDetail(previous, { ...previous, events: [ev], pendingApprovals: previous.pendingApprovals }) : previous);
          }
          if (payload.type === "approval" && payload.approval) {
            setDetail((previous) => previous ? mergeSessionDetail(previous, { ...previous, events: [], pendingApprovals: [payload.approval!] }) : previous);
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
  const filteredEvents = useMemo(
    () => mergedEvents.filter((event) => eventMatchesFilter(event, feedFilter)),
    [feedFilter, mergedEvents]
  );

  const scrollToLatest = (behavior: ScrollBehavior = "auto") => {
    feedEndRef.current?.scrollIntoView({ block: "end", behavior });
  };

  useEffect(() => {
    forceBottomRef.current = true;
    setIsAtBottom(true);
  }, [sessionId, feedFilter]);

  useLayoutEffect(() => {
    if (filteredEvents.length === 0) {
      return;
    }

    if (forceBottomRef.current || isAtBottom) {
      scrollToLatest(forceBottomRef.current ? "auto" : "smooth");
      forceBottomRef.current = false;
    }
  }, [filteredEvents.length, isAtBottom]);

  const loadFiles = async (files: FileList | null) => {
    if (!files?.length) {
      return;
    }

    setError(null);
    try {
      const loaded = await Promise.all(Array.from(files).map(async (file) => ({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        contentBase64: arrayBufferToBase64(await file.arrayBuffer())
      })));
      setAttachments((previous) => [...previous, ...loaded]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not attach those files.");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const submitMessage = async () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage && attachments.length === 0) {
      return;
    }
    setSending(true);
    setError(null);
    try {
      await api.sendMessage(csrfToken, sessionId, trimmedMessage, attachments);
      setMessage("");
      setAttachments([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await refresh();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send message.");
    } finally {
      setSending(false);
    }
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    await submitMessage();
  };

  const handleFeedScroll = () => {
    const container = feedRef.current;
    if (!container) {
      return;
    }
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setIsAtBottom(distanceFromBottom < 40);
  };

  return (
    <Shell title="Session" mode="session">
      <section className="session-layout">
        {detail?.pendingApprovals.length ? (
          <section className="session-approvals">
            {detail.pendingApprovals.map((approval) => (
              <ApprovalCard key={approval.id} approval={approval} csrfToken={csrfToken} onResolved={refresh} />
            ))}
          </section>
        ) : null}

        <section className="session-stream">
          <div className="session-feed" ref={feedRef} onScroll={handleFeedScroll}>
            {filteredEvents.map((event) => (
              <div key={`${event.id}-${event.createdAt}`}>{renderEvent(event)}</div>
            ))}
            {isThinking ? (
              <div className="thinking-indicator">
                <span className="thinking-dot" /><span className="thinking-dot" /><span className="thinking-dot" />
              </div>
            ) : null}
            {filteredEvents.length === 0 ? <p className="muted">No events yet.</p> : null}
            <div ref={feedEndRef} aria-hidden="true" />
          </div>
          {!isAtBottom ? (
            <button
              type="button"
              className="scroll-to-bottom-btn"
              aria-label="Scroll to bottom"
              onClick={() => {
                forceBottomRef.current = true;
                setIsAtBottom(true);
                scrollToLatest("smooth");
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12l7 7 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          ) : null}
        </section>

        <form className="composer composer-panel" onSubmit={sendMessage}>
          {attachments.length ? (
            <div className="attachment-list">
              {attachments.map((attachment, index) => (
                <button
                  key={`${attachment.name}-${attachment.size}-${index}`}
                  className="attachment-pill removable"
                  type="button"
                  onClick={() => setAttachments((previous) => previous.filter((_, attachmentIndex) => attachmentIndex !== index))}
                >
                  {attachment.name}
                </button>
              ))}
            </div>
          ) : null}
          <div className="composer-row">
            <button
              className="icon-button ghost"
              type="button"
              aria-label="Attach files"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
            >
              <PaperclipIcon />
            </button>
            <textarea
              placeholder="Message..."
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void submitMessage();
                }
              }}
              rows={1}
            />
            <button
              className="icon-button primary"
              type="submit"
              aria-label="Send message"
              disabled={sending || (!message.trim() && attachments.length === 0)}
            >
              <SendIcon />
            </button>
          </div>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            multiple
            onChange={(event) => {
              void loadFiles(event.target.files);
            }}
          />
        </form>
      </section>

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
      <section className="card compact stack">
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

      <section className="card compact stack">
        <h2>Appearance</h2>
        <div className="inline-actions">
          <button className={`button ${theme === "light" ? "primary" : "secondary"}`} onClick={() => setTheme("light")}>Light</button>
          <button className={`button ${theme === "dark" ? "primary" : "secondary"}`} onClick={() => setTheme("dark")}>Dark</button>
        </div>
      </section>

      <section className="card compact stack">
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

  useEffect(() => {
    const setAppHeight = () => {
      const vv = window.visualViewport;
      const h = vv?.height ?? window.innerHeight;
      const t = vv?.offsetTop ?? 0;
      document.documentElement.style.setProperty("--app-height", `${h}px`);
      document.documentElement.style.setProperty("--app-top", `${t}px`);
    };
    setAppHeight();
    window.visualViewport?.addEventListener("resize", setAppHeight);
    window.visualViewport?.addEventListener("scroll", setAppHeight);
    return () => {
      window.visualViewport?.removeEventListener("resize", setAppHeight);
      window.visualViewport?.removeEventListener("scroll", setAppHeight);
    };
  }, [])

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
