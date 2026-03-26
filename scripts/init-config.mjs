import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const examplePath = path.join(root, "config", "codex-mobile.config.example.json");
const outputPath = path.join(root, "codex-mobile.config.json");

if (fs.existsSync(outputPath)) {
  console.log(`Config already exists at ${outputPath}`);
  process.exit(0);
}

const home = os.homedir();
const candidates = [
  path.join(home, "dev", "projects"),
  path.join(home, "projects"),
  path.join(home, "work"),
  root
].filter((candidate, index, all) => all.indexOf(candidate) === index);

const allowedRoots = candidates.filter((candidate) => fs.existsSync(candidate));
const config = JSON.parse(fs.readFileSync(examplePath, "utf8"));

config.server.host = "127.0.0.1";
config.server.allowLan = false;
config.projects.allowedRoots = allowedRoots.length > 0 ? allowedRoots : [root];

fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));

console.log(`Created ${outputPath}`);
console.log("Edit server.host and server.allowLan when you want phone access over your LAN.");
