# Heartbeat Telemetry

**Health monitoring that runs on board the spacecraft and gives astronauts useful insight into their own health.**

Built for the [NASA Space Apps Challenge 2026](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/?tab=details) challenge *Create Health Monitoring Software for Astronauts on Space Missions*.

**Team:** Campbell Reed, Ethan Buckner, Patience Akpor (Muncie, Indiana)

**Demo deck (7 slides, PDF):** https://drive.google.com/file/d/12hF5W8um5BSZ_A9hft5Yeh72-rJLs_EM/view

## What it does

On a deep-space mission the flight surgeon is minutes away and there is no internet, so astronauts have to watch their own health. Heartbeat Telemetry works on the ship first, then tells Earth.

- **A Galaxy Watch 5 Pro** collects heart rate, beat-to-beat intervals (for HRV), skin temperature, blood oxygen, ECG, cabin pressure and wrist motion (for sleep). It sends them to the onboard server over Wi-Fi.
- **The onboard server** combines the watch readings with real NASA data: ISS radiation, ISS cabin air and the ISS food menu. It rates every area 🟢 normal, 🟡 watch or 🔴 alert. It uses NASA-STD-3001 limits plus the astronaut's personal baseline, and explains each status in plain language: what it means, why it matters in space and what to do.
- **The astronaut dashboard** shows one screen per day: Vitals, Radiation, Gravity, Cabin, Nutrition and Mind, plus today's tasks, points, streaks and badges.
- **The relay to Earth** holds every message for the link delay: ISS 0 s, Moon 1.3 s, or Mars with a 10 s or 30 s demo delay. The flight surgeon console on Earth sees the whole crew, but only what has crossed the link. Red alerts go to the surgeon automatically.

It is organized around NASA's five hazards of human spaceflight:

| Hazard | How Heartbeat covers it |
|---|---|
| Space radiation | Real ISS dose data from NASA RadLab, rated against the 7-day average and the career limit |
| Isolation and confinement | Daily mood and stress check-in, plus sleep and HRV from the watch |
| Distance from Earth | The onboard server works alone; a relay sends to Earth with a delay |
| Gravity fields | The mission's gravity setting plus daily exercise minutes against a 120-minute goal |
| Hostile closed environment | ISS cabin CO₂, temperature and humidity, plus watch pressure |

**Radiation, cabin and food data come from NASA.** The one simulated feature is a clearly labeled **"Simulated deep-space solar storm"** demo button. It replays the September 2017 solar event from the RadLab record, amplified, and is marked "simulated" everywhere it shows.

## How it fits together

```
 ┌────────────── SPACECRAFT ──────────────┐            ┌──────── EARTH ────────┐
 │                                        │            │                       │
 │  Galaxy Watch ──Wi-Fi/HTTP──▶ Onboard  │   Relay    │  Ground store         │
 │  (Kotlin)     ◀──status/points── server│──(delay)──▶│        │              │
 │                                (TS)    │   queue    │        ▼              │
 │  Astronaut dashboard ◀──WebSocket──┘   │            │  Flight surgeon       │
 │  (Next.js)                             │            │  console (Next.js)    │
 │                                        │            │                       │
 │  Bundled data: RadLab, OSDR env,       │            └───────────────────────┘
 │  space food menu, gravity model        │
 └────────────────────────────────────────┘
```

| Folder | What it is | Built with |
|---|---|---|
| `server/` | Onboard server: readings API, rules engine, relay queue, points | Node 24, TypeScript, Fastify, WebSocket, PostgreSQL |
| `web/` | Astronaut dashboard (`/astronaut`) and flight surgeon console (`/surgeon`) | Next.js, React, Recharts |
| `watch/` | Wear OS app for the Galaxy Watch 5 Pro | Kotlin, Compose for Wear OS, Samsung Health Sensor SDK |
| `shared/` | Types shared by the server and the web app | TypeScript |

The full design, every rule and every decision is in [`SPEC.md`](SPEC.md).

## Run it

**Without a watch** (server, database and both dashboards on one computer): follow [`docs/RUN-WITHOUT-WATCH.md`](docs/RUN-WITHOUT-WATCH.md). In short:

```sh
cp .env.example .env                 # set POSTGRES_PASSWORD and HEARTBEAT_TOKEN
docker compose up -d --build         # server on :4000, Postgres
npm install
cp web/.env.example web/.env.local   # same HEARTBEAT_TOKEN
npm run build -w web && npm run start -w web
# open http://127.0.0.1:3000/astronaut and http://127.0.0.1:3000/surgeon
```

**With the watch:** see [`watch/README.md`](watch/README.md). ECG, SpO₂, skin temperature and HRV need Samsung's Health Sensor SDK, which is license-restricted and not in this repo. Without it the app still builds, and heart rate and pressure still work.

**Tests:**

```sh
npm test -w server                    # needs Docker (throwaway Postgres)
npm test -w web
cd watch && ./gradlew testDebugUnitTest
```

## Data sources

| Data | Source |
|---|---|
| ISS radiation (absorbed dose, Aug 29 – Sep 30, 2017, incl. the September 2017 solar particle event) | NASA OSDR RadLab, DOSIS-3D DosTel2: https://visualization.osdr.nasa.gov/radlab/gui/data-api |
| ISS cabin CO₂, temperature, humidity (RR-9, 2018) | NASA OSDR Environmental Data App: https://visualization.osdr.nasa.gov/eda/ |
| Space food menu | NASA ISS Standard Menu, with vitamin D from NASA or USDA FoodData Central |
| Limits and thresholds | NASA-STD-3001 Vol. 2 Rev F; OCHMO technical briefs TB-003, TB-004, TB-020, TB-035; NASA JSC *Nutrition Requirements, Standards, and Operating Bands for Exploration Missions* |
| Hazards framing | NASA Human Research Program: https://www.nasa.gov/hrp/hazards/ |
| Sleep from wrist motion | van Hees et al., *Scientific Reports* 8, 12975 (2018), CC BY 4.0 |
| Astronaut 1 sample history | Synthetic sample data in the Galaxy Watch and Zepp OS watch formats, generated by `server/scripts/generate-sample-history.ts` |

Full citations, with page numbers for every rule, are in [`SPEC.md` §14](SPEC.md#14-sources), [`docs/nasa/README.md`](docs/nasa/README.md) and [`docs/sleep/README.md`](docs/sleep/README.md).

## Use of AI tools

The team designed the project and made every product decision. The code, tests and documentation were written with the help of an AI coding assistant (Anthropic's Claude), working from the team's written spec, and every change was reviewed and tested before it was merged. The design mockups in `mockups/` were generated with AI tools and are labeled there, and the demo slides that combine app screenshots carry a visible "SI-assisted image" watermark. No audio is AI-generated. Astronaut 1's watch history is synthetic sample data made by a seeded script. The demo screenshots are captures of the running app and the watch.

## License

Original code is released under the Apache License 2.0, the default under the NASA Space Apps Challenge terms. The Samsung Health Sensor SDK is not included and stays under Samsung's license.
