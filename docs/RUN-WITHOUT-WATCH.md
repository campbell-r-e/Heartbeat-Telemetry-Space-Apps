# Running Heartbeat Telemetry without the watch

This guide starts the onboard server, its database and the web dashboards on one Mac, with no Galaxy Watch. Everything except the live watch readings works: the astronaut dashboard, the flight surgeon console, the relay delay, the simulated solar storm, meals, check-ins, points and badges.

## What you need

| Tool | Version | Check |
|---|---|---|
| Docker (this repo uses [Colima](https://github.com/abiosoft/colima) on macOS; Docker Desktop also works) | any recent | `docker ps` |
| Node.js | 24 (the server image uses `node:24.19.0-slim`) | `node -v` |
| npm | comes with Node | `npm -v` |

You do **not** need Android Studio, Gradle, the Samsung Health Sensor SDK, or a Wi-Fi address for the watch.

## 1. Start Docker

```sh
colima start      # skip if you use Docker Desktop and it is running
docker ps         # should list containers (or an empty table) without an error
```

## 2. Create the secrets file

From the repo root:

```sh
cp .env.example .env
openssl rand -hex 24    # run twice: once for each value below
```

Open `.env` and replace both `change-me` values:

- `POSTGRES_PASSWORD`: the database password.
- `HEARTBEAT_TOKEN`: the shared write token. The dashboard sends it on every save.

`.env` is gitignored. Never commit it.

## 3. Start the server and database

```sh
docker compose up -d --build
curl -s localhost:4000/api/health
```

The health check answers `{"ok":true,...}`. On first start the server loads the bundled real data in `server/data/`:

- Astronaut 1's Galaxy Watch and Zepp history
- the ISS radiation record (NASA RadLab, 2017)
- the ISS cabin record (NASA OSDR, 2018)
- the space food menu

The radiation and cabin records loop on the mission clock from the moment the server starts (SPEC §5.7).

Useful commands:

```sh
docker compose logs -f server   # follow the server log
docker compose down             # stop (keeps the database)
docker compose down -v          # stop AND delete the database
```

Rebuild with `docker compose up -d --build` after pulling new code.

## 4. Install the web app's packages

From the repo root (this is an npm workspace: `shared`, `server`, `web`):

```sh
npm install
```

## 5. Point the web app at the server

```sh
cp web/.env.example web/.env.local
```

In `web/.env.local`, set `HEARTBEAT_TOKEN` to **the same value** as `HEARTBEAT_TOKEN` in the root `.env`. Leave `HEARTBEAT_SERVER_URL=http://localhost:4000`. If the token is missing or different, pages still load but every save (meals, check-ins, notes, the storm control) fails.

## 6. Start the web app

For development, with hot reload:

```sh
npm run dev:web
```

For a demo, use a production build so no page compiles while you present:

```sh
npm run build -w web
npm run start -w web
```

Then open:

- **Astronaut dashboard:** http://127.0.0.1:3000/astronaut
- **Flight surgeon console:** http://127.0.0.1:3000/surgeon (open it in a second tab)

The web app listens on `127.0.0.1` only. To open it from another computer on the same network, use `npm run dev:lan -w web` or `npm run start:lan -w web` instead.

## 7. Get ready for a demo (optional)

From the repo root:

```sh
npm run demo:reset
npm run demo:radiation-forecast
```

- **`demo:reset`** keeps every reading and record. It sets the link to Mars (far) with a 30 s demo delay, clears the simulated storm and resolves the last rehearsal's storm alerts. It warns that the watch's Samsung SDK file is missing; without a watch you can ignore that warning.
- **`demo:radiation-forecast`** lists the hours when the real ISS record turns Radiation 🟡 or 🔴 by itself. Pick a demo time outside them. Every server restart moves them.

Reload the surgeon tab after a reset. **Never tick "Real time"** on the console: one event at the real Mars delay holds every later ship-to-ground event for 22 minutes.

## What works without the watch

| Works | How to show it |
|---|---|
| Radiation and Cabin cards, charts and statuses | Real ISS data, live on the mission clock |
| Simulated deep-space solar storm | Surgeon console: **Start storm** (🟡), then **Escalate storm** (🔴) |
| Relay delay | The red banner counts down; the alert reaches the surgeon feed 30 s later |
| Surgeon notes and acknowledgments | Send a note from the surgeon console; it appears on the astronaut dashboard after the link delay |
| Meals, check-ins, points, streak, badges | Log them on `/astronaut/meals` and `/astronaut/check-in` |
| History charts (heart rate, HRV, sleep, SpO₂) | Astronaut 1's real imported history |

## What you will not see

- **Live vitals.** The heart rate, HRV and skin temperature readings are older than 15 minutes, so Vitals shows "No status" with its reason. This is expected, not a bug. The app never invents readings (SPEC §2).
- **ECG and SpO₂ spot readings**, and the ECG and SpO₂ tasks and their points.
- **Live sleep.** Sleep comes only from the imported Zepp nights.
- Exercise minutes for today, so **Gravity** may show 🟡 from 18:00 UTC. That is the real rule working on no exercise data.

## Points depend on the time of day (UTC)

A task earns points only within 2 hours of its time (SPEC §7):

| Task | Window (UTC) |
|---|---|
| Breakfast | 06:00–10:00 |
| Lunch | 11:00–15:00 |
| Dinner | 17:00–21:00 |
| Check-in | 18:00–22:00 |

Outside these windows, a meal or check-in is still saved but earns no points. Indiana is UTC−5 in winter.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `docker compose` says `set POSTGRES_PASSWORD in .env` | Step 2: `.env` is missing or still empty |
| `curl localhost:4000/api/health` gets no answer | `docker compose logs server`; wait for the database's health check, then try again |
| Postgres logs "No space left on device" | `colima ssh -- df -h /var/lib/docker`, then `docker volume prune -f`. This removes only unused unnamed volumes (old test databases), never `heartbeat-telemetry_pgdata` |
| Pages load but saving fails | Step 5: the token in `web/.env.local` must match the root `.env` |
| Port 3000 or 4000 is already in use | Find the other process with `lsof -i :4000` (or `:3000`) and stop it |
| Radiation is already 🟡/🔴 before you press anything | The real 2017 event is playing. Run `npm run demo:radiation-forecast`; restarting the server (`docker compose restart server`) moves the event about 13 days out |
