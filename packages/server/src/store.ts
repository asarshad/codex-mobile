import fs from "node:fs";
import path from "node:path";
import { PersistedState, StoredAuthSession, StoredCliEvent, StoredDevice, StoredSessionRecord } from "./types";

const EMPTY_STATE: PersistedState = {
  devices: [],
  authSessions: [],
  sessions: [],
  cliEvents: []
};

export class StateStore {
  private readonly filePath: string;
  private state: PersistedState;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "state.json");
    this.state = this.read();
  }

  private read(): PersistedState {
    if (!fs.existsSync(this.filePath)) {
      return structuredClone(EMPTY_STATE);
    }

    const raw = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<PersistedState>;
    return {
      devices: raw.devices ?? [],
      authSessions: raw.authSessions ?? [],
      sessions: raw.sessions ?? [],
      cliEvents: raw.cliEvents ?? []
    };
  }

  private write(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  listDevices(): StoredDevice[] {
    return [...this.state.devices];
  }

  upsertDevice(device: StoredDevice): void {
    this.state.devices = this.state.devices.filter((entry) => entry.id !== device.id);
    this.state.devices.push(device);
    this.write();
  }

  listAuthSessions(): StoredAuthSession[] {
    return [...this.state.authSessions];
  }

  upsertAuthSession(session: StoredAuthSession): void {
    this.state.authSessions = this.state.authSessions.filter((entry) => entry.id !== session.id);
    this.state.authSessions.push(session);
    this.write();
  }

  deleteAuthSession(sessionId: string): void {
    this.state.authSessions = this.state.authSessions.filter((entry) => entry.id !== sessionId);
    this.write();
  }

  deleteExpiredAuthSessions(nowIso: string): void {
    this.state.authSessions = this.state.authSessions.filter((entry) => entry.expiresAt > nowIso);
    this.write();
  }

  listSessions(): StoredSessionRecord[] {
    return [...this.state.sessions];
  }

  upsertSession(session: StoredSessionRecord): void {
    this.state.sessions = this.state.sessions.filter((entry) => entry.id !== session.id);
    this.state.sessions.push(session);
    this.write();
  }

  listCliEvents(sessionId: string): StoredCliEvent[] {
    return this.state.cliEvents.filter((entry) => entry.sessionId === sessionId);
  }

  appendCliEvent(event: StoredCliEvent): void {
    this.state.cliEvents.push(event);
    this.write();
  }
}

