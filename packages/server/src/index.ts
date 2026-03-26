import { createRuntime } from "./app";

async function main(): Promise<void> {
  const runtime = await createRuntime();
  runtime.server.listen(runtime.config.server.port, runtime.config.server.host, () => {
    console.log(`Codex Mobile listening on http://${runtime.config.server.host}:${runtime.config.server.port}`);
    if (runtime.config.server.allowLan) {
      console.log("LAN mode is enabled. Keep this on a trusted private network.");
    } else {
      console.log("LAN mode is disabled. Change allowLan in codex-mobile.config.json to reach this from your phone.");
    }
  });

  const shutdown = async () => {
    await runtime.close().catch(() => undefined);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

