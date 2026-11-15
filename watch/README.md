# Heartbeat watch app (Wear OS)

> This app's code was written with SI (AI) tools (Anthropic Claude) from the team's spec, and reviewed and tested by the team. See [`AI-USE.md`](../AI-USE.md).

Kotlin + Compose for Wear OS app for the Galaxy Watch5 Pro (Astronaut 1). It reads the watch sensors,
sends readings to the onboard server, and shows the approved watch screens (`mockups/watch-*.dc.html`).

## Build and run

```sh
cd watch
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest      # unit tests (no device needed)
adb -s <watch> install -r app/build/outputs/apk/debug/app-debug.apk
```

### `watch/local.properties` (gitignored)

```properties
sdk.dir=/Users/<you>/Library/Android/sdk
heartbeat.serverUrl=http://192.168.2.1:4000
heartbeat.token=<HEARTBEAT_TOKEN from the server's .env>
heartbeat.astronautId=a1
```

The three `heartbeat.*` values become **defaults only**. On the watch, the gear button on the Cabin page opens
**Connection** settings, where the server address, token and astronaut id can be changed; those are saved on the
watch (DataStore) and win over the build defaults. The token is never shown after saving and never logged.
Never commit a token.

### Samsung Health Sensor SDK (skin temperature, SpO₂, ECG, beat intervals for HRV)

The SDK is not in this repo (`watch/app/libs/` is gitignored). It lives in the private repo
[campbell-r-e/Heartbeat-Telemetry-Samsung-SDK](https://github.com/campbell-r-e/Heartbeat-Telemetry-Samsung-SDK).
To build with it:

1. From the repo root, copy the .aar into `watch/app/libs/`:

   ```sh
   gh repo clone campbell-r-e/Heartbeat-Telemetry-Samsung-SDK /tmp/hb-sdk
   cp /tmp/hb-sdk/*.aar watch/app/libs/
   ```
2. On the watch, turn on developer mode in Samsung Health, as Samsung's Health Sensor SDK guide describes; the
   SDK refuses data to unregistered apps otherwise (`SDK_POLICY_ERROR`). Our Watch5 Pro already delivers data.

Without the .aar the app still builds (from `src/noSamsung`): heart rate and pressure work, and the
Samsung readings (HRV, skin temperature, SpO₂, ECG) are unavailable. With it, `src/samsung` is compiled instead. Both implement the
`BodySensors` interface.

## What it does

| Reading | Source | Sent as |
|---|---|---|
| Heart rate | Health Services, continuous | `heartRate` bpm, every sample |
| Beat-to-beat intervals | Samsung heart rate tracker, valid-status intervals as delivered (no filtering) | `ibi` ms, an array per batch, time-stamped at the first beat |
| Skin temperature | Samsung, continuous tracker; only while worn (heart-rate contact confirmed) | `skinTemp` °C |
| SpO₂ | Samsung, on demand (tap the row) | `spo2` % |
| ECG | Samsung, on demand (tap the row or the reminder): 30 s with a finger on the top key | `ecg` mV waveform (500 Hz) |
| Cabin pressure | Barometer, at most once a minute | `pressure` hPa |
| Wrist angle (for sleep) | Accelerometer at 10 Hz, batched in the sensor hub for at most 20 s and put back in time order (samples wait 40 s for late ones); only samples taken while worn, judged at each sample's own time | `wristAngle` deg, 12 five-second epoch angles per minute whose every epoch has at least 40 of its 50 samples, time-stamped at the minute's start |

**The processor stays awake while the watch is worn (owner decision, 2026-11-15).** The Galaxy Watch5 Pro has no wake-up accelerometer. Measured with the screen off and the processor free to sleep, 6–9 Hz arrived (about 7.5 Hz), batches came back out of order by up to a minute, and no minute was complete (0 of 7, the same with no batching). With a partial wake lock: 10.0 Hz, nothing out of order, every minute complete (4 of 4). So the collection service holds a partial wake lock (`WornWakeLock`) only while the watch is worn: it is taken when heart-rate contact confirms the watch is on, released the moment it comes off and when the service stops, and never held off the wrist.

Sleep is detected by the server from the `wristAngle` minutes (van Hees et al. 2018; SPEC §5.7) and comes back as
the `sleep` reading the Sleep row shows; the watch never sends `sleep`.

HRV is derived by the server from the `ibi` readings (the server rejects a client-posted `hrv`); the HRV row
shows `derived.hrv` from `GET /api/astronauts/:id/status`, and until the server has derived one, the newest `hrv`
reading from `GET /latest` (the imported history). Steps are not collected (astronauts do not walk in microgravity).
Exercise minutes (minutes with heart rate at or above 64 % of 220 − age) are computed by the server; the Exercise
row shows `derived.exerciseToday` from the status against the server's daily goal ("45 /120 min"). It shows "--"
while the server has none, with a note saying why: the status is not available yet, the age is not set on the
server, or no heart rate came today; while the goal is unset it shows just the minutes ("30 min").

- Every heart-rate sample is sent (about one per second). Readings wait in a queue that is kept on the watch's
  storage (`files/upload-queue.jsonl`), so it survives app restarts and reboots and drains on the next start.
  It holds up to 25,000 readings (about six hours); when full, the oldest 1,000 are dropped at once. Readings are posted every 15 s in batches of up to 1,000 (the server allows 5,000 per request)
  to `POST /api/readings` with `Authorization: Bearer <token>`. Each batch carries
  `device: { watchId, batteryPct }`: a random UUID made once per install and kept in `files/watch-id` (never the
  hardware serial or MAC address), and the battery percentage from the BatteryManager (`null` if unknown). On network or server errors the batch stays in
  the queue and the watch backs off (5 s doubling to 5 min). The server ignores duplicates, so resends are safe.
  A batch the server refuses because readings in it are invalid (400) is split in halves and resent until
  only the refused readings are left; those are dropped and counted, the rest are delivered. A refusal of the
  whole request (404 `unknown_astronaut`, 413, any other 4xx) drops nothing: the readings stay queued and are
  retried with the same backoff, and the Connection screen shows the reason (owner decision).
- **Test connection** on the watch checks `GET /api/health`, then the token by posting an empty batch, then that
  the astronaut id is on the crew list from `GET /api/astronauts` ("■ Unknown astronaut" if not; "■ No astronaut set" while the id is empty).
- Collection and uploads run in a foreground service (ongoing notification), started as soon as the app opens
  with permissions granted. Without it, Doze cuts the app off from the network when the screen goes off.
- Requests go over Wi-Fi, requested explicitly (Wear OS may otherwise route through the phone's Bluetooth proxy,
  which cannot reach the spacecraft LAN). Wi-Fi is held for as long as the collection service runs, and released when it stops.
- Ship data (CO₂, radiation) and the server's latest astronaut readings are polled every 30 s from
  `GET /api/astronauts/{a1,ship}/latest`; each tile shows the newest value from the watch or the server, with
  its time and source.
- **Statuses (green/yellow/red) are never computed on the watch.** They come from the server's rules engine
  through `StatusRepository` (`GET /api/astronauts/:id/status`); while the server has none (a 404) every area and
  row is drawn in a neutral style.
- **Points, streak and badges come only from the server** (`GET /api/astronauts/:id/points`, Phase 6). `PointsTracker`
  polls them in the same 15 s `OnboardPoll` round as the surgeon notes (notes first, then points). Home shows
  "1,240 pts · 9d" under the day and battery once the server has provided them, and nothing before. Each newly earned
  badge gives a short buzz and "Badge earned: <name>" once (only the buzz during a measurement); what was announced is
  kept on the watch so it never repeats after a restart. Details in SPEC.md §9.3.
- Every time on the watch is UTC and labeled ("19:43 UTC"): the clock, reading notes, the next ECG, the last
  upload, meal times and measurement results, all through one formatter (`UtcTime`). "Today" is the UTC day.
- Screens follow the approved large-text mockups (`mockups/watch-*-large.dc.html`): labels at least 20 px, body
  text 24 px, numbers 44 px and up, buttons 64 px tall. The reading pages are scrolling lists (touch or rotary)
  with one reading per row.
- While Samsung's sensors are not available, their rows say why ("Samsung Health starting…", "Samsung sensors
  unavailable", "Samsung SDK not in this build"). The Connection screen shows readings the server rejected and
  readings dropped because the queue was full, only when there are some.
- **The watch's auto-rotate must be off (owner decision).** The Galaxy Watch5 Pro on Wear OS 6 ignores the app's
  `screenOrientation="portrait"` (its display sets `ignoreOrientationRequest`) and turns the screen with the
  accelerometer, sideways included. Its Settings app has no auto-rotate switch, so turn it off over adb:

  ```sh
  adb -s <watch> shell settings put system accelerometer_rotation 0
  adb -s <watch> shell settings put system user_rotation 0
  adb -s <watch> shell settings get system accelerometer_rotation   # must print 0
  ```

  The portrait value stays in the manifest as a backup for watches that honor it.
- Back (the button or the swipe) on a readings list returns to home; back on home leaves the app.
- Notes from the flight surgeon (approved mockup `mockups/watch-notes-large.png`): polled from
  `GET /api/astronauts/:id/notes` every 15 s; each new unread note buzzes once and posts "Note from Flight Surgeon"
  with an **Open** action (ids of posted notifications kept in DataStore; a note that could not be posted is
  announced once notifications are allowed). The note screen shows when it was sent (UTC), the alert it
  is about if any, the text, and **Mark read**, which sends the read receipt to the ground. Unread notes wait behind
  a "✉ 1 note" pill on home, oldest first. A note never interrupts a running measurement.
- Reminders follow the server's daily schedule (`GET /api/astronauts/:id/schedule`, times in UTC, refreshed every
  15 min, last good copy cached; with none received nothing is reminded). They use exact alarms
  (SCHEDULE_EXACT_ALARM, which the user allows in system settings; while it is missing they are scheduled inexactly
  and the Vitals page shows "▲ Reminders may be late" with an Allow button) and are re-armed after a
  reboot or a time or time-zone change. Each reminder vibrates and opens the ECG or SpO₂ measurement where the
  watch has one; meal and check-in reminders open the app.
- The astronaut's name comes from `GET /api/astronauts` (cached) and is shown as "a1 · Astronaut 1".

## Code layout (`app/src/main/java/org/heartbeat/watch`)

| Package | Role |
|---|---|
| `domain` | Readings, metrics, statuses, repository interfaces. No Android (a convention, see below). |
| `settings` | Connection settings, validation, DataStore persistence |
| `network` | HTTP transport, the server client, JSON contract, pending-endpoint placeholders |
| `upload` | Upload queue, retry policy, scheduler, connection status |
| `sensors` | Health Services and SensorManager sources, the `BodySensors` seam |
| `collect` | Foreground service and the collector wiring sensors to the queue; on-demand measurements |
| `reminders` | Reminder schedule, alarm and notification |
| `notes` | Notes from the flight surgeon: polling, announcing each once, the read receipt |
| `ui` | ViewModel, presenters (pure), and Composables that only draw |

Everything is one Gradle module. That `domain` (and the presenters in `ui/model`) import nothing from Android is a
convention kept by review, not enforced by a module boundary; a separate pure-Kotlin module can enforce it later.

Fonts: Inter and JetBrains Mono, bundled under the SIL Open Font License (`watch/licenses/`).
