import crypto from "node:crypto";
import { parse, serialize } from "cookie";
import { Request, Response } from "express";
import { HttpError } from "../errors";
import { StateStore } from "../store";
import { AuthDeviceSession, StoredAuthSession, StoredDevice } from "../types";

const SESSION_COOKIE = "codex_mobile_session";

type CookiePayload = {
  sessionId: string;
  secret: string;
};

export class AuthService {
  constructor(private readonly store: StateStore, private readonly sessionTtlDays: number) {}

  private hash(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex");
  }

  createDeviceSession(deviceName: string): {
    device: StoredDevice;
    session: StoredAuthSession;
    cookieValue: string;
  } {
    const now = new Date();
    const device: StoredDevice = {
      id: crypto.randomUUID(),
      name: deviceName,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString()
    };

    const secret = crypto.randomBytes(32).toString("hex");
    const session: StoredAuthSession = {
      id: crypto.randomUUID(),
      deviceId: device.id,
      secretHash: this.hash(secret),
      csrfToken: crypto.randomBytes(24).toString("hex"),
      expiresAt: new Date(now.getTime() + this.sessionTtlDays * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString()
    };

    this.store.upsertDevice(device);
    this.store.upsertAuthSession(session);

    return {
      device,
      session,
      cookieValue: Buffer.from(JSON.stringify({ sessionId: session.id, secret }), "utf8").toString("base64url")
    };
  }

  clearExpiredSessions(): void {
    this.store.deleteExpiredAuthSessions(new Date().toISOString());
  }

  readAuthSession(req: Request): AuthDeviceSession | null {
    this.clearExpiredSessions();
    const cookies = parse(req.headers.cookie ?? "");
    const cookieValue = cookies[SESSION_COOKIE];
    if (!cookieValue) {
      return null;
    }

    let payload: CookiePayload;
    try {
      payload = JSON.parse(Buffer.from(cookieValue, "base64url").toString("utf8")) as CookiePayload;
    } catch {
      return null;
    }

    const session = this.store.listAuthSessions().find((entry) => entry.id === payload.sessionId);
    if (!session || session.secretHash !== this.hash(payload.secret) || session.expiresAt <= new Date().toISOString()) {
      return null;
    }

    const device = this.store.listDevices().find((entry) => entry.id === session.deviceId);
    if (!device) {
      return null;
    }

    const nowIso = new Date().toISOString();
    const nextSession = { ...session, lastSeenAt: nowIso };
    const nextDevice = { ...device, lastSeenAt: nowIso };
    this.store.upsertAuthSession(nextSession);
    this.store.upsertDevice(nextDevice);

    return { device: nextDevice, session: nextSession };
  }

  requireAuth(req: Request): AuthDeviceSession {
    const auth = this.readAuthSession(req);
    if (!auth) {
      throw new HttpError(401, "not_paired", "Pair this phone with the Mac before using the app.");
    }
    return auth;
  }

  setSessionCookie(res: Response, cookieValue: string, expiresAt: string): void {
    res.append(
      "Set-Cookie",
      serialize(SESSION_COOKIE, cookieValue, {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
        expires: new Date(expiresAt)
      })
    );
  }
}

export const readCsrfHeader = (req: Request): string | null =>
  typeof req.headers["x-csrf-token"] === "string" ? req.headers["x-csrf-token"] : null;
