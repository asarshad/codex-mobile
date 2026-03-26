import net from "node:net";
import { Request } from "express";

export function isPrivateRequest(req: Request): boolean {
  const rawAddress = req.ip || req.socket.remoteAddress || "";
  const address = rawAddress.replace(/^::ffff:/, "");
  if (address === "127.0.0.1" || address === "::1") {
    return true;
  }
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    if (typeof a !== "number" || typeof b !== "number") {
      return false;
    }
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80");
}

export function isLoopbackRequest(req: Request): boolean {
  const rawAddress = req.ip || req.socket.remoteAddress || "";
  const address = rawAddress.replace(/^::ffff:/, "");
  return address === "127.0.0.1" || address === "::1";
}
