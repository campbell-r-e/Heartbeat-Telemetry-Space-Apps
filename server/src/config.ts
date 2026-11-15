// Settings read from the environment. Postgres connection settings use the standard PG*
// variables, read directly by the pg driver.
const DEFAULT_PORT = 4000;
/** All interfaces, so the watch can reach the server over Wi-Fi. */
const DEFAULT_HOST = "0.0.0.0";
const MIN_PORT = 1;
const MAX_PORT = 65_535;

export interface ServerConfig {
  port: number;
  /** Interface to listen on, from HOST; defaults to DEFAULT_HOST. */
  host: string;
  token: string;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const token = env.HEARTBEAT_TOKEN;
  if (!token) throw new Error("HEARTBEAT_TOKEN is not set; copy .env.example to .env and fill it in");
  return { port: readPort(env.PORT), host: readHost(env.HOST), token };
}

/** Unset means the default; set but empty is refused, like PORT. */
function readHost(raw: string | undefined): string {
  if (raw === undefined) return DEFAULT_HOST;
  if (raw === "") throw new Error(`HOST must not be empty; unset it to listen on ${DEFAULT_HOST}`);
  return raw;
}

function readPort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  const port = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(port >= MIN_PORT && port <= MAX_PORT)) {
    throw new Error(`PORT must be a whole number from ${MIN_PORT} to ${MAX_PORT}, got ${JSON.stringify(raw)}`);
  }
  return port;
}
