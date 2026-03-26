import path from "node:path";
import { HttpError } from "./errors";
import { MessageAttachmentInput } from "./types";

const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_CHARS = 60_000;

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".yml",
  ".yaml",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".css",
  ".html",
  ".xml",
  ".sh",
  ".zsh",
  ".toml",
  ".ini",
  ".csv",
  ".log"
]);

export function validateAttachments(input: unknown): MessageAttachmentInput[] {
  if (!input) {
    return [];
  }
  if (!Array.isArray(input)) {
    throw new HttpError(400, "attachments_invalid", "Attachments must be an array.");
  }
  if (input.length > MAX_ATTACHMENTS) {
    throw new HttpError(400, "attachments_invalid", `Attach up to ${MAX_ATTACHMENTS} files per message.`);
  }

  let totalBytes = 0;

  return input.map((entry, index) => {
    const value = entry as Record<string, unknown>;
    const name = typeof value.name === "string" ? value.name : "";
    const type = typeof value.type === "string" ? value.type : "application/octet-stream";
    const size = typeof value.size === "number" ? value.size : 0;
    const contentBase64 = typeof value.contentBase64 === "string" ? value.contentBase64 : "";

    if (!name || !contentBase64 || size <= 0) {
      throw new HttpError(400, "attachments_invalid", `Attachment ${index + 1} is missing required fields.`);
    }
    if (size > MAX_ATTACHMENT_BYTES) {
      throw new HttpError(400, "attachments_invalid", `${name} is too large. Limit is 5 MB per file.`);
    }

    totalBytes += size;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new HttpError(400, "attachments_invalid", "Total attachment size exceeds 10 MB.");
    }

    return { name, type, size, contentBase64 };
  });
}

export function isImageAttachment(attachment: MessageAttachmentInput): boolean {
  return attachment.type.startsWith("image/");
}

export function isTextAttachment(attachment: MessageAttachmentInput): boolean {
  if (attachment.type.startsWith("text/")) {
    return true;
  }
  return TEXT_EXTENSIONS.has(path.extname(attachment.name).toLowerCase());
}

export function attachmentToTextContext(attachment: MessageAttachmentInput): string {
  const buffer = Buffer.from(attachment.contentBase64, "base64");
  const decoded = buffer.toString("utf8");
  const truncated = decoded.length > MAX_TEXT_ATTACHMENT_CHARS
    ? `${decoded.slice(0, MAX_TEXT_ATTACHMENT_CHARS)}\n\n[truncated by Codex Mobile]`
    : decoded;

  return [
    `Attached file: ${attachment.name}`,
    `Type: ${attachment.type || "unknown"}`,
    `Size: ${attachment.size} bytes`,
    "Contents:",
    "```",
    truncated,
    "```"
  ].join("\n");
}

export function attachmentToBinaryNote(attachment: MessageAttachmentInput): string {
  return `Attached binary file: ${attachment.name} (${attachment.type || "unknown"}, ${attachment.size} bytes).`;
}
