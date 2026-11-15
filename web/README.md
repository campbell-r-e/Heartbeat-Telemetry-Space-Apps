# Heartbeat Telemetry web app

Next.js 16 (App Router, Cache Components) with Recharts for charts. The astronaut dashboard lives at `/astronaut` (SPEC.md §9.1); `/` redirects there. The flight surgeon console lives at `/surgeon` (SPEC.md §9.2).

## Run

1. Start the onboard server (`docker compose up -d` at the repo root).
2. `cp web/.env.example web/.env.local` and set `HEARTBEAT_TOKEN` to the same value as in the repo root's `.env`.
3. `npm run dev -w web`, then open http://127.0.0.1:3000/astronaut.

For the demo, use a production build (`npm run build -w web && npm run start -w web`) and follow SPEC §13; `npm run demo:reset` at the repo root warns if `web/.env.local` is missing or its token differs from the server's.

### Who can reach it

There is no dashboard login (owner decision), so the app listens on **127.0.0.1 only** by default: `npm run dev` and `npm run start` bind to localhost, and only this Mac can open it. Anyone who can open the dashboard can log meals and check-ins, because the Next.js server adds the write token for them.

To show it to other devices on the local network for a demo, opt in explicitly:

```bash
npm run dev:lan -w web     # or: npm run build -w web && npm run start:lan -w web
```

These bind to `0.0.0.0`. Use them only on a network you trust, and stop the server after the demo.

The token is read only by server code (`src/lib/onboard/http.ts`); meal and check-in writes go through server actions (`src/app/astronaut/actions.ts`), so the browser never sees it.

## Check

- `npm test -w web`: unit tests for the pure logic in `src/lib` (node:test via tsx)
- `npm run lint -w web`, `npm run typecheck -w web`, `npm run build -w web`

## Layout

- `src/lib/domain/`: pure logic (no I/O), unit-tested. `response-guards.ts` checks every server response as it arrives; `onboard-response.ts` decides what a response means (error, shape error, "not provided yet").
- `src/lib/onboard/`: every call to the onboard server (`api.ts`), the fetch shell (`http.ts`) and the page loaders (`loaders.ts`)
- `src/components/`: presentational components. They never fetch and import nothing from `src/app`; pages pass server actions in as props.
- `src/app/astronaut/`: pages (dashboard, `[area]` detail, `meals`, `check-in`) and server actions
- `src/app/surgeon/`: the flight surgeon console (Alerts and Crew & Watches tabs, `astronauts/[id]` charts) and its server actions

## What comes from the server

The web app implements no thresholds and types no health numbers (decision 17): statuses, banners, reasons, derived values (radiation multiple, mission dose, exercise minutes, nutrition totals and targets) come from the rules engine's `GET /api/astronauts/:id/status`. If the status cannot be loaded, the page says so in a red notice and every area shows "No status".

Every endpoint the dashboard reads is in SPEC §10 (mission, tasks/today, alerts, reference-lines, settings, and the check-in delete), with its types in `@heartbeat/shared`.

## The relay (Phase 5)

- **Dashboard:** the red banner's "Alert sent to flight surgeon · arrives in m:ss" counts down to the `deliverAt` of the alert the server relayed (`/api/astronauts/:id/relayed-alerts`); after that it says when it arrived and, once the surgeon's answer is back, "Flight surgeon acknowledged/resolved". A banner whose alert the server did not relay shows no tag. The header's Earth link tile shows the delay from `GET /api/relay/delay`. Notes from the surgeon (`/api/astronauts/:id/notes`) show above the banners with **Mark read**, which sends the read receipt.
- **Surgeon console:** reads only `/api/ground/*` and `/api/relay/delay`, so it shows what Earth has received, late by the link delay. The one exception is the demo's storm control (SPEC §5.7, §13), which reads and sets the labeled simulated storm (`/api/demo/solar-storm`) on the ship at once: a demo control, not a message through the relay. Its astronaut page draws readings from the ground series and check-ins, calories and exercise minutes from the last daily log that reached the ground (`/api/ground/astronauts/:id/daily-log`). Writes (acknowledge, resolve, notes, crew and watch changes, the delay preset) go through server actions in `src/app/surgeon/actions.ts`.
- **Live updates:** both pages listen to the server's WebSocket (`/ws/onboard`, `/ws/ground`) through this app's origin (`next.config.ts` rewrites `/ws/*` to `HEARTBEAT_SERVER_URL`) and reload their data when a relay event that changes them arrives (`shouldRefresh` in `src/lib/domain/relay.ts`).
