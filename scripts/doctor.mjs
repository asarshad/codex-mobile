import { execFileSync } from "node:child_process";

function check(label, fn) {
  try {
    const result = fn();
    console.log(`PASS  ${label}${result ? `: ${result}` : ""}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${label}: ${message}`);
    return false;
  }
}

const results = [];

results.push(check("Node.js", () => process.version));
results.push(check("npm", () => execFileSync("npm", ["-v"], { encoding: "utf8" }).trim()));
results.push(check("Codex CLI", () => execFileSync("codex", ["--version"], { encoding: "utf8" }).trim()));
results.push(check("Codex login", () => execFileSync("codex", ["login", "status"], { encoding: "utf8" }).trim()));
results.push(check("Codex app-server", () => execFileSync("codex", ["app-server", "--help"], { encoding: "utf8" }).split("\n")[0].trim()));

if (results.every(Boolean)) {
  console.log("\nEnvironment looks ready.");
  process.exit(0);
}

console.log("\nOne or more checks failed.");
process.exit(1);
