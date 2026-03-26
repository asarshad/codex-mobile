import { describe, expect, it } from "vitest";
import { AuthService } from "../src/security/auth";
import { StateStore } from "../src/store";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeStore(): StateStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-mobile-auth-"));
  return new StateStore(dir);
}

describe("AuthService", () => {
  it("creates a device session with csrf token and cookie payload", () => {
    const auth = new AuthService(makeStore(), 7);
    const result = auth.createDeviceSession("Test Phone");

    expect(result.device.name).toBe("Test Phone");
    expect(result.session.csrfToken).toHaveLength(48);
    expect(result.cookieValue.length).toBeGreaterThan(10);
  });
});

