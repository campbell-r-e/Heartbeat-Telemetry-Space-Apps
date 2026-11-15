// The demo reset's steps against the running server (SPEC §13), with the server, the clock and the
// output handed in, so a test can run it against a stand-in server. demo-reset.ts wires it to HTTP.
import {
  DEMO_RELAY_SETTING, RETRY_POLL_MS, RETRY_WAIT_MS, alertsStillInFlight, inFlightWaitMs, parseClearedAt, parseCrewIds, parseGroundAlerts,
  parseOneWayDelayMs, parseSentAlerts, parseStormStartedAt, rehearsalAlerts, stormWindow, type AlertToCheck, type SentAlert,
  type StormWindow,
} from "./demo-reset-plan.ts";

export interface ResetIo {
  /** One request to the server; rejects on anything but 2xx. Answers are checked before use. */
  call(method: "GET" | "PUT" | "POST" | "DELETE", path: string, body?: object): Promise<unknown>;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
}

const MS_PER_SECOND = 1000;

export interface ResetOutcome {
  resolved: number;
  /** Rehearsal alerts still on their way after every wait; the storm's start is kept for a rerun. */
  stillInFlight: number;
}

/**
 * Sets Mars (far) with demo scaling, clears the storm, waits one link delay (plus a margin) for its
 * alerts still on the way, then resolves the open ones sent while it was on. Alerts whose arrival is
 * being retried are waited for a little longer and reported if still missing. Once nothing is left
 * on the way, the storm's start is forgotten, so a later reset never resolves real-data alerts.
 */
export async function runDemoReset(io: ResetIo): Promise<ResetOutcome> {
  const delayBeforeMs = parseOneWayDelayMs(await io.call("GET", "/api/relay/delay"));
  const delayAfterMs = parseOneWayDelayMs(await io.call("PUT", "/api/relay/delay", DEMO_RELAY_SETTING));
  io.log("✓ Link delay: Mars (far), demo scaling (30 s one way)");

  const startedAt = parseStormStartedAt(await io.call("GET", "/api/demo/solar-storm"));
  const clearedAt = parseClearedAt(await io.call("DELETE", "/api/demo/solar-storm"));
  io.log("✓ Simulated storm cleared; the crew was re-evaluated");
  const window = stormWindow(startedAt, clearedAt);
  if (window === null) {
    io.log("✓ No storm since the last reset, so no rehearsal alerts to resolve");
    return { resolved: 0, stillInFlight: 0 };
  }

  const waitMs = inFlightWaitMs(delayBeforeMs, delayAfterMs);
  io.log(`… Waiting ${Math.ceil(waitMs / MS_PER_SECOND)} s (one link delay plus a margin) for storm alerts still on their way to the ground`);
  await io.sleep(waitMs);

  let resolved = await resolveArrived(io, window);
  let inFlight = await stillInFlight(io, window);
  for (let waitedMs = 0; inFlight.length > 0 && waitedMs < RETRY_WAIT_MS; waitedMs += RETRY_POLL_MS) {
    io.log(`… ${inFlight.length} storm alert(s) left the ship but have not arrived (their arrival may be retried); looking again in ${RETRY_POLL_MS / MS_PER_SECOND} s`);
    await io.sleep(RETRY_POLL_MS);
    resolved += await resolveArrived(io, window);
    inFlight = await stillInFlight(io, window);
  }
  io.log(`✓ Rehearsal storm alerts resolved: ${resolved} (sent between ${startedAt} and ${clearedAt})`);

  if (inFlight.length > 0) {
    io.log(`▲ ${inFlight.length} storm alert(s) are still on their way (${inFlight.map((a) => a.alertId).join(", ")}). Run the reset again once they arrive.`);
  } else {
    await io.call("DELETE", "/api/demo/solar-storm/started-at");
  }
  return { resolved, stillInFlight: inFlight.length };
}

async function groundAlerts(io: ResetIo): Promise<AlertToCheck[]> {
  return parseGroundAlerts(await io.call("GET", "/api/ground/alerts"));
}

async function resolveArrived(io: ResetIo, window: StormWindow): Promise<number> {
  const toResolve = rehearsalAlerts(await groundAlerts(io), window);
  for (const alert of toResolve) await io.call("POST", `/api/ground/alerts/${encodeURIComponent(alert.alertId)}/resolve`);
  return toResolve.length;
}

async function stillInFlight(io: ResetIo, window: StormWindow): Promise<SentAlert[]> {
  const crew = parseCrewIds(await io.call("GET", "/api/astronauts"));
  const from = encodeURIComponent(new Date(window.fromMs).toISOString());
  const sent = (await Promise.all(
    crew.map(async (id) => parseSentAlerts(await io.call("GET", `/api/astronauts/${encodeURIComponent(id)}/relayed-alerts?from=${from}`))),
  )).flat();
  return alertsStillInFlight(sent, await groundAlerts(io), window);
}
