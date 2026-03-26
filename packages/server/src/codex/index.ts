import { AppConfig, SessionSummary } from "../types";
import { StateStore } from "../store";
import { AppServerAdapter } from "./app-server-adapter";
import { CliAdapter } from "./cli-adapter";
import { CodexAdapter } from "./types";

export class CodexCoordinator {
  private readonly appServer: AppServerAdapter;
  private readonly cli: CliAdapter;

  constructor(private readonly config: AppConfig, private readonly store: StateStore) {
    this.appServer = new AppServerAdapter(config);
    this.cli = new CliAdapter(config, store);
  }

  get appAdapter(): AppServerAdapter {
    return this.appServer;
  }

  get cliAdapter(): CliAdapter {
    return this.cli;
  }

  async preferredAdapter(): Promise<CodexAdapter> {
    const preferred = this.config.codex.preferredAdapter === "cli" ? this.cli : this.appServer;
    const health = await preferred.health();
    if (health.available) {
      return preferred;
    }
    return preferred.kind === "app-server" ? this.cli : this.appServer;
  }

  adapterForSession(session: SessionSummary | { adapter: "app-server" | "cli" }): CodexAdapter {
    return session.adapter === "cli" ? this.cli : this.appServer;
  }

  async close(): Promise<void> {
    await Promise.all([this.appServer.close(), this.cli.close()]);
  }
}

