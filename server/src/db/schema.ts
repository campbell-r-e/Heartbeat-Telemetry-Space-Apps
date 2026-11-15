import { DELAY_PRESETS } from "@heartbeat/shared";
import { CHECK_IN_SCALE } from "../domain/checkins.ts";
import { DATE_PATTERN, DEFAULT_MISSION } from "../domain/mission.ts";
import { DEFAULT_RELAY_SETTING } from "../domain/relay/delay.ts";
import { LOCAL_TIME_PATTERN } from "../domain/schedule.ts";
import type { Queryable } from "./pool.ts";

// Times are stored as milliseconds since 1970 (BIGINT) so they compare and bucket with plain
// integer arithmetic, matching the ISO strings the API exchanges.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS astronauts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    watch_id TEXT,
    created_ms BIGINT NOT NULL,
    age INTEGER CHECK (age >= 0)
  );

  -- Tables created before these columns existed get them here.
  ALTER TABLE astronauts ADD COLUMN IF NOT EXISTS age INTEGER CHECK (age >= 0);
  ALTER TABLE astronauts ADD COLUMN IF NOT EXISTS sex TEXT CHECK (sex IN ('male', 'female'));
  ALTER TABLE astronauts ADD COLUMN IF NOT EXISTS mass_kg DOUBLE PRECISION CHECK (mass_kg > 0);
  ALTER TABLE astronauts ADD COLUMN IF NOT EXISTS height_m DOUBLE PRECISION CHECK (height_m > 0);

  CREATE TABLE IF NOT EXISTS readings (
    id BIGSERIAL PRIMARY KEY,
    astronaut_id TEXT NOT NULL,
    metric TEXT NOT NULL,
    value DOUBLE PRECISION,
    value_json JSONB,
    unit TEXT NOT NULL,
    taken_ms BIGINT NOT NULL,
    source TEXT NOT NULL,
    original_ms BIGINT,
    CONSTRAINT readings_unique UNIQUE (astronaut_id, metric, taken_ms, source)
  );

  CREATE TABLE IF NOT EXISTS food_sources (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    position INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS foods (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    food_type TEXT,
    serving TEXT NOT NULL,
    kcal DOUBLE PRECISION,
    protein_g DOUBLE PRECISION,
    calcium_mg DOUBLE PRECISION,
    vitamin_d_ug DOUBLE PRECISION,
    sodium_mg DOUBLE PRECISION,
    source_by_field JSONB,
    note TEXT,
    position INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS menu_info (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS meals (
    id BIGSERIAL PRIMARY KEY,
    astronaut_id TEXT NOT NULL,
    food_id TEXT NOT NULL,
    eaten_ms BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS checkins (
    id BIGSERIAL PRIMARY KEY,
    astronaut_id TEXT NOT NULL,
    mood INTEGER NOT NULL CHECK (mood BETWEEN ${CHECK_IN_SCALE.min} AND ${CHECK_IN_SCALE.max}),
    stress INTEGER NOT NULL CHECK (stress BETWEEN ${CHECK_IN_SCALE.min} AND ${CHECK_IN_SCALE.max}),
    at_ms BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schedule (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    local_time TEXT CHECK (local_time ~ '${LOCAL_TIME_PATTERN.source}'),
    astronaut_id TEXT
  );

  -- Tasks with no set time (exercise) have a null local_time.
  ALTER TABLE schedule ALTER COLUMN local_time DROP NOT NULL;

  -- The alert log: each subject's last seen status, and every change of it.
  CREATE TABLE IF NOT EXISTS status_state (
    astronaut_id TEXT NOT NULL,
    subject_key TEXT NOT NULL,
    subject JSONB NOT NULL,
    status TEXT CHECK (status IN ('normal', 'watch', 'alert')),
    title TEXT NOT NULL,
    PRIMARY KEY (astronaut_id, subject_key)
  );

  CREATE TABLE IF NOT EXISTS status_log (
    id BIGSERIAL PRIMARY KEY,
    astronaut_id TEXT NOT NULL,
    at_ms BIGINT NOT NULL,
    subject JSONB NOT NULL,
    from_status TEXT CHECK (from_status IN ('normal', 'watch', 'alert')),
    to_status TEXT CHECK (to_status IN ('normal', 'watch', 'alert')),
    title TEXT NOT NULL,
    message JSONB
  );

  -- The outbox for the ground's alert feed: set in the same transaction as the change, cleared
  -- once the alert is in the relay queue, so a failed send is retried and never lost.
  ALTER TABLE status_log ADD COLUMN IF NOT EXISTS ground_unsent BOOLEAN NOT NULL DEFAULT false;
  CREATE INDEX IF NOT EXISTS status_log_ground_unsent ON status_log (at_ms) WHERE ground_unsent;

  -- Crew-wide rules' crew-level status, so one ship event is one alert for the whole crew.
  CREATE TABLE IF NOT EXISTS crew_rule_state (
    subject_key TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('normal', 'watch', 'alert'))
  );

  -- A removed astronaut keeps its row and history, hidden from the crew (SPEC §9.2).
  ALTER TABLE astronauts ADD COLUMN IF NOT EXISTS removed_ms BIGINT;

  -- Watches register themselves with their first upload (SPEC §9.2).
  CREATE TABLE IF NOT EXISTS watches (
    id TEXT PRIMARY KEY,
    battery_pct DOUBLE PRECISION CHECK (battery_pct BETWEEN 0 AND 100),
    last_contact_ms BIGINT NOT NULL,
    registered_ms BIGINT NOT NULL
  );

  -- Badges, stored once earned with the UTC day earned and never removed (SPEC §7, owner decision).
  CREATE TABLE IF NOT EXISTS badges (
    astronaut_id TEXT NOT NULL,
    badge_id TEXT NOT NULL,
    earned_on TEXT NOT NULL CHECK (earned_on ~ '${DATE_PATTERN.source}'),
    recorded_ms BIGINT NOT NULL,
    PRIMARY KEY (astronaut_id, badge_id)
  );

  CREATE TABLE IF NOT EXISTS mission (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL,
    start_date TEXT NOT NULL CHECK (start_date ~ '${DATE_PATTERN.source}'),
    gravity TEXT NOT NULL CHECK (gravity IN ('iss', 'moon', 'mars', 'earth'))
  );

  -- The relay delay setting lives in the mission record (SPEC §8).
  ALTER TABLE mission ADD COLUMN IF NOT EXISTS relay_preset TEXT NOT NULL DEFAULT '${DEFAULT_RELAY_SETTING.preset}'
    CHECK (relay_preset IN (${DELAY_PRESETS.map((preset) => `'${preset}'`).join(", ")}));
  ALTER TABLE mission ADD COLUMN IF NOT EXISTS relay_real_time BOOLEAN NOT NULL DEFAULT ${DEFAULT_RELAY_SETTING.realTime};

  -- The time zone of the sleep day (noon to noon, SPEC §5.7) also lives in the mission record.
  ALTER TABLE mission ADD COLUMN IF NOT EXISTS sleep_day_time_zone TEXT NOT NULL DEFAULT '${DEFAULT_MISSION.sleepDayTimeZone}';

  -- When the latest simulated demo storm started (SPEC §13); kept after it is cleared, so the demo
  -- reset can tell that storm's alerts from earlier ones.
  ALTER TABLE mission ADD COLUMN IF NOT EXISTS demo_storm_started_ms BIGINT;

  -- The relay queue (SPEC §3): each event is held until deliver_ms; delivered_ms is set once it
  -- has been handed over on arrival (crew changes applied, live clients told).
  CREATE TABLE IF NOT EXISTS relay_events (
    id BIGSERIAL PRIMARY KEY,
    kind TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('toGround', 'toOnboard')),
    astronaut_id TEXT,
    seq BIGINT NOT NULL,
    payload JSONB NOT NULL,
    sent_ms BIGINT NOT NULL,
    deliver_ms BIGINT NOT NULL CHECK (deliver_ms >= sent_ms),
    delivered_ms BIGINT,
    -- An event whose arrival effect keeps failing is set aside after a few attempts (SPEC §8).
    attempts INTEGER NOT NULL DEFAULT 0,
    retry_at_ms BIGINT,
    failed_ms BIGINT,
    UNIQUE (direction, seq)
  );
  CREATE INDEX IF NOT EXISTS relay_events_kind_deliver ON relay_events (kind, deliver_ms);
  CREATE INDEX IF NOT EXISTS relay_events_astronaut ON relay_events (astronaut_id, kind);
  CREATE INDEX IF NOT EXISTS relay_events_waiting ON relay_events (deliver_ms) WHERE delivered_ms IS NULL AND failed_ms IS NULL;
`;

/** Creates any missing tables. Safe to run on every start. */
export async function createSchema(db: Queryable): Promise<void> {
  await db.query(SCHEMA);
}
