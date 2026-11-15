// One-command demo reset (SPEC §13, owner decision): `npm run demo:reset` from the repo root.
// It talks to the running onboard server over HTTP and keeps every reading and record: it never
// wipes the database. The steps are in demo-reset-run.ts: Mars (far) with demo scaling, clear the
// storm, wait for its alerts still on the way, resolve the rehearsal's, forget the storm's start.
// Then it checks the two setup traps: the web app's token (web/.env.local) and the Samsung SDK for
// a watch build. Set HEARTBEAT_SERVER_URL for another server.
import { readdir, readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { resetTarget, samsungSdkProblem, webEnvProblem, type ResetTarget } from "./demo-reset-plan.ts";
import { runDemoReset } from "./demo-reset-run.ts";

const ROOT_DOT_ENV = new URL("../../.env", import.meta.url);
const WEB_ENV_LOCAL = new URL("../../web/.env.local", import.meta.url);
const WATCH_LIBS = new URL("../../watch/app/libs/", import.meta.url);
/** No single request should take longer; a stuck one fails the reset instead of hanging it. */
const REQUEST_TIMEOUT_MS = 30_000;

/** The result of a file-system read, or null when the file or folder does not exist. */
async function ifPresent<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** One request to the server, given up after REQUEST_TIMEOUT_MS; any answer other than 2xx stops the reset with its body. */
function caller(target: ResetTarget) {
  return async (method: "GET" | "PUT" | "POST" | "DELETE", path: string, body?: object): Promise<unknown> => {
    const headers: Record<string, string> = method === "GET" ? {} : { Authorization: `Bearer ${target.token}` };
    if (body) headers["Content-Type"] = "application/json";
    const response = await fetch(new URL(path, target.serverUrl), {
      method, headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text}`);
    return JSON.parse(text);
  };
}

async function main(): Promise<void> {
  const target = resetTarget(process.env, await ifPresent(() => readFile(ROOT_DOT_ENV, "utf8")));
  const call = caller(target);
  await call("GET", "/api/health").catch((error: unknown) => {
    throw new Error(`The onboard server at ${target.serverUrl} is not answering (start it with \`docker compose up -d\`): ${String(error)}`);
  });

  await runDemoReset({ call, sleep: (ms) => sleep(ms), log: (line) => console.log(line) });

  const webProblem = webEnvProblem(target.token, await ifPresent(() => readFile(WEB_ENV_LOCAL, "utf8")));
  console.log(webProblem ? `▲ ${webProblem}` : "✓ web/.env.local has the server's token");
  const sdkProblem = samsungSdkProblem(await ifPresent(() => readdir(WATCH_LIBS)));
  console.log(sdkProblem ? `▲ ${sdkProblem}` : "✓ watch/app/libs/ has the Samsung SDK .aar");
  console.log("Readings, meals, check-ins and history were kept. Reload the surgeon tab so its storm control shows the reset.");
}

main().catch((error: unknown) => {
  console.error(`■ Demo reset failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
