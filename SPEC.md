# Heartbeat Telemetry — Spec

**NASA Space Apps Challenge 2026:** [Create Health Monitoring Software for Astronauts on Space Missions](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/?tab=details)

**Team:** 3 people · **Build time:** 1 day · **Stack:** TypeScript (server and web), Kotlin (Galaxy Watch)

---

## 1. What we're building

A health monitoring system that runs **on board the spacecraft**. A Galaxy Watch collects the astronaut's health readings and sends them to an onboard server. The server combines them with radiation, gravity, cabin and nutrition data, then rates each one 🟢 / 🟡 / 🔴 against normal ranges and explains it in plain language. Gamification keeps the astronaut taking measurements and building healthy habits.

The onboard server **relays data back to Earth** with a simulated communication delay. On the ground, the flight surgeon sees the whole crew. Red alerts go to the surgeon automatically.

The app is organized around NASA's **five hazards of human spaceflight**:

| Hazard | How we cover it |
|---|---|
| Space radiation | Real ISS dose data from NASA RadLab |
| Isolation and confinement | Daily mood/stress check-in + watch stress signals (sleep, HRV) |
| Distance from Earth | Onboard server; relay to ground with simulated delay |
| Gravity fields | Mission gravity setting + daily exercise minutes against the goal |
| Hostile closed environment | Cabin panel: ISS CO₂/temp/humidity + watch pressure/noise |

## 2. Users and views

| View | Where it runs | Who | Shows |
|---|---|---|---|
| **Astronaut dashboard** | Web, served by the onboard server | One astronaut | Their own data, status, guidance, points |
| **Watch app** | Galaxy Watch 5 Pro | One astronaut | Status, live readings, reminders, points |
| **Flight surgeon console** | Web, "ground" side of the relay | Flight surgeon | Whole crew, alerts, delayed data |

**No invented readings in the app's logic.** The app is built for any crew size and starts with **one astronaut: Astronaut 1, who wears the watch.** More astronauts are added later only if more people wear a watch running our app. The surgeon console works with a crew of one.

## 3. Architecture

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

- **One Node/TypeScript process** with two logical sides: `onboard` and `ground`. The surgeon console only reads from `ground`, which receives events only through the relay queue.
- **The relay queue** holds each outgoing event until `sentAt + delay`. The delay preset is selected in the UI (see §8).
- **All NASA data is downloaded ahead of time and bundled.** This fits the story, since a spacecraft can't count on the internet, and it keeps the demo safe from network failures.
- The watch connects **directly to the server over Wi-Fi**, so no phone hop is needed. The Galaxy A16 is used for pairing and setup only; live sleep comes from the watch itself (§5.1, §5.7).

## 4. Tech stack

| Part | Choice |
|---|---|
| Repo | Monorepo: `server/`, `web/`, `watch/`, `shared/` (TS types) |
| Server | Node 24, TypeScript, Fastify, `ws` for WebSocket, PostgreSQL with `pg` (node-postgres) |
| Runtime | Docker Compose on the Mac (Colima as the Docker runtime): one container for the server, one for Postgres with its own named volume. The database is published to the Mac only (`127.0.0.1:5432`, never `0.0.0.0`), so it is reachable at `localhost:5432` with the credentials in `.env`, for tools like TablePlus and for running the server outside Docker |
| Web | Next.js (React, TypeScript, App Router), Recharts for charts; one app with two routes: `/astronaut`, `/surgeon`. Next.js serves the UI only; the WebSocket and relay queue stay in the Fastify server, which needs a long-running process |
| Watch | Kotlin, Wear OS, Compose for Wear OS, Samsung Health Sensor SDK, Android `SensorManager`, OkHttp/Ktor client |
| Rules | Typed TypeScript rule data and one configuration in `server/src/domain/rules/`, evaluated only on the server (§6.3) |

## 5. Data sources

### 5.1 Galaxy Watch 5 Pro (Astronaut 1, live)

| Metric | Source on watch | Notes |
|---|---|---|
| Heart rate | Samsung Health Sensor SDK (or Health Services) | Continuous |
| ECG | Samsung Health Sensor SDK | On demand; the astronaut holds a finger on the watch key ~30 s (500 samples a second). Stored and shown as a raw recording only: no analysis or classification (owner decision). Its result, on the watch and the dashboard, is the recording's length ("30 s") |
| Blood oxygen (SpO₂) | Samsung Health Sensor SDK | On demand |
| Skin temperature | Samsung Health Sensor SDK | Periodic |
| Beat-to-beat intervals (IBI) | Samsung Health Sensor SDK | Uploaded raw as the `ibi` metric (`ms`, a non-empty array of intervals per batch, `takenAt` = time of the first beat). The watch drops intervals it flags as invalid before uploading, so no flags are sent |
| HRV (stress marker) | Calculated **on the server** from the uploaded `ibi` intervals, with the §5.7 method | Periodic. Clients cannot post `hrv` directly |
| Exercise minutes | Derived from heart rate | Minutes with heart rate ≥ 64% of estimated max heart rate (220 − age); see §5.4. There is no steps metric: astronauts don't walk in microgravity |
| Cabin pressure | Barometer via `SensorManager` | Feeds the cabin panel |
| Cabin noise | Microphone level (dB estimate) | **Stretch** |
| Body composition | Samsung Health Sensor SDK (BIA) | **Stretch**; feeds the gravity panel. Stored as skeletal muscle mass in kilograms (`bodyComposition`, `kg`) |
| Wrist angle | Accelerometer via `SensorManager` (wake-up sensor when the watch has one), 10 samples a second, batched in the sensor hub for up to 20 s (two thirds of the Watch5 Pro's 300-sample hub buffer) and put back in time order on the watch (a batch can arrive after a newer one; samples wait 40 s for older ones). **While the watch is worn the collection service holds a partial wake lock** (owner decision, 2026-11-15): the Watch5 Pro has no wake-up accelerometer, and with the processor asleep only 6–9 Hz arrived and no minute was complete. The lock is taken when heart-rate contact confirms the watch is on, released the moment it comes off or the service stops, and never held off the wrist | Uploaded as the `wristAngle` metric (`deg`, an array of the 12 five-second epoch angles of one UTC minute, `takenAt` = the minute's start), continuously while the collection service runs (screen off too), **only while the watch is on the wrist** (heart-rate contact; owner decision: no accelerometer non-wear detection), and only for minutes whose 12 epochs are all covered. Wear is judged at **each sample's own time**, not when the batch arrives: a sample counts only when the watch has been on the wrist without a break from the sample's time until now, so a batch delivered after the watch goes back on never carries off-wrist samples. **Coverage:** an epoch counts only with at least 80% of the samples 10 Hz gives in 5 seconds (40 of 50); otherwise its minute is not sent. Prepared as in van Hees et al. 2018 (§5.7): each axis is replaced by its median over a 5-second window centered on the sample, the z-angle is atan(z / √(x² + y²)) in degrees, and the angles are averaged per clock-aligned 5-second epoch. Not shown on the watch or the dashboard (owner decision); the server detects sleep from it |
| Sleep | Calculated **on the server** from `wristAngle` with the §5.7 method (owner decision: no phone in space) | One reading per night: hours asleep (`sleep`, `h`), stamped at the waking time, source `watch`. No sleep stages. Clients cannot post `sleep` directly. Astronaut 1's imported Zepp history (below) has its own real nights |

**Imported Zepp history (Astronaut 1, owner decision).** Astronaut 1 also has history from a Zepp OS watch. Its history (2026-09-03 to 2026-11-14) is imported as source `zepp`, shown as "Zepp watch": per-minute heart rate, nightly sleep, nightly sleep HRV and the nightly blood-oxygen score (§5.7). The Galaxy Watch wins where both have a reading: a Zepp heart-rate minute is not kept when the Galaxy Watch (its imported history or live data) has heart rate in the same UTC minute, nor Zepp HRV when the Galaxy Watch has HRV in the same 5-minute window, nor a Zepp night when the Galaxy Watch has a night in the same noon-to-noon day (in the sleep-day time zone, §5.7) (the day whose sleep reading the waking time is, §5.7). This is applied when the Zepp history loads and again whenever Galaxy Watch readings are written: a posted watch heart rate deletes the Zepp minute it falls in, an HRV the server derives from posted `ibi` deletes the Zepp HRV in its window, and a night the server derives from `wristAngle` deletes the Zepp night in its day. Zepp's nightly HRV and SpO₂ are history and charts only; the rules use the Galaxy Watch's spot readings (§6.7).

> **Hour-one risk check:** Samsung Health Sensor SDK requires turning on developer mode in Samsung Health on the watch. Confirm ECG, SpO₂ and skin temperature all work on our watch in the first hour. If something doesn't, the watch app sends what it can, and the server fills the gap from a **recorded sample** (we record one real ECG early, as a backup).

### 5.2 Radiation — NASA RadLab (ISS)

- Source: [RadLab portal and data API](https://osdr-tutorials.readthedocs.io/en/latest/pages/guides/radlab_portal.html) (NASA OSDR).
- Pull an ISS dose-rate time series (CSV/JSON) for a window of several weeks; bundle it as `server/data/radiation-iss.json`.
- The server plays it on the looping mission clock (§5.7) as the "current" mission timeline. It shows **daily dose rate** and **cumulative mission dose**.

### 5.3 Cabin environment — NASA OSDR Environmental Data (ISS)

- Source: [OSDR Environmental Data](https://www.nasa.gov/reference/osdr-environmental-data).
- Pull ISS CO₂, temperature and humidity (mission RR-9, whose data runs 2018-08-14 to 2018-09-18); bundle as `server/data/cabin-iss.json`.
- **The cabin and radiation data come from different years** (cabin 2018, radiation 2017). No single window has both, so we keep both and loop each on the app's mission clock (§5.7).
- Combined with watch barometer readings (and noise, as a stretch).

### 5.4 Gravity

- **Gravity setting** per mission: ISS (microgravity), Moon (0.16 g), Mars (0.38 g), Earth (1 g).
- **Gravity is rated by exercise only (owner decision):** exercise minutes against the daily goal. There is no bone or muscle loss model.
- An exercise minute is a minute with heart rate at or above 64% of the astronaut's estimated max heart rate (220 − age), the ACSM/CDC moderate-intensity cutoff (the `exercise.moderateIntensityFraction` setting, 0.64; owner decision); age comes from the astronaut profile. The calculation is Phase 2. The daily exercise goal is **120 minutes** (the app's goal; the `exercise.dailyGoalMinutes` setting). This ties gravity to gamification. The Gravity card's status comes from exercise minutes (owner decision): 🟡 when today's exercise minutes are under `gravity.exerciseWatchBelowMinutes` (60) at or after `gravity.exerciseCheckFromHourUtc` (18:00 UTC), 🟢 once they reach the goal, and otherwise no status; no 🔴 (§6.7).

### 5.5 Nutrition — space food menu

- A bundled list of 30 real ISS menu items with calories, protein, calcium, vitamin D and sodium (`server/data/space-food.json`). Calories, protein, calcium, sodium, serving and food type come from NASA's **ISS Standard Menu Nutritional Data** table. That table has no vitamin D, so vitamin D comes from a 2017 NASA JSC presentation (NTRS 20170001326) where it lists the item, otherwise from **USDA FoodData Central**. The server loads the file into the database on every start.
- The astronaut picks meals from the menu, and the server totals them per UTC day (meals × the menu's values) against daily targets from NASA JSC's *Nutrition Requirements, Standards, and Operating Bands for Exploration Missions* (2005; NTRS 20200001703; `docs/nasa/NASA-Nutrition-Requirements-Exploration-Missions-2005.pdf`). A food with no value for a nutrient counts as unknown, never as 0, so totals are "at least" values with a count of unknown meals.
- **Timing (owner decision):** the Nutrition status rates **yesterday**, the last complete UTC day. Today's running totals are shown but not rated, so a morning before breakfast is never 🔴. If yesterday has no logged meals, Nutrition has no status.
- Energy targets use the astronaut profile: the estimated energy requirement (EER, Req. 1) needs age (19+), sex, body mass and height. Astronaut 1's sample profile (35, female, 66 kg, 1.68 m) gives an EER of 2,409 kcal/day and a protein minimum of 52.8 g/day (0.8 g/kg).
- **Which parts are NASA's and which are owner decisions (2026-11-14).** The bands come from the document's operating-band tables. Where a table leaves a gap, the owner resolved it: **energy** uses the strict reading of the table (🟢 90–100% of EER, 🟡 80–90% or 100–120%, 🔴 below 80% or from 120%; the table lists "110%" yellow and "120%" red without ranges); **sodium**'s unlabeled 2,300–3,500 mg gap is 🟡 (the table's upper yellow row reads only "3500 mg/d"). **Protein** is rated by both parts of Req. 2 and the worse wins: below the 0.8 g/kg/day minimum is 🟡 (NASA gives no red band for it), and the share of calories uses the table's bands with the standard Atwater factor of 4 kcal/g.
- **"At least" totals (owner decision):** a total with unknown meals is rated only when its band is already certain: it is in the top band, which more intake cannot leave (e.g. sodium of at least 4,000 mg is 🔴), or, for the protein minimum, it already meets the minimum. Otherwise it is unrated.

### 5.6 Isolation and confinement

- **Daily check-in:** mood (5 faces) and stress (1–5), taken on the dashboard or the watch. The scale is `CHECK_IN_SCALE` in `@heartbeat/shared` (1 to 5), defined once and used by the server's validation; `CHECK_IN_LABELS` says what each end means (mood "very low" to "very good", stress "calm" to "very stressed").
- **Passive signals:** sleep, plus HRV from the watch.

### 5.7 Data and history

Where each kind of data comes from:

| Data | Source | File | Script |
|---|---|---|---|
| Astronaut 1 history: heart rate (per minute), HRV (RMSSD per 5 min), skin temperature | Synthetic sample history in the Galaxy Watch shape (no location data) | `server/data/astronaut1-history.json` | `npm run generate:sample-history -w server` |
| Astronaut 1 Zepp history: heart rate (per minute), sleep (hours asleep per night), HRV (Zepp nightly sleep HRV), SpO₂ (Zepp nightly score) | Synthetic sample history in the Zepp OS watch shape, 2026-09-04 to 2026-11-14 | `server/data/astronaut1-zepp.json` | `npm run generate:sample-history -w server` |
| Radiation | NASA RadLab, ISS DosTel2, 2017-08-29 to 2017-09-30 (includes the September 2017 solar particle event) | `server/data/radiation-iss.json` | `npm run fetch:radlab -w server` |
| Cabin CO₂, temperature, humidity | NASA OSDR Environmental Data App, mission RR-9, 2018-08-14 to 2018-09-18 (a different year from the radiation data; both are kept) | `server/data/cabin-iss.json` | `npm run fetch:eda -w server` |
| Space food menu | NASA ISS Standard Menu table, plus vitamin D from NASA or USDA FoodData Central (§5.5) | `server/data/space-food.json` | — |
| Live readings | Our watch app (Phase 4) | database | — |
| Live sleep (hours asleep per night) | Derived on the server from the watch's `wristAngle` minutes with van Hees et al. 2018 (below) | database | — |

**Sample history (owner decision, 2026-11-15).** Astronaut 1's two history files are synthetic sample data, generated with a fixed seed by `npm run generate:sample-history -w server` (`server/scripts/generate-sample-history.ts`). They keep the shapes and date ranges of the import scripts' output, so the app, charts and rules behave as they would with imported history: the Galaxy Watch is worn on five of the ten days from 2026-11-05, and the Zepp watch covers 2026-09-04 to 2026-11-14 with nights until 2026-11-08. The import scripts below still convert a real export into the same shapes. The live readings from the watch are stored only in the database, never in the repository.

**Zepp history (owner decisions).** The device is recorded only as "Zepp OS watch"; no model, serial number, MAC address, key or token is stored. The import (`server/scripts/import-zepp.ts`, conversion in `zepp-conversion.ts`) does this:

- **Times.** Zepp counts heart-rate minutes from local midnight, and sleep from local midnight of the previous day, on the wall clock in America/Indiana/Indianapolis. Each wall-clock time is converted to UTC with the real IANA zone, so on 2026-11-01 the minutes from 02:00 local are EST (UTC−5), not EDT. A time the clock shows twice (01:00–01:59 on the fall-back day) is read as its first, daylight-time (EDT) occurrence (owner decision). Each heart-rate minute belongs to the day it is listed under (the export lists each day's minutes in order, with a count per day), not the day its decoded epoch suggests: around a spring-forward change the decoder's fixed per-day offsets give the last hour of the change day and the first hour of the next day the same epochs. Everything is stored in UTC.
- **Heart rate** (`heartRate`, `bpm`): every Zepp minute, except values ≤ 0 or ≥ 254 (254 is Zepp's "no reading") and the minutes the Galaxy Watch has (§5.1).
- **Sleep** (`sleep`, `h`): time actually asleep, light + deep + REM, one reading per sleep session at its end (the wake time). A session whose start is not a real time before its end, or that has more sleep than time in bed, is left out; the export has no such session. Nights without a session get no reading. When a local date has more than one session (a nap and a night), each keeps its sleep reading, and the **longest** (most time asleep) is that date's night: the nightly HRV and SpO₂ are stamped at its wake time (owner decision). This export has one session per date.
- **HRV** (`hrv`, `ms`): Zepp's nightly sleep HRV, one per night at that night's wake time. Zepp rewrites a night's row during the morning; the row updated last is kept. A night with no value (null, 0 or 255, Zepp's "no value") gets no reading. **This is a different method from the server's 5-minute RMSSD below:** it is Zepp's own single value for the whole night's sleep. The Galaxy Watch's HRV wins in the same 5-minute window. **History and charts only (owner decision):** it is left out of the HRV baseline, the HRV rules and the status's latest HRV.
- **SpO₂** (`spo2`, `%`): the **Zepp nightly score** (92–100 in this export), one per night at the wake time. It is Zepp's summary of the night's blood oxygen, not a single on-demand measurement like the Galaxy Watch's. **History and charts only (owner decision):** the SpO₂ rule reads spot readings only.
- **Not imported:** stress, PAI, readiness scores, steps, skin temperature, resting heart rate and Zepp's own baselines.
- **On every start** the server replaces the `zepp` source from the file, after the Galaxy Watch history, and applies the Galaxy-wins rule again against every stored Galaxy Watch reading (imported and live). Galaxy Watch readings posted later apply it as they are written (§5.1). The rule is `server/src/domain/source-precedence.ts`; which readings the rules read is `server/src/domain/rule-sources.ts`.

HRV method (Galaxy Watch): beat-to-beat intervals are grouped into 5-minute windows. Intervals the watch flags as invalid, or outside 300–2000 ms, are dropped. RMSSD is then computed over successive pairs of the remaining intervals, skipping any pair whose two intervals differ by more than 20% of the earlier one (a missed or extra beat). A window is kept only if it has at least 30 intervals and at least 20 pairs were used. HRV is calculated on the server for all Galaxy Watch data with this one method: the import script uses it for the history, and live watch data arrives as raw `ibi` intervals for the server to derive HRV from (Phase 2). For live `ibi`, the watch has already dropped the intervals it flags as invalid, so the server applies the 300–2000 ms and 20% rules only. The server gives each beat its own time (the batch's `takenAt`, the first beat, plus the cumulative intervals before it) and splits a batch across 5-minute windows by beat time. Mission data (radiation, cabin) plays on the app's own mission clock, so the original dates are not shown as current dates.

**Sleep method (Galaxy Watch, live).** Sleep is detected from wrist motion alone with the published method of van Hees VT et al., "Estimating sleep parameters using an accelerometer without sleep diary", *Scientific Reports* 8, 12975 (2018), doi:10.1038/s41598-018-31266-z (open access, CC BY 4.0; copy and citations in `docs/sleep/`). The paper uses no heart rate, so neither does the app, and it gives no sleep stages. Where the paper is silent, the app follows the implementation the paper names, GGIR 1.5-23, and the code cites the file. Code: `server/src/domain/sleep/` and `server/src/domain/derive-sleep.ts`; watch side `watch/.../sensors/motion/`.

- **Angle** (watch, §5.1): z-angle = atan(z / √(x² + y²)) × 180/π from the per-axis medians of a 5-second rolling window, averaged per 5-second epoch (paper p. 2; the paper prints the formula without the square root, GGIR and the geometry have it).
- **Day.** Each night is analyzed over one "individual day (noon-noon)" (paper p. 3), from noon to noon on the wall clock of the **sleep-day time zone**, an IANA zone name kept in the mission settings record (`sleepDayTimeZone`; owner decision). It is `UTC` for a real mission (spacecraft local time, §7) and `America/Indiana/Indianapolis` while testing on Earth, where test nights cross noon UTC. This follows GGIR, which places the day by the local clock of its time-zone argument `desiredtz` (GGIR 1.5-23, `R/g.sib.det.R`: local midnights from `g.detecmidnight(time, desiredtz)`, the day running 12 hours either side); here both noons are read on the zone's wall clock, so a day that changes to or from daylight time lasts 23 or 25 hours, analyzed whole. Only the day boundaries use the zone: every time stored, sent or shown, including waking times, stays in UTC. A day is analyzed only when it has **more than 16 hours of wear time** (recorded epochs), the paper's own night criterion ("noon-noon with >16 h of wear time", p. 2).
- **SPT-window (HDCZA, paper p. 3).** For each epoch, the median of the absolute changes between successive epoch angles over the 5 minutes (60 epochs) starting at it; the critical threshold is the day's 10th percentile of those values (R's default percentile, type 7) × 15; blocks with values below the threshold lasting longer than 30 minutes are kept; gaps shorter than 60 minutes between blocks join them; the longest block is the sleep period time window, from sleep onset (its start) to waking (its end). On a tie the earlier block wins.
- **Asleep.** Sleep is the sustained inactivity inside the window: runs of epochs with no change between successive epochs larger than 5° lasting more than 5 minutes (paper p. 3, citing van Hees et al. 2015, *PLoS ONE* 10, e0142533). The stored value is their total in hours.
- **Missing data.** An epoch with no angle (watch off the wrist, a dropped minute) is not imputed: a 5-minute window containing one has no value, so it is never below the threshold, and it ends a sustained-inactivity run. Gaps shorter than 60 minutes between blocks are still joined by the step above.
- **Threshold range (owner decision).** The threshold is kept within **0.13–0.50°**, "the 2.5th and 97.5th percentile of the distribution of the threshold value observed in a sample of daily life accelerometer recordings" (paper p. 4, where it is used for the polysomnography evaluation), which GGIR applies by default (`constrain2range`). Without it a restless day's threshold sits above all its movement and the whole day becomes one 24-hour window. With it, GGIR's 0.20 substitute for a zero threshold can never apply, so it is not needed.
- **Owner decisions (2026-11-14):** missing epochs are not imputed; a bout lasts **more than** 5 minutes (the 2018 paper and GGIR; the 2015 paper says "at least"); the earlier of two equally long blocks wins; the watch samples at 10 Hz; the last 7 ended days are re-analyzed every hour; wear comes from heart-rate contact only; and there is **no provisional reading**: a night appears only after its noon-to-noon day has ended.
- **Changing the zone.** `PUT /api/mission/sleep-day-time-zone` (§10) sets it; the server then asks the sleep job to run now, after any run already in progress (one writer, one run at a time), and it re-derives the last 7 ended days in the new zone before the reply, and clears any watch night stamped in the day still running (left by the old zone's days), so the stored nights always match the setting. The Galaxy-wins rule for Zepp nights and the Mind rule's one-reading-per-night use the same days.
- **When.** The server runs the detection at start and every hour for each astronaut over the **7 most recent ended days** (a day is analyzed only after its noon end, since the threshold and the longest block are taken over the whole day; re-analyzing a week lets minutes a watch uploads late still count). Each run replaces the day's `watch` sleep reading in one transaction: one `sleep` reading, value = hours asleep, `takenAt` = waking time, or none when no window is found; a Zepp night in the same day is then removed (the Galaxy Watch wins, §5.1). The hourly run goes through the server's job guard: a failed run, or one astronaut's failure, is logged and never stops the server or the other astronauts. The Mind rules read one reading per night (§6.7).

**Mission clock (owner decision): the recordings loop.** Each bundled recording (radiation, cabin) plays in real time from server start: its first hour plays at the start, and when it ends it starts again from the beginning, so there is always a current reading. One loop lasts the recording's span plus one hour (radiation 755 h, cabin 841 h), so the seam keeps the hourly spacing. The loop before the start counts as the preceding days, so the rolling 24-hour dose and its 7-day baseline work from the first hour. The server stores enough loops before the start for the rules' 8 days of history and the loops for **one year** after it (each with its original time kept; owner decision: restart the server within a year to keep a current reading); readings after "now" are never shown or rated. The simulated storm replaces the recorded hours it overlaps on the current loop; only the ship's radiation can be replaced, and `simulated` readings come only from the demo endpoint (`POST /api/readings` refuses them).

**Mission dose (owner decision):** the mission and career dose accumulate from the mission settings record's start date (2026-11-05, mission day 1), not from the earliest stored reading; the loop before the start still provides the preceding days for the radiation multiple's 7-day average. Simulated storm hours count toward the mission dose only while the storm is active, and they are labeled `simulated`. The 180-day projection uses the average daily dose since the mission start. These figures are a **dose equivalent (estimate)**: the ship's absorbed dose × 2.26 (DOSIS dose equivalent per absorbed dose), not an effective dose, so the comparison with NASA's 600 mSv career effective-dose limit uses it as the closest stand-in (owner decision).

**Radiation alert thresholds (decided):** daily dose (a rolling 24 hours) vs. the previous 7-day average: 🟡 ≥ 1.25×, 🔴 ≥ 1.5× *(ours)*. The real Sept 11, 2017 event is 1.47× at the end of Sept 11 (UTC) and, measured as a rolling 24 hours, briefly reaches 🔴: 7 hours between 2017-09-11T16:00Z and 2017-09-12T00:00Z, peaking at 1.547× at 2017-09-12T00:00Z. A **"Simulated deep-space solar storm"** demo button injects a clearly labeled simulated event to show a 🔴; it is the only non-recorded data in the app and is always marked "simulated". It replays the real Sept 11–12, 2017 hours as the 48 hours ending now (the last simulated hour lands at the current time, so the whole storm shows at once) and amplifies only the rise: value = real + max(0, real − baseline) × (factor − 1), where baseline is the mean of the 7 days before the event in the same 2017 data. So a simulated hour is never below the real reading and never negative. In the rules engine, simulated hours replace the recorded hours they overlap (owner decision).

**The storm control (Phase 7, owner decisions).** The button is on the **surgeon console**, a clearly labeled "Simulated deep-space solar storm" demo control with a **Clear storm** button for resets. It works in **two steps**: the first press brings Radiation to 🟡 (demo step 3), the second escalates it to 🔴 (step 6). Each press is `POST /api/demo/solar-storm` with a factor from `DEMO_STORM_STEPS` (`shared/src/demo.ts`): **1.3** for 🟡 and **5** (the default) for 🔴, picked from the rules' own thresholds (🟡 ≥ 1.25×, 🔴 ≥ 1.5×). On the bundled record they give 1.28–1.47× and 2.9–3.2× at every hour of the mission clock's loop, which `server/test/demo-storm.test.ts` checks through the rules engine. After the storm starts or is cleared, the ship **evaluates every astronaut at once**, so the alert leaves right away instead of at the next one-minute check, and a cleared storm is seen by the rules before the next press. `GET /api/demo/solar-storm` tells the control whether a storm is stored and its factor, read back from the stored hours. The control acts on the ship's simulated sensor data **at once, not through the relay** (decided without the owner, the narrowest reading of §8: the storm is a simulated event at the spacecraft, not a message from the ground; only the alerts it causes cross the link, with the delay).

- **Evaluations never go back in time (Phase 7 review).** Every evaluation (the minute check, each status request, the storm's immediate check) runs one at a time through one queue in the server process (`server/src/domain/status/status-evaluator.ts`), reads the clock and the readings only when its turn comes, and a crew check evaluates astronauts one after another. So a check that started just before a press can never log its older status after the press's newer one (🔴, then 🟡, then 🔴); `relay-api.test.ts` stalls a minute check across a press to show it. **Time limits (Phase 7 review):** an evaluation that hangs is given up after 10 s, so the queue moves on; it checks its abort signal before logging, so a late one logs nothing (a commit already under way when the limit passes can still land; the limit is far above a normal evaluation's well-under-a-second). The running server's database pool also cancels any statement after 15 s (`STATEMENT_TIMEOUT_MS`); the startup schema and bundled-history import run on a pool of their own without that limit (they take about 5 s today).
- **An out-of-date press is refused (pending owner review).** Each press also sends the storm its console showed (`expectedFactor`: the factor, or null for no storm). When the storm has changed since (another tab, or `npm run demo:reset`), the server answers **409** `storm_changed` with a plain message and the current state, changes nothing, and the console reloads to show the storm as it is. A press without `expectedFactor` (e.g. `curl`) is never refused.
- **The storm's start is kept (pending owner review).** The first press of a storm records its time in the mission record; escalating keeps it, and it stays after the storm is cleared. `GET /api/demo/solar-storm` returns it as `startedAt`, so the demo reset can tell this storm's alerts from older ones. Once the reset has resolved them it forgets the start (`DELETE /api/demo/solar-storm/started-at`), so a later reset never resolves an alert raised afterward by real data.
- **Storm changes are one at a time and atomic (Phase 7 review).** Starting, escalating and clearing run through their own queue in the server process, so two presses made from one view, or an escalate and a clear sent together, never interleave (one press gets 409; an escalate and a clear apply in arrival order). A storm's readings and its start time are written in one transaction (`DemoStormStore`).
- **A storm lasts 48 hours (pending owner review).** A storm counts as on only for its own 48 hours after its press. After that `GET` reports no storm, the console offers **Start storm** again, and the next press starts a new storm with a new start time. Its old readings stay (labeled simulated) until that press or a clear replaces them.
- **Fact: the real record alone fires the storm's rules.** With no storm, the looped ISS record rates Radiation 🔴 for 7 hours and 🟡 for 15 hours in each 755-hour loop (the Sept 2017 event and later rises; checked hour by hour in `server/test/demo-storm.test.ts`). So a storm-rule alert is not always the rehearsal's, and the reset resolves only those sent while the latest storm was on, from its start to its clear (§13).

## 6. Status and commentary (rules only, no AI)

### 6.1 Status levels

| Status | Meaning | Action |
|---|---|---|
| 🟢 Normal | Within range | None |
| 🟡 Watch | Drifting from normal | The astronaut gets guidance to act on |
| 🔴 Alert | Needs attention | **Flight surgeon notified automatically** through the relay |

### 6.2 Normal ranges — two layers

1. **Standard human ranges** apply from day one (for example, SpO₂ ≥ 95%, and heart rate 🔴 below 40 or above 180 bpm).
2. **Personal baseline** applies once enough data exists (default: 7 days). It is computed only from the astronaut's real recorded readings (for example, imported watch history and live watch data). Until enough real data exists, only the standard human ranges apply. Rules then also compare against the astronaut's own mean ± deviation.

A reading gets the **worse** of the two statuses.

**As built (Phase 2, owner decisions):** the baseline is the mean and sample standard deviation of the astronaut's real readings (every source except `simulated`; for HRV also not Zepp's chart-only nightly values, §5.7) from the last **14 days**, up to (not including) the latest reading. It applies once those readings fall on at least **7 distinct UTC days**. Baseline rules measure the latest reading in standard deviations from the mean: 🟡 beyond **2**, 🔴 beyond **3**, for heart rate above, skin temperature either way, and HRV below. Heart rate has no fixed normal band; only clear extremes are rated without a baseline (🔴 below 40 or above 180 bpm, §6.7). Each metric's status is the worse of all its standard and baseline rules.

### 6.3 Rule format

There is **one rules engine, on the server**; the watch, the dashboard and the surgeon console show its verdict and implement no thresholds. Rules are typed TypeScript data in `server/src/domain/rules/catalog.ts` (checked by the compiler), not JSON files. Each rule produces a status, a short plain-language **title** (e.g. "Radiation dose spike", "Exercise behind pace") and a three-part message, and cites its source:

```ts
{
  id: "co2-one-hour-alert",
  area: "cabin", hazard: "environment", layer: "standard", status: "alert",
  when: [{ fact: "co2OneHourAverageMmHg", op: "gt", setting: "co2.oneHourAlertAboveMmHg" }],
  message: {
    what: "Cabin CO₂ averaged {co2OneHourAverageMmHg} mmHg over the last hour, above NASA's {setting:co2.oneHourAlertAboveMmHg} mmHg limit.",
    why: "...",
    do: "...",
  },
  source: { requirementId: "[V2 6004]", document: "NASA-STD-3001 Vol 2 Rev F §6.2.1.3 · OCHMO-TB-004", ours: false },
}
```

- **`when`**: every condition must hold, except that a condition marked `onlyWithData` is skipped while its fact has no data. A condition compares a **fact** (a named value computed from the data, `server/src/domain/rules/facts.ts`) with a **setting**, or checks a yes/no fact (`{ fact: "cabinOutsideZone", is: true }`). Bands are written as exclusive ranges (for example SpO₂ watch is `≥ 90 and < 95`), so one reading fires one message per rule family.
- **Settings**: rules hold no numbers. Every threshold is a key in the one configuration, `server/src/domain/rules/settings.ts`. A setting not yet decided is `null`, and every rule that needs it is **pending**. Each fact declares the settings it needs in one list (`facts.ts`), which both the pending check and the calculation read.
- **Placeholders**: `{factId}` is filled with the fact's value, rounded to the fact's decimals; `{setting:key}` with the setting's value. Messages never restate a threshold as literal text, so a changed setting changes the message.
- **Audited wording:** every title and message was audited against the documents in `docs/nasa` on 2026-11-14 ([docs/message-audit-2026-11-14.md](docs/message-audit-2026-11-14.md)), and the owner approved all its rewrites. Each rule's `source.citations` lists the pages that back its messages. Alerts say "An alert has been sent to the flight surgeon.", since the notice is still in transit through the relay when the astronaut reads it. A snapshot test (`server/test/fixtures/approved-messages.json`) fails on any wording change, so changes are reviewed deliberately.
- **`layer`**: `standard` (§6.5 limits and clinical ranges), `baseline` (§6.2) or `combination` (§6.4). **`source.ours`** marks a band that is our design choice.

### 6.4 Combination rules

These rules look at several metrics over a time window:

| Rule | Conditions (all must hold) | Status | State |
|---|---|---|---|
| `behavioral-health-watch` | mood average ≤ 2 over the last 3 days of check-ins (at least 2 check-ins) · HRV more than 2 standard deviations below baseline · stress average below 4 · once sleep data exists, also the last 3 nights in a row under 6 h of sleep | 🟡 | **Active** (owner decision) |
| `behavioral-health-alert` | the same, with stress average ≥ 4 | 🔴 | **Active** |
| Radiation event | daily dose ≥ 1.5× the previous 7-day average | 🔴 for the whole crew | **Active**: this is `radiation-solar-event-alert` (§6.5). It reads only the ship's sensors, so it is marked `crewWide` and appears in every astronaut's status (§5.7) |

Combination rules rate their area (Mind) but not individual metrics.

### 6.5 NASA limits (from NASA-STD-3001)

The **NASA limit** column is what the standard says. The **App status** column is how we turn it into 🟢/🟡/🔴. Where a band is our own design choice rather than NASA's, it says *(ours)*. The UI cites the requirement ID on each learn card.

| Area | NASA limit | Source | App status |
|---|---|---|---|
| **Radiation, career** | Total career effective dose **< 600 mSv**, same for all ages and sexes | [V1 4030], Vol 1 · OCHMO-TB-020 | 🟢 < 80% of limit · 🟡 ≥ 80% *(ours)* · 🔴 projected to reach 600 mSv. Our career figure is a **dose equivalent (estimate)**, compared with this effective-dose limit as the closest stand-in (owner decision) |
| **Radiation, solar event** | Protect crew from the design solar particle event to **< 250 mSv** per event | [V1 4031], Vol 1 · OCHMO-TB-020 | Daily dose vs. the previous 7-day average: 🟡 ≥ 1.25× · 🔴 ≥ 1.5× *(ours; see §5.7)* |
| **Radiation, alerting** | "The radiation monitoring system **shall alert the crew and operations teams** when radiation exposure rates exceed predefined thresholds" | [V2 6164], Vol 2 Rev F §6.8.1.6 (replaces [V2 6100], deleted in Rev D) | Satisfied by our red alert + watch vibration (crew) and the auto-notified flight surgeon (operations team) |
| **CO₂** | Average **1-hour** ppCO₂ **≤ 3 mmHg** | [V2 6004], Vol 2 Rev F §6.2.1.3 · OCHMO-TB-004 | 🔴 1-hour average > 3.0 mmHg |
| **CO₂, headache risk** | Keep the **7-day average below 2.5 mmHg** to hold headache risk under 1% | OCHMO-TB-004 (guidance, not a requirement) | 🟡 7-day average ≥ 2.5 mmHg or 1-hour average 2.5–3.0 |
| **Cabin pressure** | **34.5 kPa < pressure ≤ 103 kPa** (5.0–15.0 psia) for indefinite exposure; ISS runs at 14.7 psia (101.3 kPa) | [V2 6006], Vol 2 · OCHMO-TB-003 | 🔴 outside 34.5–103 kPa · 🟡 the watch's latest reading > 3 kPa from its own 24-hour average, for leak detection *(ours, owner decision)* |
| **Cabin temperature + humidity** | Temperature and humidity must sit **together** inside a four-corner zone: **(18 °C, 75% RH) · (25.7 °C, 75%) · (27 °C, 25%) · (19.1 °C, 25%)** | [V2 6012] *Crew Health Environmental Limits*, Vol 2 Rev F §6.2.3.1, Figure 6.2-2 | 🟢 inside the zone · 🟡 outside · 🔴 outside by > 2 °C or > 10% RH *(ours)*. Checked as a point-in-polygon test on (°C, %RH), which approximates NASA's chart |
| **Noise, sleep** | Crew quarters and sleep areas limited to the **NC-40** curve (missions > 30 days). ISS Flight Rule B13-152 sets sleep stations at **50 dBA or below** | [V2 6079], Vol 2 Rev F §6.6.1.8 · ISS Flight Rule B13-152 (via NASA ICES-2024-354) | 🟡 sleep-period average > 50 dBA |
| **Noise, work areas** | Continuous noise limited to the **NC-50** curve (octave-band levels in Table 6.6-3; NASA gives no single dBA value) | [V2 6078], Vol 2 Rev F §6.6.1.7 | 🟡 awake average > 58 dBA *(ours, approximate dBA for NC-50; the watch mic can't measure octave bands)* |
| **Noise, 24-hour** | Noise dose **≤ 100**, equivalent to an 8-hour 75 dBA average, which corresponds to a **24-hour level of 70 dBA** | [V2 6115], Vol 2 Rev F §6.6.1.6 | 🔴 24-hour average > 70 dBA |

**Verified** against Vol 2 Rev F (approved 2026-07-14), OCHMO-TB-020, OCHMO-TB-004 and OCHMO-TB-003. Older revisions used a simple 18–27 °C range ([V2 6013], Rev A) and a separate 25–75% humidity requirement ([V2 6010], deleted in Rev C). Rev F replaced both with the combined zone above. In Rev F, [V2 6013] is a comfort design target, not a health limit.

**Vitals are not in NASA-STD-3001 as numeric limits.** SpO₂ uses the standard clinical range: 🟢 ≥ 95% · 🟡 90–94% · 🔴 < 90%. Heart rate is 🔴 below 40 or above 180 bpm at any time *(owner decision)* and is otherwise rated by the personal baseline, as are skin temperature and HRV (§6.2).

### 6.6 Learn panels

Each metric has a short "What is this?" card: what it measures, how to take it in space, and how spaceflight hazards affect it. The challenge asks that the app not assume the astronaut already knows this.

### 6.7 Rules engine as built (Phase 2)

Code: `server/src/domain/rules/` (settings, facts, rule shape, catalog, engine) and `server/src/domain/status/` (the pure calculations and the status use case). Clients get everything from `GET /api/astronauts/:id/status` (§10).

**How each rule is computed.** Windows end at the evaluation time ("now"); a window includes its end and excludes its start. Ship facts (radiation, cabin air) are marked `crewWide` and apply to every astronaut. Every number below is a setting in `settings.ts`, with its source or owner decision.

| Rule ids | Fact | How it is computed | Bands |
|---|---|---|---|
| `radiation-solar-event-watch`, `-alert` | `radiationDailyDoseMultiple` | A day's dose = mean dose rate of the ship's readings in that 24 hours × 24 h. The rolling last 24 hours' dose ÷ the mean of the 7 previous 24-hour days' doses. Simulated storm hours replace the recorded hours they overlap (start times less than an hour apart) | 🟡 ≥ 1.25× and < 1.5× · 🔴 ≥ 1.5× |
| `radiation-career-watch`, `-alert` | `radiationCareerFraction`, `radiationProjectedCareerFraction` | Prior career dose (0) + mission absorbed dose (mean rate of the readings since the mission start × hours from the start to the newest reading) × 2.26 mSv/mGy (dose equivalent, an estimate), ÷ 600 mSv; projected uses that mean rate over a 180-day mission. The 2.26 factor is from DOSIS ISS measurements, 286 µGy/day absorbed ↔ 647 µSv/day dose equivalent (Berger et al., DOSIS-3D, J. Space Weather Space Clim., 2016/2017) | 🟡 ≥ 80% while projected < 100% · 🔴 projected ≥ 100% |
| `co2-one-hour-alert`, `co2-one-hour-watch` | `co2OneHourAverageMmHg` | Mean of the ship's CO₂ readings in the last hour | 🟡 2.5–3.0 · 🔴 > 3.0 |
| `co2-seven-day-watch` | `co2SevenDayAverageMmHg` | Mean over the last 7 days | 🟡 ≥ 2.5 |
| `pressure-low-alert`, `pressure-high-alert`, `pressure-shift-watch` | `pressureKPa`, `pressureShiftKPa` | The astronaut's latest watch barometer reading, hPa ÷ 10; its distance from the watch's own average over the 24 hours before it (the newest reading excluded) | 🔴 ≤ 34.5 or > 103 · 🟡 inside those but > 3 kPa from the 24-hour average |
| `cabin-comfort-zone-watch`, `-alert` | `cabinOutsideZone`, `cabinBeyondZoneMargin` | 1-hour means of cabin temperature and humidity as a point on (°C, %RH); point-in-convex-polygon test, edges inside. The margin zone is the zone grown by ±2 °C and ±10% RH (every point within 2 °C **and** 10% RH of some point in the zone), so "outside by > 2 °C or > 10% RH" is 🔴 | 🟡 outside the zone · 🔴 outside the margin zone |
| `noise-day-alert` | `noiseDayLevelDba` | Equivalent continuous level (energy average, Leq) of the astronaut's watch noise readings in the last 24 hours | 🔴 > 70 dBA |
| `noise-sleep-watch`, `noise-awake-watch` | `noiseSleepLevelDba`, `noiseAwakeLevelDba` | Leq of the last 24 hours' readings inside / outside the crew sleep period, 21:30–06:00 UTC | 🟡 > 50 / > 58 dBA |
| `spo2-watch`, `spo2-alert` | `spo2Pct` | The latest real SpO₂ spot reading (not Zepp's nightly score) | 🟡 ≥ 90 and < 95 · 🔴 < 90 |
| `heart-rate-low-alert`, `heart-rate-high-alert` | `heartRateBpm` | The latest real heart-rate reading | 🔴 < 40 or > 180 bpm |
| `heart-rate-above-baseline-*`, `skin-temp-off-baseline-*`, `hrv-below-baseline-*` (watch and alert each) | `heartRateAboveBaselineSd`, `skinTempAwayFromBaselineSd`, `hrvBelowBaselineSd` | The latest real reading in standard deviations from the baseline (§6.2) | 🟡 > 2 and ≤ 3 SD · 🔴 > 3 SD |
| `gravity-exercise-watch`, `gravity-exercise-goal-met` | `exerciseMinutesToday`, `utcHourOfDay` | Exercise minutes today (below) and the hour of the UTC day. Both rules rate Gravity only when they fire (`ratesOnlyWhenFired`), so at any other time Gravity has no status | 🟡 < 60 minutes at or after 18:00 UTC · 🟢 ≥ 120 minutes; no 🔴 |
| `nutrition-energy-*` | `energyDayPctOfEer` | Yesterday's kcal ÷ the EER (Req. 1, p. 14). NASA's table: 90–100% green, 80–90% yellow, < 80% red, "110%" yellow and "120%" red without ranges; the strict reading is an owner decision | 🟢 90–100% · 🟡 80–90% or 100–120% · 🔴 < 80% or ≥ 120% |
| `nutrition-protein-*` | `proteinDayPctOfKcal` | Yesterday's protein × 4 kcal/g (the standard Atwater factor) ÷ yesterday's kcal (Req. 2, p. 18) | 🟢 15–30% · 🟡 10–15% or 30–35% · 🔴 < 10% or > 35% of calories |
| `nutrition-protein-minimum-watch` | `proteinDayGPerKg` | Yesterday's protein ÷ body mass (Req. 2, p. 18: 0.8 g/kg per day). Protein's status is the worse of this rule and the share rules (owner decision) | 🟡 below 0.8 g/kg; no 🔴 (NASA gives none) |
| `nutrition-calcium-*` | `calciumDayMg` | Yesterday's total (Req. 20, p. 78) | 🟢 1200–2000 · 🟡 1000–1200 or 2000–2500 · 🔴 < 1000 or > 2500 mg |
| `nutrition-vitaminD-*` | `vitaminDDayUg` | Yesterday's total (Req. 8, p. 45) | 🟢 25–50 · 🟡 10–25 or > 50 · 🔴 < 10 µg |
| `nutrition-sodium-*` | `sodiumDayMg` | Yesterday's total (Req. 23, p. 34). NASA's table: 1500–2300 green, 500–1500 yellow, < 500 and > 3500 red; its upper yellow row reads only "3500 mg/d", and the owner decided the 2300–3500 gap is yellow | 🟢 1500–2300 · 🟡 500–1500 or 2300–3500 · 🔴 < 500 or > 3500 mg |

A band edge belongs to the greener band (e.g. calcium 1200 and 2000 mg are 🟢, 1000 and 2500 are 🟡), except energy's 🔴, which starts at 120%. A nutrition total is rated when every meal logged that day has a value for it, or when its "at least" value is already certain (§5.5); a day with no meals is not rated. Rules that need a missing profile field (age, sex, mass, height) are pending, listed with `profile.<field>`.

**Coverage.** A windowed average needs a reading in every 15-minute slot of its window (slots counted back from now), or in every hour for the ship's hourly RadLab, OSDR and simulated data, whose readings are hourly means. Otherwise the fact has no data. This applies to the 1-hour CO₂, temperature and humidity averages, each 24-hour radiation day, the 24-hour noise levels and the 24-hour pressure average. Also (owner decisions): the 7-day CO₂ average needs readings on at least 5 of its 7 days; the baseline counts only days with at least one reading (and needs 7 such days in its 14-day window); the mood and stress averages need at least 2 check-ins in their 3 days.

**Expiry.** A metric whose newest reading is too old reports **no recent data**: it is listed in the status response's `noRecentData` and gets no status. Heart rate, HRV, skin temperature and pressure expire after 15 minutes; SpO₂ and ECG after 24 hours; the ship's radiation and cabin sensors after 2 hours (owner decision). Expiry applies to the newest reading; today's heart-rate history still counts toward exercise minutes and the baseline.

**Real readings only.** An astronaut's facts use only real readings: the status reads each metric's newest non-simulated reading, so a newer simulated reading never hides a newer real one. Readings kept for history and charts only are skipped the same way (owner decision): Zepp's nightly HRV (`hrv` from `zepp`) and nightly SpO₂ score (`spo2` from `zepp`) are left out of the facts, the HRV baseline, the chart reference lines built from it, the derived latest HRV and today's SpO₂ task, so a Zepp night never hides a Galaxy Watch spot reading. They still appear in `latest` and the charts. Zepp heart rate and sleep are read by the rules. One module, `server/src/domain/rule-sources.ts`, decides all of this; the status, today's tasks (exercise minutes and the ECG/SpO₂ checks) and the readings store's rule queries all take it from there.

**Pending rules.** A rule whose setting is `null` is still defined: it never fires and is listed in the status response's `pendingRules` with the settings it waits for. It becomes active when its numbers are set in `settings.ts`. Every current setting is decided, so no rule is pending while the astronaut's profile is complete. A rule whose data is missing is skipped and does not rate its area.

**Statuses.** Each metric's status is the worse of its standard and baseline rules (exercise minutes do not rate heart rate). An area's status is the worst of the rules that could run in it, combination rules included; it is `null` ("no status") when none rated it: no recent data, no meals logged yesterday, no watch data today, or (Gravity) no gravity rule firing. The overall status is the worst area status. Every unrated area carries a plain-language `reason` built from the settings and the data, e.g. "Baseline needs readings on 7 days (5 so far)", "No meals logged yesterday", "No watch data today", "Baseline readings do not vary yet, so there is no normal range to compare with". Vitals reports progress from the baseline metric with the most days (heart rate, skin temperature, HRV); Mind's baseline rules read HRV only, so its reason names HRV and counts HRV's days alone, e.g. "HRV baseline needs readings on 7 days (5 so far)" (owner decision; Zepp's chart-only nightly HRV does not count).

**Alert log.** Each evaluation compares every area's status and every firing rule with the last stored state, and logs each change: time, subject (area, or rule with its area and metrics), from → to (a rule not firing is "normal"; an area with no status is null), title, and the rule's message when it starts firing. A rule that stops firing is logged as "<title>: cleared". The server evaluates every astronaut each minute, and on every status request, one evaluation at a time: all of them queue in the one server process and read their data only when their turn comes, so no older status is ever logged after a newer one (§5.7, Phase 7 review). `GET /api/astronauts/:id/alerts` serves the log (detail-page history); each rule that starts firing at 🔴 is also relayed to the surgeon's alert feed (§8).

**Chart reference lines.** `GET /api/astronauts/:id/reference-lines` (and `reference` on each series response) gives each chart's normal band and watch/alert thresholds in the chart's own unit, so clients compute none: SpO₂, CO₂ and noise from the settings; heart rate's 40/180 bpm extremes plus, once the personal baseline is ready, mean + 2 SD (🟡) and + 3 SD (🔴); skin temperature ± 2/3 SD; HRV − 2/3 SD; pressure in hPa (NASA's range, and ± 3 kPa around the watch's own 24-hour average once known); radiation at 1.25× and 1.5× the previous 7-day average dose rate. The temperature + humidity zone is two-dimensional, so it has no single-chart lines. A line's label never repeats the plotted value, but may name the rule's parameter, which is intended: e.g. "2 SD above your baseline", "1.25× the 7-day average", "3 kPa above the 24-hour average" (owner decision). Clients show the label, then the value and the chart's unit. Lines drawn from the settings (SpO₂, heart-rate extremes, CO₂, pressure limits, noise) are worded from their catalog rule's status and comparison through the same function as the limits list below (e.g. "Watch below", "Alert at or below", "Sleep period, watch above"), so a changed rule changes the chart label too.

**Limits in use.** `GET /api/settings` also lists every limit in plain language per area (`limits`, §10), built in `server/src/domain/rules/limits.ts`: each limit names its rule, which gives its area and source; its number is a setting the rule reads; its status is the rule's (null for a window or a count); and a threshold's wording comes from the rule's status and the comparison the rule makes with that setting, so a changed band cannot leave a stale label (a limit naming a missing rule, a threshold setting its rule does not compare exactly once, or a parameter setting its rule does not read, is an error, caught by the tests). Labels keep the status word ("watch", "alert"); a limit whose setting is unset is left out (owner decisions). Gravity lists the daily goal (`exercise.dailyGoalMinutes`), the 🟡 rule worded from `gravity.exerciseCheckFromHourUtc` and `gravity.exerciseWatchBelowMinutes` ("Exercise today, from HH:MM UTC, watch below"), and the exercise-minute cutoff (`exercise.moderateIntensityFraction`, as % of max heart rate); Nutrition lists each nutrient's watch and alert bands.

**Daily exercise minutes.** `GET /api/astronauts/:id/exercise/daily` (§10) counts each UTC day with the function behind today's exercise minutes, so the Gravity chart, the status and the exercise task always agree. `range=mission` starts on mission day 1, the mission settings record's start date (owner decision).

**Derived values** (pure domain functions, computed on the server, returned in the status response):

- **HRV** (`hrv`, RMSSD): when the watch posts `ibi`, the server re-derives HRV for every 5-minute window the new beats fall in, with the §5.7 method, and stores it as the `hrv` metric under the reading's source (replacing the window's earlier value). Each beat gets its own time: `takenAt` is the first beat and each following beat is `takenAt` plus the intervals before it; an interval belongs to the window holding the beat it starts at, so a batch crossing a window boundary is split. The watch drops invalid intervals before uploading, so no flags are sent; the 300–2000 ms range still applies. The status response shows the newest `hrv`.
- **Sleep** (`sleep`, hours asleep): detected from the watch's `wristAngle` minutes with the §5.7 sleep method (van Hees et al. 2018), once per noon-to-noon day (in the sleep-day time zone, §5.7) after it ends, re-derived hourly for the last 7 ended days, and stored as one `sleep` reading per night from source `watch`, stamped at the waking time. It is a stored reading, not a status field: the behavioral-health rules' short-sleep condition (`shortSleepNightsInARow`, `sleep.shortNightHours` 6 h, `sleep.shortNightsInARow` 3) reads it with the Zepp nights, **one reading per night** (owner decision): a night is the noon-to-noon day (in the sleep-day time zone, §5.7) its waking time closes; storage already keeps the Galaxy Watch's night over Zepp's, and if a night still holds two readings (a Zepp nap and a night) the longest counts, as the Zepp import treats the longest session as the night. The dashboard's Mind card shows the newest night.
- **Exercise minutes today** (§5.4): UTC minutes of the current UTC day whose mean heart rate is ≥ `exercise.moderateIntensityFraction` (0.64) × (220 − age); a minute with no reading does not count. The goal is the `exercise.dailyGoalMinutes` setting (120). `null` when the astronaut's age is unknown or there is no heart-rate reading today.
- **Radiation multiple**: the same daily-dose comparison the radiation rule uses, in µGy (`dailyDoseUGy`, `previousSevenDayAverageUGy`) and as dose equivalent (estimate) in mSv with the `radiation.doseEquivalentPerAbsorbedDose` factor (`dailyDoseMSv` for the rolling 24 hours, `previousSevenDayAverageMSv` per day; owner decision; `null` while the factor is unset).
- **Mission dose** (`missionDose`: `mSv`, `careerLimitMSv`, `shareOfCareerLimit`, `projectedMSv`, `projectedShareOfCareerLimit`, `projectionDays`): the dose equivalent (estimate) since the mission start and its 180-day projection, from the same facts as the career rules, against the career effective-dose limit as the closest stand-in.
- **Nutrition** (`nutritionToday`, `nutritionYesterday`): each UTC day's meal count, "at least" totals with unknown-meal counts per nutrient, the targets (green bands, EER, protein grams), and a status per check (energy, protein, calcium, vitamin D, sodium). Today's statuses are all `null` (not rated); yesterday's are the rules' verdicts, `null` where a total is unknown or no meals were logged.

**Expected statuses on the real data.** The real ISS record alone, as a rolling 24 hours, gives 🟡 from 2017-09-11T14:00Z, 🔴 for 7 hours between 16:00Z and 2017-09-12T00:00Z (peak 1.547×), 🟡 again through 2017-09-12T07:00Z and at 23:00Z (1.252×), and single 🟡 hours on Sept 20, 23 and 26. At the end of Sept 11 it is 1.473× (🟡). On the loop the event plays about 13 days after the server starts (🔴 then, as in the record); at the start (the recording's first hour, after the previous loop's Sept 22–29) radiation is 🟢, and the mission dose projects to about 170 mSv (28% of the limit) over 180 days. The labeled simulated storm (default factor 5) gives 🔴 radiation for the whole crew. The real 2018 cabin record has CO₂ 1-hour 🟡 in 381 of its 841 hours, one 🔴 hour (3.011 mmHg on 2018-08-19) and six hours outside the temperature + humidity zone; at the start of the loop the cabin is 🟢. With the Zepp history loaded (2026-11-14), heart rate has readings on every UTC day of the last 14, so its personal baseline is available; HRV (Galaxy Watch only; Zepp's nightly HRV is chart-only) has 5 distinct days in the window, skin temperature 5, so neither has a baseline yet. The newest heart rate, HRV and skin temperature have expired (older than 15 minutes), and there is no SpO₂ spot reading (Zepp's nightly score is chart-only), so none of them rates Vitals until live data arrives. The newest Zepp night is 2026-11-08, outside the 3-night sleep window, so the sleep condition of the behavioral-health rules has no data and is skipped. With no meals logged, Nutrition has no status.

## 7. Gamification

| Earns points | Examples |
|---|---|
| Measurements on schedule | Daily ECG, SpO₂ check, mood check-in, meal logging |
| Healthy habits | Exercise minutes, sleep goal, nutrition targets met |

- **Streaks** for consecutive days of on-schedule measurements.
- **Badges** for milestones (e.g., "7-day check-in streak", "Bone Guardian" for meeting exercise targets for a week).
- Points and streaks show on the dashboard and the watch.
- **Scheduled prompts** ("Time for your ECG") appear on the watch and the dashboard.
- **Daily schedule** (owner's configuration, stored on the server so the watch reminders and the dashboard's "Today's tasks" agree; served by `GET /api/astronauts/:id/schedule`). On every start the server replaces the stored schedule with the configured one, so it always matches this table exactly and tasks no longer configured are removed:

  | Task | Time |
  |---|---|
  | Breakfast (meal logging) | 08:00 |
  | Lunch (meal logging) | 13:00 |
  | Dinner (meal logging) | 19:00 |
  | ECG | 09:00 |
  | Blood oxygen (SpO₂) | 09:00, 21:00 |
  | Mood check-in | 20:00 |

  | Exercise (daily goal) | no set time |

  Each task has an id, kind (`ecg`, `spo2`, `checkIn`, `meal`, `exercise`), label, local time `HH:MM` (null for the exercise task), and the astronaut it applies to (every astronaut by default). Times are the spacecraft's local time, which is **UTC** (decided: the ISS keeps UTC as station time).
- **Done-state from real activity (owner decision):** `GET /api/astronauts/:id/tasks/today` marks a task done when real activity of its kind is recorded within 2 hours (the `tasks.doneWithinMinutes` setting) before or after its time today: a meal logged, a check-in, or an ECG or SpO₂ reading (never simulated, and never Zepp's nightly SpO₂ score, which is history only, §5.7). Tasks of the same kind never share one activity; each takes the earliest unused one in its window, in time order. This holds across midnight too: days are worked out in order and an activity used by one day's task is not used again the next day, so a 23:30 task and the next day's 00:30 task cannot both take one check-in (no window crosses midnight with the current schedule). There is no manual ticking. The exercise task is done once today's exercise minutes reach the daily goal, and shows its progress (minutes / goal). Each task also carries its `points` (below).

**Gamification as built (Phase 6, server and dashboard).** Code: `server/src/domain/gamification/` (pure points, streak and badge calculations, the task history, the summary use case, live updates) on top of `server/src/domain/today-tasks.ts` and `server/src/domain/task-points.ts`; `server/src/db/badges-repo.ts`; `server/src/http/routes/points.ts`. Types: `shared/src/gamification.ts`.

- **Points per task (owner decision, from the approved dashboard mockup):** ECG **20**, each SpO₂ check **10**, mood check-in **15**, each meal task (breakfast, lunch, dinner) **10**, the daily exercise goal **40**. They are settings in `server/src/domain/rules/settings.ts` (`points.ecg`, `points.spo2`, `points.checkIn`, `points.meal`, `points.exercise`), served with the others by `GET /api/settings`; a task whose setting is unset earns nothing. With the schedule above (two SpO₂ checks, three meals) a full day is worth **125** (owner decision: keep these values).
- **Meals (owner decision):** a meal task earns its 10 points once when it is done (a meal logged in its window); further foods logged for the same meal earn nothing.
- **Only tasks done count (owner decision):** points come only from tasks done by the done-state rules above (real activity, never simulated). There are no sleep or nutrition-target points for now.
- **Since mission day 1 (owner decision):** every UTC day from the mission settings record's start date (2026-11-05) to today is worked out with the same done-state function as today's tasks, from the real activity stored, so earlier days count as they happened. The current schedule applies to every day, earlier ones included (owner decision). A day with no activity simply earns nothing.
- **Past days are kept (performance):** today's tasks, the points, the streak and the badges all read one task history per astronaut (`task-history.ts`). A day is kept only once it is **settled**: its last task's match window has closed plus the 5-minute clock skew a reading may run ahead (now ≥ day start + 24 h + `tasks.doneWithinMinutes` + 5 min), since an activity stamped a little in the future is stored before a read can see it. Later reads go back only to the first unsettled day, or to the earliest day a write has touched since: a meal or check-in added or removed, or an ECG, SpO₂ or heart-rate upload, marks the days its match window reaches (so a write at 00:30 also marks the day before). An upload marks its days as soon as its readings are stored, before any later step that could fail, and also when every reading in it was a duplicate, so a retried batch still reaches the points. When a read resumes after the kept days, every activity those days used is carried over, so no activity completes two tasks whatever the window. A mark that lands while a read is in progress keeps that read from being kept. A crew change on board (an astronaut added or removed), a new age (it sets the exercise threshold) or a new mission start reads the whole history again. The schedule and the settings cannot change while the server runs (the schedule is configured at start, the settings are code), so a restart, which empties the history, covers a change to either; there is no `PUT` for the schedule. Measured on a throwaway database (2026-11-15): the real data since 2026-11-05 takes about 30 ms read whole and 4 ms with past days kept; a synthetic 70-day mission (100,800 heart-rate minutes, test data only) takes about 300 ms read whole (once, primed at start) and 4 ms kept (17 ms after a write three days back).
- **Imported heart rate counts (owner decision):** exercise minutes read the heart rate the rules read (`rule-sources.ts`), so the imported Zepp heart rate counts toward the exercise task's points and toward Bone Guardian, as it does for the Gravity status.
- **Streak (owner decision):** consecutive UTC days on which **every measurement task** (ECG, both SpO₂ checks, mood check-in) is done; meals and exercise do not affect it. Today does not break it until the day is over: while today is incomplete the streak counts through yesterday, and once today is complete it includes today (`streak.includesToday`). A day with no measurement task at all never counts.
- **Badges (owner decision):** exactly two, each earned once, on the UTC day its run completes (`earnedOn`): **"7-day check-in streak"** (the mood check-in done 7 UTC days in a row) and **"Bone Guardian"** (the daily exercise goal met 7 UTC days in a row). The run lengths are the `badges.checkInStreakDays` and `badges.boneGuardianDays` settings (7). **Stored once earned (owner decision):** when working out the points finds a badge earned (the first such run since mission day 1) that is not stored yet, it is stored with its day in the `badges` table (`server/src/db/badges-repo.ts`) before the summary is served, and it is **never removed or moved to another day**, even if a record behind it is later deleted. So the badge list is stable: both badges are always listed, in `BADGE_IDS` order, and a badge's `earnedOn` goes from null to a day once and never changes again, which lets the watch buzz once per badge (on the change from null). The calculation stays pure (`badges.ts`: what the activity earned, which of those are new, the list from the stored badges); the use case does the storing.
- **Served** by `GET /api/astronauts/:id/points` (`PointsSummary`) and, with the status per area, `GET /api/astronauts/:id/summary` (§10), for the dashboard and the watch.
- **Live (owner decision):** after every write that can complete or undo a task (a meal or check-in added or removed, an ECG, SpO₂ or heart-rate upload), when an astronaut is added or removed on board, at start (the schedule was just configured) and with each minute's upkeep (a new day), the server works out the astronaut's points again and, when anything changed, pushes a `points` message on `/ws/onboard`; the dashboard reloads its data on it, without a page reload, and only for the astronaut it shows (owner decision). The area detail pages show no points and do not reload on it (pending owner review). Recomputes run one at a time per astronaut, and changes during a run fold into one more run.
- **When points cannot be loaded:** the dashboard and the meal picker load points (and the meal picker its tasks) as a status-like load: a failure shows "Points unavailable" in the points tile, the earned-today line, the badges and the meal log, and the rest of the page still works.
- **Two calls, two snapshots (pending owner review):** the dashboard reads `GET .../tasks/today` and `GET .../points` separately; both come from the same task history, but a write that lands between the two calls can make "N of 8 done" and "+X pts earned today" differ until the next reload. The API is unchanged.
- **The meal picker's points (pending owner review):** its "+N pts from meal tasks" is the sum, in the web app, of the server-given `points` of today's meal tasks the server marks done; the server decides which are done and what each is worth. The API is unchanged.

## 8. Relay and communication delay

| Preset | One-way delay | Demo setting |
|---|---|---|
| ISS | ~0 s | 0 s |
| Moon | ~1.3 s | 1.3 s |
| Mars (close) | ~3 min | Scaled down to 10 s |
| Mars (far) | ~22 min | Scaled down to 30 s |

- The surgeon console shows **"data as of"** times and a **"delay"** badge, so judges can see the lag.
- A **"real time" toggle** switches off the scaling to show true delays.
- The surgeon can send a note back to the astronaut, which goes through the same delay.

**Relay as built (Phase 5, server).** Code: `server/src/domain/relay/` (pure delay math and each side's use cases), `server/src/db/relay-repo.ts`, `server/src/jobs/delivery-timer.ts`, `server/src/relay-system.ts` (wiring), `server/src/http/live.ts` (WebSocket). Types: `shared/src/relay.ts`.

- **One queue in Postgres** (`relay_events`): every event that crosses records its kind, payload, `sentAt` and `deliverAt`, so a restart loses nothing. On start the server hands over everything that arrived while it was down, then a timer hands each event over at its `deliverAt` (crew changes take effect, WebSocket clients are told). Each side reads only events whose `deliverAt` has passed.
- **An event that cannot take effect (owner decision):** a failing arrival effect is retried after growing gaps (5 s, doubling, each at most 2 minutes), holding back only the later events going the same way, so each direction keeps its order (owner decision): ship → Earth and Earth → ship are ordered separately, and a stuck crew change never delays a 🔴 alert or its live push to the ground. Once the retries have taken about 10 minutes a `deliveryFailure` report is queued for the ground (once per event) and only then is the event set aside as failed, so the report cannot be lost (the crew grid lists it under `failedChanges`), and that direction flows again. The schedule is in named constants in `server/src/domain/relay/retry-schedule.ts`.
- **Delay:** `deliverAt = sentAt +` the one-way delay at send time, but never before the event sent ahead of it in the same direction, so shortening the delay cannot reorder events. Each event carries `seq`, its place in its direction's send order. Events already on their way keep their arrival time when the preset changes. The setting (`preset`, `realTime`) is stored in the mission record; the default is ISS with demo scaling.
- **Spacecraft → ground, alerts (owner decisions):** every rule that starts firing at 🔴 or 🟡, escalates (🟡 → 🔴) or eases (🔴 → 🟡) is sent to the ground's alert feed (All / Alert / Watch); only 🔴 is the automatic flight-surgeon notification. The surgeon can acknowledge and resolve 🟡 items as well as 🔴 ones. A **crew-wide** rule (the ship's sensors, e.g. the solar event) is **one alert for the whole crew**: only the first astronaut evaluation that sees its crew-level status change sends it (`crewWide: true`), filed under that astronaut, and every astronaut's dashboard shows it; acknowledging or resolving it shows as handled for everyone (owner decision). The alert log marks each one in the same transaction that logs the change (an outbox), and each evaluation (each minute and on every status request) sends everything still marked, for every astronaut, so a failed send is retried and an alert is never lost or sent twice. A pending alert is sent even if its astronaut has been removed since, and is never sent again as new if the id rejoins (owner decision). Each relayed alert carries `alertLogId`; alert ids in the feed are relay event ids. A **status snapshot** (overall and area statuses, `at` = evaluation time) is sent whenever an evaluation logs a change, and otherwise once a minute, which keeps the crew grid's "data as of" fresh. **Read receipts** go down when the astronaut marks a note read. The **crew roster** (each astronaut's watch with its last contact and battery, plus the registered watches no one wears) goes down on every start, after each crew change takes effect, at once when a new watch registers, and with the next minute's upkeep when one is owed (watches have reported since, or a roster send failed) (owner decision: once a minute is enough for battery and last contact). The **mission** (name, start, day, gravity) goes down on start and when it changes (a new mission day). Status snapshots older than 7 days are pruned each minute, always keeping each astronaut's newest snapshot that has arrived.
- **Ground → spacecraft:** the surgeon's **acknowledge / resolve** of an alert (new → acknowledged → resolved, or new → resolved; the ground's own state changes at once, the crew sees it one delay later), **notes**, and **crew and watch changes** (add or remove an astronaut, assign, replace or unassign a watch; a watch worn by someone else moves). A crew change takes effect on board when it arrives; the ground shows it as pending until the roster confirming it comes back, one more delay later. Applying the change and sending that roster are separate steps, retried separately (owner decision): only a change that could not be applied is ever retried, set aside or reported as failed; if the roster cannot be sent, it is owed and goes with the next minute's upkeep, so the ground just sees the update late. The ground judges each change against the crew it expects (the last roster plus the changes on their way). Every check and the send it guards (acknowledge/resolve, crew changes, notes, read receipts) run under one lock per direction, so several surgeon consoles at once cannot both pass a check. A profile value the astronauts table could not hold is refused with `400` before it is queued (age ≤ 150 years, mass ≤ 650 kg, height ≤ 3 m), and note text and names must contain a visible character (they are trimmed).
- **Watches (owner decisions):** a watch sends `device: { watchId, batteryPct }` with its uploads (`POST /api/readings`). Its first accepted upload registers it; its last contact is the time of its latest accepted upload, and its battery the level it last reported. If recording the watch fails, the upload still succeeds (its readings are stored and pushed) and the failure is logged. A watch assigned before it has uploaded shows `null` for both.
- **Removing an astronaut sticks** (owner decision): the row and their stored history stay, hidden from every crew view, and the bundled data loader does not bring them back on restart; only the ground adding the id again does.
- **Daily logs** (owner decision): each crew member's check-ins, calories per UTC day (counted on board from the menu, a lower bound when a meal's food has no published kcal) and exercise minutes per UTC day (counted as `GET /api/astronauts/:id/exercise/daily` counts them), all since mission day 1, go down as one `dailyLog` event on start and with each minute's upkeep whenever they changed. The first run after a start builds each log in full; each later run rebuilds only today and yesterday (UTC), or from the day of the previous run if that was longer ago, and keeps the earlier days as already built and sent (owner decision), with the same result as a full rebuild. A write that lands on an earlier day marks that day changed where it is made (a check-in or meal posted with an earlier time, a check-in or meal deleted, heart-rate readings uploaded late; an upload marks its days as soon as its readings are stored, and also when every reading in it was a duplicate, so a batch retried after a failure still reaches the log), and the next run rebuilds from that day, so the ground gets the corrected day one delay later without a restart. An astronaut removed or added again, or whose profile changed (exercise minutes depend on the age), has their whole history rebuilt at the next run. A mark is cleared only once its rebuild has been sent, so a failed read or send keeps it for the next run. A send that fails is tried again at the next run. The ground's charts of them (`GET /api/ground/astronauts/:id/daily-log`) read only what has arrived, and only each astronaut's newest arrived log is kept.
- **Ground charts** (owner decision): `GET /api/ground/astronauts/:id/series` returns chart data only up to now − the current one-way delay, what Mission Control can know. This is an **approximation**: it reads the onboard store with a time cutoff rather than readings that came through the relay. It also charts a removed astronaut's stored history (read-only); crew views still hide them.
- **Notes** stay plain text of at most 2,000 characters.
- **Live clients only listen:** a client that sends a malformed or oversized frame (over 1 KiB) is dropped and logged; the server carries on.

## 9. Screens

### 9.1 Astronaut dashboard (`/astronaut`)

**Mockup (approved):** [canvas](https://claude.ai/artifact/NuySSDEsrguZXXx17PhqDv) · source in `mockups/astronaut-dashboard.dc.html`

**Look:** dark mission-control style by default, with a light mode toggle in the header. Fonts: Space Grotesk (headings), Inter (body), JetBrains Mono (numbers).

**Status styling:** every status has a color **and** a symbol, so it never relies on color alone:

| Status | Symbol | Dark | Light |
|---|---|---|---|
| Normal | ● | `#3DDC97` | `#0F7B4F` |
| Watch | ▲ | `#FFC24B` | `#8A5A00` |
| Alert | ■ | `#FF6B7A` | `#B42335` |

**Layout, top to bottom:**

1. **Header:** app name and astronaut · mission day · gravity · points and streak · next reminder (highlighted) · Earth link status and delay · theme toggle.
2. **Attention banners:** one per active 🔴 or 🟡 item, red above yellow. Each shows the title and area, plus the three-part message (what it means / why in space / what to do). Red banners have a thicker border and a **"Alert sent to flight surgeon · arrives in m:ss"** tag that counts down the relay delay.
3. **Card grid:** six cards: Vitals, Radiation, Gravity, Cabin, Nutrition, Mind. Each shows the title, hazard/source, status pill, main value and unit, a mini chart with the normal band shaded, 2–3 secondary readings, and a one-line note. Red cards use a red mini-chart line. The grid wraps to one column on narrow screens.
4. **Today's tasks:** checkboxes with point values (ECG, SpO₂, check-in, meals, exercise) and a done count plus points earned today ("3 of 8 done · +60 pts earned today"), then the two badges with the day each was earned (§7).

**As built (Phase 6):** the header's **Points · Streak** tile shows the points since mission day 1 and the streak in days ("1,240 · 9d"), with today's points and whether the streak includes today under it; each task shows its server-given points ("+20"). All of it comes from `GET /api/astronauts/:id/points` and the tasks' `points`, and reloads when a `points` live message arrives (§7).

- **Status grid:** one 🟢/🟡/🔴 card per hazard area. Clicking a card opens its detail. A card with no status shows the server's `reason` under "No status". Every number in card text (limits, goals, targets) comes from the server (`GET /api/settings`, the status response), never typed in the web app. Charts draw the server's reference lines (§6.7).
- **Detail (approved, full page):** mockup in `mockups/card-detail-radiation.dc.html`. Clicking a card opens a full page with: back button to the dashboard · title, status badge and data source · the active alert/watch banner · four key numbers · main chart with **1 h / 24 h / 7 d / Mission** range buttons, the normal band shaded and the alert threshold dashed · a second chart specific to the area (radiation: mission dose vs. limit) · history of past alerts and watches · a **Learn** panel (what it is, how it's measured in space, why it matters, when it needs attention, link to the NASA source). Every card gets a page in this pattern.
- **ECG on the Vitals card (Phase 7, owner decision):** the card's sub-lines are SpO₂, skin temperature and "ECG · taken HH:MM UTC · 30 s recording" (the date is added when the ECG is from an earlier UTC day); the detail page also lists HRV. No waveform is drawn. The dashboard reloads within seconds of an upload, without a manual reload, when the `/ws/onboard` `readings` message is for the astronaut it shows and names `ecg` or `spo2` (the measurements the astronaut starts), the same astronaut filter as points; other readings, other astronauts' readings and the detail pages (which name no astronaut, as for points) wait for the page's regular one-minute refresh.
- **Panels:** Vitals (HR, ECG, SpO₂, skin temperature), Radiation, Gravity, Cabin, Nutrition (meal picker), Mind (check-in).
- **Meal picker (approved, full page from the Nutrition card):** mockup in `mockups/meal-picker.dc.html`. Search box plus category buttons (All, Breakfast, Entrées, Sides, Snacks, Drinks). Food cards show name, category, NASA food type (Rehydratable, Thermostabilized, Irradiated, Natural form, Beverage), calories, protein, and **+ Add**. Side panel: today's totals as bars vs. daily targets (calories, protein, calcium, vitamin D, sodium as an upper limit), and today's log with times, remove buttons and the points today's meal tasks have earned (+10 per meal task done, not per food logged; owner decision, §7). The mockup's nutrition values were placeholders; the build uses the real NASA/USDA values from the menu loaded into Postgres (§5.5).
- **Stretch:** clickable body figure. Each region opens its system (heart → cardiovascular, bones → gravity, and so on), as suggested in the challenge.

### 9.2 Flight surgeon console (`/surgeon`)

**Mockup:** [canvas](https://claude.ai/artifact/NuySSDEsrguZXXx17PhqDv) · source in `mockups/surgeon-console.dc.html`. The user is a **NASA flight surgeon in Mission Control** (the challenge names "flight surgeons on the ground"). Layout is **alerts first**: a large alert feed (All / Alert / Watch filters) with a crew summary beside it. Opening an alert shows its message, what the astronaut was told, a 6-hour chart leading up to it, a note box, and **Acknowledge · Send note · View full charts · Mark resolved**. Each alert shows ship send time and ground receive time. Crew and watch management is a **separate tab** ("Crew & Watches").

- **Crew grid:** one row per astronaut × hazard areas, color coded. The crew is one astronaut for now (Astronaut 1) and grows later (§2).
- **Alert feed:** 🔴 and 🟡 alerts in order of arrival (All / Alert / Watch filters), with "sent at" vs. "received at"; a crew-wide alert appears once.
- **Astronaut drill-down:** same charts as the dashboard (read-only), plus "send note".
- **Delay control:** mission preset selector.
- **Storm control (demo, Phase 7, owner decision):** a dashed panel under the header, "Simulated deep-space solar storm", with one button that steps through **Start storm (Radiation ▲ watch)** and **Escalate storm (Radiation ■ alert)**, and **Clear storm** (§5.7). It says it is a demo control acting on simulated data at once, and that the alerts reach the ground after the link delay. The console reloads only on ground deliveries, so after a storm change made elsewhere its control can be out of date: the press then gets 409, the message says what the ship has, and the control reloads (pending owner review, §5.7).
- **Crew and watch management:** the surgeon adds and removes astronauts, assigns a watch to an astronaut, unassigns or replaces it, and sees each watch's last contact and battery. Changes travel to the spacecraft through the relay, so they take effect after the delay.

### 9.1a Astronaut dashboard header

Mission name, day count, gravity setting (from `GET /api/mission`: name "Heartbeat ISS Demo", start 2026-11-05, gravity ISS; mission day 1 is the start date, UTC) · points and streak · next reminder · link status to Earth with the current delay · dark/light toggle (dark by default).

### 9.3 Watch app

**Mockups (approved, large text):** [canvas](https://claude.ai/artifact/NuySSDEsrguZXXx17PhqDv) · source in `mockups/watch-home-large.dc.html` (home), `mockups/watch-vitals-large.dc.html` (Vitals), `mockups/watch-list-large.dc.html` with `watch-recovery-large`, `watch-cabin-large` and `watch-food-large` (the shared list page), and `mockups/watch-settings-large.dc.html` (Connection). Sizes are physical pixels on the 450 × 450 px, 340 dpi screen: labels at least 20 px, body text at least 24 px, numbers at least 44 px, buttons at least 64 px tall. They supersede the earlier small-text mockups (`watch-home-B`, `watch-vitals`, `watch-recovery`, `watch-cabin`, `watch-settings`, `-not-tested`, `-failed`, `-input-error`, `watch-food-today`, `watch-vitals-reminders-late`), whose 11–13 px text was about 1 mm high on the real 1.4" display; those files are kept for their content and states, drawn in the large scale. Options A and C of the old home screen are kept for reference only.

- **Approved deviations from the large mockups:** the scroll indicator is the standard curved Wear OS one (in the mockup's colors), shown only when the list is longer than the screen; a meal row's note is the food's menu category (the server stores no meal names); an alert dot on home has a 4 px ring; the Connection status has a second line (the last upload, or what to check); the lists have no page dots. A meal row stacks the time, the menu category and the food, the food across the whole row, as a worded value (Inter, like "Not taken yet") wrapping onto as many lines as it needs, so the whole name is always readable.
- **Time:** every time the watch shows is spacecraft time, UTC, and says so ("19:43 UTC"): the clock, reading times, reminder and next-due times, the last upload, meal times and measurement results. "Today" is the UTC day.
- **Home:** six 106 px area dots in a circle (Vitals, Radiation, Gravity, Cabin, Food, Mind) around the clock (34 px), the UTC day and battery ("Sat 14 · 36%") and the status summary. Statuses come only from the server's rules engine (`GET /api/astronauts/:id/status`, §6.7, §10); the watch never rates readings. Each dot shows its status color and symbol (an alert gets a thicker outline). An area the server has not rated is neutral: a "○" and ring in `#3A4250`. When the server has statuses and none is yellow or red, the center shows "● All normal" in `#3DDC97` where the alert/watch counts go. Points and streak show once the server provides them (see **Points and badges** below).
- **Home navigation:** each dot is a tap target (the whole dot, labeled for accessibility). Vitals opens the Vitals list; Radiation and Cabin open the Cabin list; Gravity and Mind open Recovery & body (the mood check-in is posted from the dashboard, so the watch has no check-in screen); Food opens **Food today**. Back (the button or the swipe) on a readings list returns straight to home; back on home leaves the app.
- **Readings (swipe from home):** three vertically scrolling lists (touch or rotary), the clock and title fixed at the top, one reading per full-width row (label and note on the left, the number and unit on the right), the row at the edge fading out, and a scroll indicator on the right. A watch or alert reading gets a 2 px border in its status color.
  1. **Vitals:** heart rate, blood oxygen, skin temperature (only while the watch is worn, confirmed by heart-rate contact), ECG (time the last ECG was taken, or "Not taken yet"; note "next 09:00 UTC" or "next 09:00 UTC tomorrow" from the server's schedule; no classification on the watch)
  2. **Recovery & body:** HRV (`derived.hrv` from the server, which derives it from the beat-to-beat intervals the watch sends as `ibi`), exercise minutes ("45 /120 min", `derived.exerciseToday` from the server: minutes at or above 64 % of 220 − age against the daily goal, §5.4; "--" until the server provides them), sleep (`sleep`, h), muscle mass (`bodyComposition`, skeletal muscle mass in kg)
  3. **Cabin:** radiation ("times above normal", e.g. "1.0×", `derived.radiationDailyDose.multiple`, with the raw dose rate in µGy/h as the note; "--×" until the server provides it), CO₂, cabin temperature and humidity (ship data), pressure (watch barometer, once a minute), noise (microphone), then a 64 px round gear button to Connection settings.

  Each note says when and where a reading came from, with the shared source labels (`READING_SOURCE_LABELS`, §5.7): `watch` → "Galaxy Watch", `wxserver` → "Galaxy Watch history", `zepp` → "Zepp watch", `radlab` and `osdr` → "ship data", `manual` → "manual", `simulated` → "simulated". A reading the server lists in `noRecentData` says "no recent data"; a watch sensor that is failing (and being restarted) says "sensor unavailable"; while Samsung's sensors are not available, their tiles (HRV, skin temperature, SpO₂, ECG) say why ("Samsung Health starting…", "Samsung sensors unavailable", "Samsung SDK not in this build").
- **Food today:** read-only list (`watch-food-large`): one row per meal logged today (UTC time, the menu category, the food; `GET /api/astronauts/:id/meals` from midnight UTC) and the total kcal from the menu (`GET /api/menu`). A food the menu has no kcal for still counts as a meal, its row says "kcal not on menu", and the total row reads "Total, at least"; kcal are never guessed. "Add meals on the dashboard": meals are added only in the web UI.
- **Connection settings:** a list (`watch-settings-large`) reached from the gear at the end of the Cabin list; it is not a swipe page. The status first (26 px): "● Connected" with the last upload, "○ Not tested yet", or "■ Can't reach server" / "■ Token refused" with what to check and how many readings are waiting; then, only when non-zero, how many readings were lost ("3 readings rejected · 0 dropped (queue full)"); then the fields, entered on the watch (22 px label, 30 px value): server address (host:port is enough), token (hidden after saving) and astronaut id with the name from `GET /api/astronauts` ("a1 · Astronaut 1"; just the id until the name is known); then **Test connection**. Values from the build config are defaults only. **Test connection** calls `GET /api/health`, then checks the token by posting an empty batch (`{"readings":[]}`, which the server accepts and stores nothing from); a `401` shows "■ Token refused". Last it checks that the astronaut id is on the crew list (`GET /api/astronauts`); if not, it shows "■ Unknown astronaut" in the failure layout, with the astronaut row so the id can be fixed ("■ No astronaut set" when the id is empty). A refused value opens the input-error screen: the field with a red border, "■ That isn't a valid address", an example ("Use host:port, for example 192.168.2.1:4000"), **Edit** and a disabled **Save**.
- **Measurements:** tapping the blood oxygen or ECG row, or a reminder, opens the measurement, in the large scale. Blood oxygen (`watch-measure-spo2`): an indeterminate spinning ring, "Measuring…", the instruction and **Cancel**; the sensor reports no progress, and the watch gives up after 60 s. ECG (`watch-measure-ecg`): a progress ring, the live ECG line, the countdown of the 30 s recording (which only runs with a fingertip on the button), "Rest your arm and keep a fingertip on the top button.", a "Top button ↗" pointer and **Cancel**. Result (`watch-measure-result`): the value and unit, "✓ Sent to server · 14:06 UTC" once it is on the server, "Status appears once the server's rules check it." and **Done**; no judgment on the watch. Failed (`watch-measure-failed`): "▲ Couldn't get a reading", advice, "Nothing was sent to the server.", **Close** and **Try again**.
- **Reminders:** at the exact times of the server's daily schedule (`GET /api/astronauts/:id/schedule`, the same list as the dashboard's "Today's tasks"; times are UTC, §7); the last schedule received is kept, and with none received nothing is reminded. A task with no set time (the daily exercise goal) has no reminder. Each reminder vibrates, says when it was due in UTC ("Due 09:00 UTC"; the notification asks Wear OS to hide its own timestamp, but the Galaxy Watch's notification list still shows the posting time in the watch's local time), and opens the matching measurement where the watch has one. Exact alarms need the user's permission (SCHEDULE_EXACT_ALARM); while it is missing, reminders are still scheduled inexactly and the Vitals list starts with "▲ Reminders may be late" and an **Allow** button to the system setting. Reminders are re-armed after a reboot and after a time or time-zone change.
- **Uploads:** every batch carries `device: { watchId, batteryPct }`: a random id made once per install and kept on the watch (never the hardware serial or MAC address), and the battery percentage from the BatteryManager (`null` when the system does not report it). Every reading waits in a queue kept on the watch (up to 25,000; when full the oldest 1,000 are dropped at once) until the server accepts it. A batch the server refuses because readings in it are invalid (400) is split in halves and resent until only the refused readings are left; those are dropped and counted, the rest are delivered. A refusal of the whole request (404 `unknown_astronaut`, 413, any other 4xx) drops nothing: the readings stay queued and are retried, and the Connection screen shows why.
- **Orientation (owner decision):** the screen never turns sideways and never rotates with the accelerometer. The Galaxy Watch5 Pro on Wear OS 6 ignores app orientation requests (its display sets `ignoreOrientationRequest`), so **the watch's auto-rotate must be off** (owner decision, 2026-11-15). The watch's Settings app has no auto-rotate switch, so it is turned off over adb: `adb shell settings put system accelerometer_rotation 0` and `adb shell settings put system user_rotation 0` (check with `adb shell settings get system accelerometer_rotation`, which must print `0`). That adb step in `watch/README.md` is the only safeguard: the app shows no warning when auto-rotate is on (owner decision). As a backup on watches that honor app requests, the app is one activity fixed to the natural portrait orientation (`screenOrientation="portrait"`); every screen, including the measurements and the screens reminders open, is drawn inside it.
- **Surgeon notes (approved mockup `watch-notes-large`, owner decisions 2026-11-15):** the watch polls `GET /api/astronauts/:id/notes` with the uploads (every 15 s). Notes are checked whenever the app's process runs, also while no health readings are being collected (owner decision). Each unread note it has not announced before buzzes the watch and posts "Note from Flight Surgeon" with the text and "Sent 14:06 UTC" (collapsed, the card starts with the sent time, as only two lines show; expanded, it follows the text) and an **Open** action; the ids of notes whose notification was posted are kept on the watch, so a note never buzzes twice, also after a restart. A note read elsewhere (from the dashboard: the notes list gives its `readAt`) has its notification taken away at the next poll (owner decision). A note whose notification could not be posted (notifications not allowed) is announced, once, at the first poll after they are allowed. The notification never opens the note by itself: during an ECG or SpO₂ measurement it only buzzes, and a note opened then waits until the measurement is closed. **Open** shows the note screen on top, like a measurement; if the note cannot be fetched then, the open is dropped and nothing pops up later (the note waits unread behind the home pill): the clock and "Flight Surgeon"; "Sent 14:06 UTC · about Radiation dose spike" (the "about" part only when the note has an `alertId` whose title `GET /api/astronauts/:id/relayed-alerts` gives; otherwise dropped); the text at 28 px, scrolling if long; and a 64 px **Mark read** button, the only place a note is marked read. It posts `POST /api/astronauts/:id/notes/:noteId/read` (with the token), and the read receipt travels to the ground; the screen then shows "✓ Read · 14:10 UTC" in green. If the receipt does not reach the server (no answer, a timeout, a `5xx`), the screen says "Couldn't reach the server. Try again."; if the token is missing or refused (`401`/`403`), it says "Token refused. Check Connection settings.", matching the Connection screen's "■ Token refused" (pending owner review); if the server answers `404` `unknown_note`, it says "The server no longer has this note." and the note is dropped from the watch, so it leaves the unread pill (owner decision); the note's text and that line stay on screen, without the **Mark read** button, until the astronaut goes back (owner decision). Back (button or swipe) from a note always goes home, closing Food today or Connection settings if they were open underneath. If a note is dismissed unread, home shows a blue "✉ 1 note" pill ("✉ 2 notes") under the status line; tapping it opens the oldest unread note, one screen per note, and the pill is gone once every note is read.
- **Points and badges (Phase 6, watch):** the watch only shows what the server works out (§7); it never counts points.
  - **Home line:** the points since mission day 1 and the streak in days show as one small line directly under the day and battery, "1,240 pts · 9d" (owner decision). Nothing shows until the server has provided points (owner decision). The line is 20 px JetBrains Mono in `#7FB4FF`, the style of the points line in `watch-home-B`, inside the center column between the six 106 px dots (pending owner review). The streak is `streak.days` as the server gives it; whether today is in it yet (`includesToday`) is not shown (pending owner review). A dropped connection keeps the last line (pending owner review). The line shows only the current astronaut's points: when the astronaut id changes on the Connection screen it goes at once, and when the server no longer knows the astronaut (`404` `unknown_astronaut`) it goes, until that astronaut's points arrive (pending owner review).
  - **Polling:** `GET /api/astronauts/:id/points` is polled in the same 15 s loop as the surgeon notes, whenever the app's process runs (owner decision). Each round checks the notes first, then the points, so the radio wakes once per round, and the 15 s pause starts once the round's requests are done (pending owner review). Each step in a round is contained: one that throws (anything but cancellation) is logged and skipped, so a broken badge store can never stop note polling or crash the app (pending owner review). The watch does not listen to the `points` live message on `/ws/onboard`; the poll is simpler and battery-friendly (pending owner review).
  - **New badge:** each badge newly earned gives a short buzz and the notification "Badge earned: <name>", once per badge, kept on the watch so it never repeats after a restart (owner decision). Like a note, a badge whose notification could not be posted (notifications not allowed) is announced once, at the first poll after they are allowed (owner decision). During an ECG or SpO₂ measurement it only buzzes (owner decision). The notification then follows, silently, at the first poll after the measurement ends (pending owner review). The buzz is one 250 ms pulse, unlike a note's or a reminder's; the notification's body is the badge's description from the server; tapping it opens home (pending owner review). A badge is announced once per badge and astronaut, and its notification id is made from the same "astronautId/badgeId" key, so a watch moved to another astronaut announces that astronaut's badges as their own (pending owner review). Earned badges are permanent on the server, so the watch never takes an announcement back.
  - **Already earned:** the first time a watch receives an astronaut's points, badges earned before that UTC day are not new and are recorded without a buzz; one earned that day is announced (pending owner review).

## 10. API (onboard server)

**Writes need the shared token.** Every `POST`, `PUT` and `DELETE` must send `Authorization: Bearer <HEARTBEAT_TOKEN>`, or it gets `401`. `GET`s stay open. The token comes from the server's environment (the gitignored `.env`; see `.env.example`). Astronaut ids include `ship` for the spacecraft's own sensors (radiation, cabin).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness check |
| `GET` | `/api/astronauts` | The crew, with each astronaut's profile: `age` (years), `sex` (`male` \| `female`), `massKg`, `heightM`, each `null` when unknown |
| `POST` | `/api/readings` | Watch posts a batch of readings. Returns `{ accepted, duplicates }`: a reading with the same astronaut, metric, time and source as a stored one is ignored. `400` if a reading is more than 5 minutes in the future, its unit doesn't match the metric (e.g. heart rate `bpm`, SpO₂ `%`, radiation `µGy/h`), or its value has the wrong shape: `ecg`, `ibi` and `wristAngle` take only a non-empty array of numbers (an empty one gets `400` `{ error: "empty_array", index, metric, message }`), every other metric only a single number. An optional `device: { watchId (1–64 characters), batteryPct (0–100 or null) }` on the batch registers the watch and records its contact and battery (§8); out of range gets `400`. Clients cannot post `hrv` or `sleep` (the server derives them): either gets `400` `{ error: "server_derived_metric", index, metric, message }`, whose message names the metric to send instead (raw beat-to-beat intervals go as `ibi`, wrist angles as `wristAngle`). Each `ibi` batch re-derives `hrv` for the 5-minute windows its beats fall in (§6.7). A watch heart rate deletes the imported Zepp heart rate in its minute, and a derived `hrv` the Zepp HRV in its window (the Galaxy Watch wins, §5.1) |
| `GET` | `/api/astronauts/:id/latest` | Latest value of every metric |
| `GET` | `/api/astronauts/:id/series?metric=&range=&bucket=` | Chart data. `range` = `1h` \| `24h` \| `7d` \| `mission` (all stored data up to now), **or** `from`/`to` as ISO times (not both); default is the last 7 days. Optional `bucket` = 1–43200 minutes averages points; omit it for raw points. No reading after now is returned (the mission clock stores future loops). A simulated reading replaces the recorded readings of the same metric taken less than an hour from it (owner decision: charts match the rules, nothing is averaged), and a bucket containing a simulated reading is labeled "simulated", so demo data is never shown as recorded. Invalid input gets `400` |
| `GET` | `/api/menu` | Space food menu (from the database) |
| `POST` | `/api/astronauts/:id/meals` | Log a meal from the menu (`foodId`, optional `eatenAt`); unknown food ids get `400` |
| `GET` | `/api/astronauts/:id/meals?from=&to=` | Meal log (default: last 24 hours) |
| `DELETE` | `/api/astronauts/:id/meals/:mealId` | Remove a logged meal |
| `POST` | `/api/astronauts/:id/checkins` | Mood/stress check-in (`mood`, `stress` 1–5, optional `at`) |
| `GET` | `/api/astronauts/:id/checkins?from=&to=` | Check-ins (default: last 14 days) |
| `DELETE` | `/api/astronauts/:id/checkins/:checkInId` | Remove a mistaken check-in (token required); unknown ids get `404` `not_found` |
| `GET` | `/api/astronauts/:id/status` | The rules engine's verdict (§6.7): `overall` status, one status per area (in `AREAS` order, `null` when nothing could rate it, with a plain-language `reason`), per-metric statuses, the fired `evaluations` (alerts first, each with its `title`, three-part message, source with citations, layer and `crewWide`), `pendingRules` with the settings each waits for, `noRecentData` (metrics whose newest reading expired), and `derived` values (latest HRV, exercise minutes today with the `exercise.dailyGoalMinutes` goal, the radiation daily dose (µGy and dose equivalent in mSv) and multiple, `missionDose`, `nutritionToday` unrated and `nutritionYesterday` rated). Each request also records status changes in the alert log. Ship radiation and cabin air count for every astronaut. Unknown astronaut (including `ship`) gets `404` |
| `GET` | `/api/astronauts/:id/schedule` | Daily task schedule for reminders and "Today's tasks" (§7): the tasks for this astronaut plus those for everyone, in time order, the task with no set time last |
| `GET` | `/api/astronauts/:id/tasks/today` | Today's tasks as `TaskState` (`taskId`, `kind`, `label`, `localTime`, `done`, `doneAt`, `points` (what the task earns once done; null while its setting is unset) and, for exercise, `progress` `{ value, goal, unit }`) (§7) |
| `GET` | `/api/astronauts/:id/alerts?area=&from=&to=` | The alert log as `AlertLogEntry`s: status changes in the range (default: last 7 days), oldest first, optionally for one area; an unknown area gets `400` (§6.7) |
| `GET` | `/api/astronauts/:id/reference-lines` | Every chart's `ChartReference` (normal band and watch/alert thresholds) with its metric and unit (§6.7); the series response carries the same as `reference` |
| `GET` | `/api/mission` | The mission settings record: `name`, `startDate`, today's `missionDay` (counted by the server; day 1 = the start date, UTC), `gravity` `{ preset, label }`, and `sleepDayTimeZone` (the IANA zone of the sleep day, default `UTC`, §5.7) |
| `PUT` | `/api/mission/sleep-day-time-zone` | Set the sleep day's time zone (`{ timeZone }`, an IANA name such as `UTC` or `America/Indiana/Indianapolis`); an unknown zone gets `400` `{ error: "unknown_time_zone", timeZone, message }`. The sleep job re-derives the recent nights in the new zone before the reply (after any run in progress), which is the updated mission record (§5.7) |
| `GET` | `/api/astronauts/:id/exercise/daily?range=&from=&to=` | Exercise minutes per UTC day for the Gravity chart, as `ExerciseDay`s (`day`, `minutes`, `goalMinutes`), oldest first, never past today. `range` = `7d` (the default: today and the 6 days before) \| `mission` (every day since mission day 1, the mission settings record's start date; just today when there is no record), **or** `from`/`to` as ISO times (not both; each UTC day they touch, at most 366). Each day is counted whole (today up to now) by the same function as today's status and exercise task (§5.4), from the heart rate the rules read (`rule-sources.ts`, so Zepp heart rate counts): `minutes` is `null` when the age is unknown or the day has no heart-rate reading. Invalid input gets `400` (`invalid_range`, `range_and_times`, `invalid_date`, `range_too_long`); unknown astronaut `404` |
| `GET` | `/api/settings` | Every rule setting and the expiry ages, for clients to display (never to apply), always including `DISPLAY_SETTING_KEYS`; and `limits`: every limit the rules use as `AreaLimit`s (`area`, plain-language `label`, optional `value` and `unit`, `status`, and the rule's `source`), grouped by area in `AREAS` order, for the dashboard's "Limits in use" list. A threshold's label is worded from its rule's status and comparison (e.g. "Blood oxygen, watch below" with `value` 95, `unit` "%"); labels never repeat the number, so clients show the label, then the value and unit. A limit whose setting is unset is left out |
| `GET` | `/api/demo/solar-storm` | The simulated storm's state (`SolarStormState`): `active`, the `factor` it was made with (2 decimals, read back from the stored hours; null when none), and `startedAt`, when the latest storm started (kept after a clear; null before the first). Starting (`POST`, which replaces any earlier storm) or clearing (`DELETE`, answering `SolarStormCleared` with `clearedAt`) the storm evaluates every astronaut before the reply, so its alert is sent at once (§5.7). A storm pressed 48 hours ago or more counts as none. `DELETE /api/demo/solar-storm/started-at` forgets `startedAt` (the reset, once it has resolved that storm's alerts) and answers with the state |
| `POST` | `/api/demo/solar-storm` | Start the labeled simulated solar storm (`SolarStormPress`: optional `factor`, 1–50, default 5; §5.7). Its 48 hourly points run from 47 hours ago to now. Answers `SolarStormStarted`. With `expectedFactor` (the storm the sender saw; null for none), a press made after the storm changed gets `409` `SolarStormConflict` (`storm_changed`, a message and the `current` state) and changes nothing (pending owner review) |
| `DELETE` | `/api/demo/solar-storm` | Clear the simulated storm |
| `GET` | `/api/astronauts/:id/points` | Points, streak and badges (§7) as `PointsSummary`: `totalPoints` since mission day 1, `today` (`points`, `possiblePoints`, `tasksDone`, `tasks`), `streak` (`days`, `includesToday`) and `badges` (`id`, `name`, `description`, `earnedOn` or null), worked out from the tasks done each UTC day. A newly earned badge is stored before the reply and never removed, so `earnedOn` never changes once set (§7). Unknown astronaut `404` |
| `GET` | `/api/astronauts/:id/summary` | `AstronautSummary`, a compact payload for small screens such as the watch: `overall` and one status per area (as the status gives them; like a status request, it records status changes in the alert log) plus `points` (the `PointsSummary`). Unknown astronaut `404` |
| `GET` | `/api/watch/:id` | *Planned:* compact payload for the watch (status, readings, reminders, points) |
| `GET` | `/api/relay/delay` | The relay setting (`preset`, `realTime`), its `label` and `oneWayDelayMs`, and every preset's real and demo delay (`RelayDelayResponse`, §8) |
| `PUT` | `/api/relay/delay` | Change the preset and/or the real-time toggle (`{ preset?, realTime? }`, at least one; the other is kept). Applies to events sent from then on |
| `GET` | `/api/ground/crew` | Ground side, the crew grid from delivered data only (`GroundCrewResponse`): the last roster, each astronaut's latest status snapshot with `receivedAt`, `dataAsOf`, the relay setting, `unassignedWatches`, `pendingChanges` (crew changes not yet confirmed by a roster, with `arrivesOnboardAt`) and `failedChanges` (changes the spacecraft could not apply) |
| `GET` | `/api/ground/mission` | The mission as its last report through the relay had it (`GroundMissionResponse`: `mission`, `sentAt`, `receivedAt`) |
| `GET` | `/api/ground/astronauts/:id/series?metric=&range=&bucket=` | Like the onboard series, but only data up to now − the one-way delay, an approximation read from the onboard store (`GroundSeriesResponse` adds `dataAsOf`, `oneWayDelayMs`); also serves a removed astronaut's stored history |
| `GET` | `/api/ground/astronauts/:id/daily-log` | The astronaut's mood and stress check-ins, calories per UTC day and exercise minutes per UTC day since mission day 1, as their last **daily log** through the relay had them (`GroundDailyLogResponse`: `log`, `sentAt`, `receivedAt`; nulls before the first has arrived). Read only from relayed reports, never from the onboard tables; also serves a removed astronaut's last log |
| `POST` | `/api/ground/crew/astronauts` | Add an astronaut (`id`, `name`, optional `age` 0–150, `sex`, `massKg` up to 650, `heightM` up to 3) through the relay; `400` outside those, `409` `astronaut_exists` |
| `DELETE` | `/api/ground/crew/astronauts/:astronautId` | Remove an astronaut through the relay (their readings are kept); `404` `unknown_astronaut` |
| `PUT` | `/api/ground/crew/astronauts/:astronautId/watch` | Assign or replace the astronaut's watch (`watchId`) through the relay |
| `DELETE` | `/api/ground/crew/astronauts/:astronautId/watch` | Unassign the astronaut's watch through the relay |
| `GET` | `/api/ground/alerts?from=&to=` | The surgeon's alert feed: 🔴 and 🟡 alerts (`status`, `crewWide`) that have reached the ground, sent in the range (default: last 7 days), in order of arrival, as `GroundAlert` (`sentAt`, `receivedAt`, `lagMs`, `state` `new` \| `acknowledged` \| `resolved`, the message the astronaut was told) |
| `POST` | `/api/ground/alerts/:alertId/acknowledge` | Acknowledge an alert (🔴 or 🟡); travels to the crew with the delay. `404` `unknown_alert`, `409` `invalid_transition` |
| `POST` | `/api/ground/alerts/:alertId/resolve` | Mark an alert resolved; travels to the crew with the delay |
| `POST` | `/api/ground/notes` | Surgeon note (`astronautId`, `text` with a visible character, trimmed, optional `alertId`) → relay → astronaut; `404` for an astronaut or alert the ground does not know |
| `GET` | `/api/ground/notes?astronautId=` | Notes sent, with `deliverAt` and, once the read receipt has arrived, `readAt` |
| `GET` | `/api/astronauts/:id/notes` | Onboard: notes that have reached the astronaut (`OnboardNote`, with `readAt`) |
| `POST` | `/api/astronauts/:id/notes/:noteId/read` | Onboard: mark a note read; the read receipt travels to the ground. Again: answers with the receipt already sent. `404` `unknown_note` before it has arrived |
| `GET` | `/api/astronauts/:id/relayed-alerts?from=&to=` | Onboard: the alerts sent to the flight surgeon (`OnboardAlert`), with `sentAt` and `deliverAt` for the banner's "arrives in m:ss" countdown, and the surgeon's `handling` once it has arrived |
| `WS` | `/ws/onboard` | Live updates to the astronaut dashboard and watch, one JSON `LiveMessage` each: `readings` (`astronautId`, `metrics`, as soon as an upload adds readings), `status` (every evaluation's `AstronautStatus`), `relaySent` (alerts, snapshots and read receipts leaving), `relayDelivered` (notes, alert handling and crew changes arriving), `relayDelay`, `points` (the astronaut's `PointsSummary`, whenever a write or a new day changes it, §7) |
| `WS` | `/ws/ground` | Live updates to the surgeon console: `relayDelivered` (alerts, status snapshots, read receipts, rosters, mission reports and delivery failures arriving), `relaySent` (notes, alert handling and crew changes leaving), `relayDelay` |

Writes through the relay answer `202` with the `RelayEvent` sent (`id`, `kind`, `direction`, `payload`, `sentAt`, `deliverAt`).

**Differences from the dashboard's planned types** (`web/src/lib/domain/planned-types.ts` on phase-3-dashboard): `TaskState` adds `doneAt` (the time of the activity that completed the task), and its `kind` is `ScheduledTaskKind`, which already includes `"exercise"`. `AlertLogEntry.ruleId` and `message` can be `null` (a change of an area's own status has no rule or message, and a rule that stops firing has no message). `ChartReference` adds `basis` (`settings`, `baseline` or `previousSevenDays`). `MissionDose` adds `projectedShareOfCareerLimit`.

### Shared types (`shared/`)

```ts
type Status = "normal" | "watch" | "alert";
type Hazard = "radiation" | "isolation" | "distance" | "gravity" | "environment";
const AREAS = ["vitals", "radiation", "gravity", "cabin", "nutrition", "mind"] as const;
type Area = (typeof AREAS)[number];

const METRICS = ["heartRate", "spo2", "skinTemp", "hrv", "ibi", "ecg", "pressure", "noise",
  "bodyComposition", "sleep", "wristAngle", "radiationDoseRate", "co2", "cabinTemp", "humidity"] as const;
type Metric = (typeof METRICS)[number]; // sleep in h; bodyComposition = skeletal muscle mass in kg; ibi in ms; wristAngle in deg

interface Reading {
  astronautId: string;   // "ship" for radiation and cabin
  metric: Metric;        // "heartRate" | "spo2" | "skinTemp" | "hrv" | "ecg" | "pressure" | ...
  value: number | number[]; // number[] only for the ECG waveform, ibi intervals and wristAngle epochs; a single number otherwise
  unit: string;
  takenAt: string;       // ISO time
  source: "watch" | "wxserver" | "zepp" | "radlab" | "osdr" | "manual" | "simulated";
}

// How each source is named to people; every client uses this map (owner decision).
const READING_SOURCE_LABELS = {
  watch: "Galaxy Watch", wxserver: "Galaxy Watch history", zepp: "Zepp watch",
  radlab: "ship data", osdr: "ship data", manual: "manual", simulated: "simulated",
} as const satisfies Record<ReadingSource, string>;

interface ReadingsBatch { readings: Reading[] }               // POST /api/readings
interface ReadingsAccepted { accepted: number; duplicates: number }

type SeriesRange = "1h" | "24h" | "7d" | "mission";
interface SeriesPoint { t: string; value: number; n: number; source: ReadingSource }
interface SeriesResponse {
  astronautId: string;
  metric: Metric;
  unit: string;
  bucketMinutes: number | null;
  points: SeriesPoint[];
  reference: ChartReference | null; // the chart's band and lines (§6.7); null when the metric has none
}
interface LatestReading { metric: Metric; value: number | number[]; unit: string; takenAt: string; source: ReadingSource }

interface Astronaut {
  id: string; name: string; watchId: string | null;
  age: number | null;           // years
  sex: "male" | "female" | null;
  massKg: number | null;
  heightM: number | null;
}
interface MealLog { id: number; astronautId: string; foodId: string; eatenAt: string }
interface CheckIn { id: number; astronautId: string; mood: number; stress: number; at: string }
interface FoodMenu { sources: FoodSource[]; notes?: string; foods: Food[] }
interface ScheduledTask {
  id: string;
  kind: "ecg" | "spo2" | "checkIn" | "meal" | "exercise";
  label: string;
  localTime: string | null;     // "HH:MM", spacecraft local time (UTC); null = no set time
  astronautId: string | null;   // null = every astronaut
}

type RuleLayer = "standard" | "baseline" | "combination";
interface RuleSource { requirementId: string | null; document: string; ours: boolean; citations: string[] } // e.g. "[V2 6004]" or "Req. 20"

interface Evaluation {          // one rule that fired
  astronautId: string;
  ruleId: string;
  title: string;                // e.g. "Radiation dose spike"
  area: Area;
  hazard: Hazard | null;        // null when the rule maps to no hazard (most vitals rules)
  metrics: Metric[];            // the metrics the rule read
  layer: RuleLayer;
  status: Status;
  message: { what: string; why: string; do: string };
  source: RuleSource;
  crewWide: boolean;            // reads only ship sensors, so it applies to the whole crew
  at: string;                   // newest data the rule read
}

interface AreaStatus { area: Area; status: Status | null; reason: string | null } // reason only when unrated
interface MetricStatus { metric: Metric; status: Status }
interface PendingRule { ruleId: string; area: Area; waitingFor: string[] } // unset setting keys, or "profile.<field>"
interface DerivedValues {
  hrv: { rmssdMs: number; at: string } | null;
  exerciseToday: { day: string; minutes: number | null; goalMinutes: number; thresholdBpm: number | null };
  radiationDailyDose: { dailyDoseUGy: number; previousSevenDayAverageUGy: number; multiple: number;
                        dailyDoseMSv: number | null; previousSevenDayAverageMSv: number | null; at: string } | null; // mSv = dose equivalent (estimate)
  missionDose: { mSv: number; careerLimitMSv: number; shareOfCareerLimit: number; projectedMSv: number;
                 projectedShareOfCareerLimit: number; projectionDays: number; at: string } | null;
  nutritionToday: NutritionDayStatus;      // complete: false, statuses all null
  nutritionYesterday: NutritionDayStatus;  // the rated day
}
type Nutrient = "kcal" | "proteinG" | "calciumMg" | "vitaminDUg" | "sodiumMg";
type NutritionCheck = "energy" | "protein" | "calcium" | "vitaminD" | "sodium";
interface NutritionDayStatus {
  day: string; complete: boolean; mealsLogged: number;
  totals: Record<Nutrient, { atLeast: number; unknownMeals: number }>;
  targets: { kcal, proteinG, proteinPctOfKcal, calciumMg, vitaminDUg, sodiumMg: { min: number | null; max: number | null }; eerKcal: number | null };
  statuses: Record<NutritionCheck, Status | null>;
}
interface AstronautStatus {     // GET /api/astronauts/:id/status
  astronautId: string;
  at: string;
  overall: Status | null;
  areas: AreaStatus[];
  metrics: MetricStatus[];
  evaluations: Evaluation[];
  pendingRules: PendingRule[];
  noRecentData: Metric[];       // newest reading expired: no status
  derived: DerivedValues;
}
interface TaskState {          // GET /api/astronauts/:id/tasks/today
  taskId: string; kind: ScheduledTaskKind; label: string; localTime: string | null;
  done: boolean; doneAt: string | null; progress: { value: number; goal: number; unit: string } | null;
  points: number | null;        // what the task earns once done (§7); null while its setting is unset
}
// Gamification (shared/src/gamification.ts, re-exported from index.ts; §7)
const BADGE_IDS = ["checkInStreak", "boneGuardian"] as const;
interface Badge { id: BadgeId; name: string; description: string; earnedOn: string | null } // "YYYY-MM-DD" UTC
interface PointsSummary {      // GET /api/astronauts/:id/points; the `points` live message
  astronautId: string; at: string; day: string;   // day = today, UTC
  totalPoints: number;          // since mission day 1, today included
  today: { points: number; possiblePoints: number; tasksDone: number; tasks: number };
  streak: { days: number; includesToday: boolean };
  badges: Badge[];              // BADGE_IDS order, earned or not
}
interface AstronautSummary { astronautId: string; at: string; overall: Status | null; areas: AreaStatus[]; points: PointsSummary } // GET /api/astronauts/:id/summary
interface Mission { name: string; startDate: string; gravity: "iss" | "moon" | "mars" | "earth" }
interface MissionResponse { name: string; startDate: string; missionDay: number; gravity: { preset: "iss" | "moon" | "mars" | "earth"; label: string } }
interface AlertLogEntry {      // GET /api/astronauts/:id/alerts
  id: string; at: string; area: Area;
  metric: Metric | null;        // the rule's metric when it reads exactly one; null for area changes
  ruleId: string | null;        // null for a change of the area's own status
  from: Status | null; to: Status | null; title: string;
  message: { what: string; why: string; do: string } | null; // when a rule starts firing
}
interface ChartReference {
  band: { low: number | null; high: number | null } | null;
  thresholds: Array<{ value: number; status: "watch" | "alert"; label: string }>;
  basis: "settings" | "baseline" | "previousSevenDays";
}
interface MetricReferenceLines extends ChartReference { metric: Metric; unit: string } // GET /api/astronauts/:id/reference-lines
const CHECK_IN_SCALE = { min: 1, max: 5 } as const;  // mood and stress; CHECK_IN_LABELS names the ends
const DISPLAY_SETTING_KEYS = ["radiation.doseEquivalentPerAbsorbedDose", "exercise.dailyGoalMinutes", "exercise.moderateIntensityFraction"] as const; // keys clients show by name; the server's settings must include them
interface RuleSettingsResponse {
  settings: Record<string, number | null> & Record<DisplaySettingKey, number | null>;
  maxReadingAgeMinutes: Partial<Record<Metric, number>>;
  limits: AreaLimit[];          // every limit in plain language, by area in AREAS order
}
interface AreaLimit {           // shown as label, then value and unit: "Blood oxygen, watch below" 95 "%"
  area: Area; label: string; value?: number; unit?: string;
  status: Status | null;        // past the limit; "normal" for a goal; null for a parameter (a window, a count)
  source: RuleSource;           // the source of the rule the limit belongs to
}
const EXERCISE_DAY_RANGES = ["7d", "mission"] as const;
interface ExerciseDay { day: string; minutes: number | null; goalMinutes: number | null } // GET /api/astronauts/:id/exercise/daily
const SHIP_METRICS = ["radiationDoseRate", "co2", "cabinTemp", "humidity"] as const; // the ship's own sensors, defined once

// The relay (shared/src/relay.ts, re-exported from index.ts)
const DELAY_PRESETS = ["iss", "moon", "marsClose", "marsFar"] as const;
interface RelaySetting { preset: DelayPreset; realTime: boolean }
interface RelayDelayResponse extends RelaySetting { label: string; oneWayDelayMs: number; presets: DelayPresetInfo[] }
interface RelayPayloads {        // each kind travels one way only (RELAY_DIRECTIONS)
  status: StatusSnapshot;        // toGround: { astronautId, at, overall, areas }
  alert: RelayedAlert;           // toGround: alertLogId, astronautId, ruleId, title, area, metric, status, crewWide, message, at
  readReceipt: ReadReceipt;      // toGround: { noteId, astronautId, readAt }
  roster: CrewRoster;            // toGround: { astronauts: RosterEntry[], unassignedWatches: WatchInfo[], lastAppliedChangeSeq }
  mission: MissionResponse;      // toGround
  dailyLog: DailyLog;            // toGround: { astronautId, at, checkIns, calories: DailyCalories[], exercise: ExerciseDay[] }
  deliveryFailure: DeliveryFailure; // toGround: { eventId, kind, reason, attempts }
  alertState: AlertStateChange;  // toOnboard: { alertId, astronautId, state: "acknowledged" | "resolved" }
  note: SurgeonNote;             // toOnboard: { astronautId, text, alertId }
  crewChange: CrewChange;        // toOnboard: addAstronaut | removeAstronaut | assignWatch | unassignWatch
}
interface RelayEventOf<K extends RelayEventKind> {
  id: string; kind: K; direction: "toGround" | "toOnboard"; seq: number; payload: RelayPayloads[K];
  sentAt: string; deliverAt: string;
}
type RelayEvent = RelayEventOf<"status"> | RelayEventOf<"alert"> | /* ... one per kind */;
interface RosterEntry { astronautId: string; name: string; watch: { watchId: string; lastContactAt: string | null; batteryPct: number | null } | null }
interface DeviceReport { watchId: string; batteryPct: number | null }  // optional `device` on ReadingsBatch
// Views: GroundCrewResponse, GroundAlert, GroundNote, GroundMissionResponse, GroundSeriesResponse, GroundDailyLogResponse, OnboardNote, OnboardAlert; LiveMessage for /ws/*
```

## 11. Scope: must-have vs. stretch

**Must-have (demo works end to end):**

1. Watch app sends live HR + SpO₂ (+ ECG if the SDK works; otherwise a recorded ECG) to the onboard server.
2. Astronaut dashboard: status grid, charts, color coding, three-part messages, meal picker, check-in, points/streak.
3. Bundled RadLab radiation and OSDR cabin data, shown on their panels.
4. Gravity panel with the mission setting and exercise minutes against the goal.
5. Rules engine with standard ranges + baseline + at least 2 combination rules.
6. Relay with delay presets; surgeon console with crew grid and auto alerts.
7. Watch shows status, live readings, points and one reminder.
8. Flight surgeon notes reach the astronaut after the relay delay, on **both** the dashboard and the watch (vibration + note on screen).

**Stretch (only if time allows):**

- Clickable body figure
- Noise level from the watch microphone
- Body composition (BIA) feeding the gravity panel
- Real sleep data: built (live, from the watch accelerometer on the server, §5.7; owner decision: no phone in space)
- Badges beyond streaks: built (the two badges of §7)

## 12. Team split (one day)

| Person | Owns |
|---|---|
| **A — Watch** | Kotlin Wear OS app, Samsung Health Sensor SDK, posting readings, watch UI |
| **B — Server + data** | TS server, rules engine, relay/delay, downloading and bundling RadLab/OSDR/menu data, importing watch history |
| **C — Web** | Next.js astronaut dashboard + surgeon console, charts, color coding |

**Rough timeline**

| Time | Milestone |
|---|---|
| Hour 0–1 | Repo setup; agree on `shared/` types and the API (§10); **A** confirms watch sensor access; **B** downloads NASA data |
| Hour 1–4 | **A:** HR/SpO₂ posting to the server. **B:** readings API, rules engine, bundled real data. **C:** dashboard against the server's real data |
| Hour 4–7 | **A:** ECG + watch UI. **B:** relay + ground side, gamification. **C:** surgeon console, meal picker, check-in |
| Hour 7–9 | Integration: real watch → server → dashboard → relay → surgeon |
| Hour 9–10 | Demo rehearsal, stretch items, slides/video |

## 12a. Build phases (agreed order, one at a time)

| Phase | What we build | Done when |
|---|---|---|
| **0 · Setup** | Monorepo (`server/`, `web/`, `watch/`, `shared/`), shared types, API outline; watch sensor smoke test | All three projects start; the watch shows a live heart rate |
| **1 · Server and data** | TS server, Postgres, readings API; bundled RadLab, OSDR cabin data and food menu; Astronaut 1's watch history | The server returns Astronaut 1's history |
| **2 · Rules** | Status engine: NASA limits (§6.5), baselines, combination rules, three-part messages | The bundled real data and the simulated storm produce the expected 🟡 and 🔴 |
| **3 · Astronaut dashboard** | Next.js: header, banners, cards, detail pages, meal picker, check-in, tasks | Dashboard matches the mockup on live server data |
| **4 · Watch app** | Kotlin: sensors → server, six-dot home, swipe screens, reminders | A watch reading appears on the dashboard |
| **5 · Relay and surgeon console** | Delay queue, ground side, alerts, notes to dashboard and watch, Crew & Watches tab | A 🔴 reaches the surgeon late; their note buzzes the watch |
| **6 · Gamification** | Points, streaks, badges | Tasks update points everywhere |
| **7 · Demo** | End-to-end run, demo script, rehearsal; the surgeon console's storm control, the ECG on the Vitals card, the one-command demo reset | The 3-minute demo works start to finish |
| **8 · Stretch** | Body figure, noise, body composition | **Skipped (owner decision).** Real sleep was built anyway: live from the watch, §5.7 |

## 13. Demo script (≈3 minutes)

Owner decisions (Phase 7): say the real mission day the app shows (never a hard-coded day, and the start date is not moved); the link is **Mars (far)**, 30 s one way with demo scaling; step 3's 🟡 is the first press of the surgeon console's storm control and step 6's 🔴 the second (§5.7); the surgeon console runs on the same Mac as the dashboard, in a second browser tab.

### Before the demo

1. **Docker.** `colima start`, then `docker ps`. If Postgres logs "No space left on device", check `colima ssh -- df -h /var/lib/docker`; `docker volume prune -f` removes only unused anonymous volumes (old test databases), never the named `heartbeat-telemetry_pgdata`.
2. **Server.** The repo root's `.env` holds `POSTGRES_PASSWORD` and `HEARTBEAT_TOKEN` (`cp .env.example .env`). From the repo root: `docker compose up -d --build` (rebuild after pulling new code), then `curl -s localhost:4000/api/health` answers `{"ok":true,...}`.
3. **Web.** `cp web/.env.example web/.env.local` and set its `HEARTBEAT_TOKEN` to the root `.env`'s value (without it every write fails). Use a production build, so no page compiles on stage: `npm run build -w web && npm run start -w web`. Open http://127.0.0.1:3000/astronaut in one tab and http://127.0.0.1:3000/surgeon in a second tab, and visit `/astronaut/vitals`, `/astronaut/radiation`, `/astronaut/cabin`, `/astronaut/nutrition`, `/astronaut/meals`, `/astronaut/check-in` and `/astronaut/mind` once.
4. **Watch.** Build it with the Samsung Health Sensor SDK, or it has no ECG or SpO₂ ("Samsung SDK not in this build"): the `.aar` is license-restricted, so it is not in this repo; copy it into `watch/app/libs/` from the private SDK repo as `watch/README.md` describes, then `./gradlew assembleDebug` and install. Samsung Health developer mode must be on.
5. **Network.** The Mac and the watch on the same **home Wi-Fi** (the watch talks straight to the Mac over Wi-Fi; venue Wi-Fi often blocks device-to-device traffic). Find the Mac's IP with `ipconfig getifaddr en0`, and let the macOS firewall accept port 4000. On the watch: Cabin list, gear, **Connection**: server `<Mac IP>:4000`, the token, astronaut `a1`, then **Test connection** shows "● Connected" and "a1 · Astronaut 1". Wear the watch for a while beforehand so heart rate is fresh.
6. **Reset.** From the repo root: `npm run demo:reset`. It keeps every reading, meal, check-in and record (it never wipes the database), sets Mars (far) with demo scaling, clears the simulated storm (the ship re-evaluates at once, so the next press is a new alert), **waits one link delay plus 2 s** (it prints what it is waiting for) so the storm's alerts still on their way reach the ground, then resolves the open storm-rule alerts in the surgeon's feed **sent while the latest storm was on, from its start to its clear** (others may come from the real ISS record and are left for the surgeon; pending owner review, §5.7), and forgets the storm's start, so a second reset resolves nothing. If a rehearsal alert left the ship but has not arrived (its arrival may be retried, §8), it looks again every 5 s for up to a minute, then names any still missing and keeps the start, so running it again later resolves them. Each request is given up after 30 s. It checks every server answer it acts on, and warns if `web/.env.local` or the watch's SDK `.aar` is missing. Run it after every rehearsal, then **reload the surgeon tab** so its storm control shows the reset (an out-of-date press is refused with a message anyway). **Never tick "Real time"** on the console: one event sent at the real Mars delay holds every later ship → ground event for 22 minutes.
7. **Avoid the real radiation events.** The ISS record loops from the **server's start** (§5.7), so the real record alone shows Radiation 🟡 or 🔴 at fixed hours after each start, every 755-hour loop (about 31.5 days): 🟡 313–315 h, 🔴 315–316 h, 🟡 316–317 h, 🔴 317–322 h, 🟡 322–323 h, 🔴 323–324 h, 🟡 324–331 h (the Sept 2017 event, about day 13), then single 🟡 hours at 346, 526, 597 and 668 h; 7 🔴 and 15 🟡 hours a loop. During them the demo would start with a real 🟡/🔴 already on the dashboard and real alerts in the feed. For the server running on 2026-11-15 (started 06:02 UTC) that is **2026-11-28 07:02 UTC to 11-29 01:02 UTC**, 11-29 16:02, 12-07 04:02, 12-10 03:02 and 12-13 02:02 UTC (one hour each), and the next loop's event from **12-29 18:02 UTC to 12-30 12:02 UTC**. Every restart moves them, so right before the demo run `npm run demo:radiation-forecast` (it reads the server container's start with `docker inspect`, and the mission's start and the crew's profiles from the running server, so the career-dose rules count too (none fire on the real record: about 28% of the limit); `--started <ISO>` and `--days <n>`, a whole number from 1 to 365, override; a window already on is listed as starting "now") and pick a time outside every window it lists; a restart about a day before the demo also clears them for 13 days.

### The script

1. **Mission setup:** "Day *N* aboard the ISS": read the day from the header's **Mission day** tile (day 1 is 2026-11-05, UTC). Show the gravity setting and the Earth link tile, "Mars (far) · 30 s delay": the link is scaled to 30 s for the demo.
2. **Live vitals:** the wearer taps ECG on the watch's Vitals list and holds a fingertip on the top button for 30 s. Within seconds of "✓ Sent to server", the dashboard's Vitals card shows "ECG · taken HH:MM UTC · 30 s recording", with no reload. A second presenter can narrate the dashboard during the 30 s.
3. **Color coding and guidance:** in the surgeon tab, press **Start storm (Radiation ▲ watch)**. Back on the dashboard, Radiation is 🟡 at once with a yellow banner; open the Radiation card and read its what / why / do. (The 🟡 also reaches the surgeon's feed 30 s later.)
4. **Hazards:** flip through Radiation (real ISS data; the storm's hours are dashed and labeled "Simulated deep-space solar storm (demo data)"), Cabin, Nutrition and Mind. Nutrition rates yesterday's meals and Mind needs 2 check-ins in 3 days, so either may show "No status" with its reason.
5. **Gamification:** log a meal and a check-in, and show the points and streak update (Phase 6).
6. **Alert and delay:** in the surgeon tab, press **Escalate storm (Radiation ■ alert)**. On the dashboard, Radiation turns 🔴 and the red banner counts down "Alert sent to flight surgeon · arrives in 0:30". Switch to the surgeon tab: about 30 s after the press, the 🔴 arrives in the feed with "Sent … ship · Received … ground · 30 s delay" and the crew grid turns red. Optionally acknowledge it; the dashboard learns of it 30 s later.
7. **Close:** "It works without Earth, and it tells Earth when it matters." Afterwards, run `npm run demo:reset`.

**Steps that depend on the time of day (UTC; Indiana is UTC−5 in winter).** A task counts as done, and so earns points, only within 2 hours of its time (§7): ECG 07:00–11:00, breakfast 06:00–10:00, lunch 11:00–15:00, dinner 17:00–21:00, check-in 18:00–22:00, SpO₂ 07:00–11:00 and 19:00–23:00 UTC. Outside them step 2's ECG still shows on the card but ticks no task, and step 5's meal and check-in are logged but earn no points, so nothing visibly updates. From 18:00 UTC, Gravity may also show 🟡 by itself (fewer than 60 exercise minutes today); that is real data and can stay.

## 14. Sources

- Challenge: https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/?tab=details
- NASA HRP — 5 Hazards of Human Spaceflight: https://www.nasa.gov/hrp/hazards/
- NASA HRP — Risks of Human Spaceflight: https://www.nasa.gov/hrp/risks/
- NASA HRP — Ongoing Research: https://www.nasa.gov/hrp/ongoing-hrp-research/
- NASA RadLab portal and API: https://osdr-tutorials.readthedocs.io/en/latest/pages/guides/radlab_portal.html
- NASA OSDR Environmental Data: https://www.nasa.gov/reference/osdr-environmental-data
- NASA OCHMO-TB-020, Design for Ionizing Radiation Protection: https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf
- NASA OCHMO-TB-004, Carbon Dioxide: https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-004-carbon-dioxide.pdf
- NASA OCHMO-TB-003, Habitable Atmosphere: https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-003-habitable-atmosphere.pdf
- NASA-STD-3001 Volume 2 Rev F: https://www.nasa.gov/wp-content/uploads/2025/05/nasa-std-3001-vol-2.pdf
- NASA-STD-3001 Volume 2 Rev A (historical): https://standards.nasa.gov/sites/default/files/standards/NASA/B/0/Historical/nasa-std-3001_vol_2_rev_a.pdf
- NASA acoustics technical brief (OCHMO-TB-035): https://www.nasa.gov/sites/default/files/atoms/files/acoustics_technical_brief_ochmo_0.pdf
- NASA ICES-2024-354, ISS Acoustics (Flight Rule B13-152): https://ntrs.nasa.gov/api/citations/20240006442/downloads/ICES-2024-354%20ISS%20Acoustics.pdf
- NASA JSC, Nutrition Requirements, Standards, and Operating Bands for Exploration Missions, Initial Release rev 1, December 2005 (uploaded to NTRS in 2020): https://ntrs.nasa.gov/citations/20200001703
- CSA — Monitoring Radiation for Astronaut Health: https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp
- van Hees VT et al., Estimating sleep parameters using an accelerometer without sleep diary, Scientific Reports 8, 12975 (2018), CC BY 4.0 (live sleep method, §5.7; copy in `docs/sleep/`): https://doi.org/10.1038/s41598-018-31266-z
- van Hees VT et al., A Novel, Open Access Method to Assess Sleep Duration Using a Wrist-Worn Accelerometer, PLoS ONE 10, e0142533 (2015) (sustained inactivity; copy in `docs/sleep/`): https://doi.org/10.1371/journal.pone.0142533
- GGIR 1.5-23, the R package the 2018 paper names as its implementation (where the paper is silent): https://cran.r-project.org/src/contrib/Archive/GGIR/GGIR_1.5-23.tar.gz
