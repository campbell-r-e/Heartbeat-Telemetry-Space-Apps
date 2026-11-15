// Runs the rules over computed facts and folds the results into statuses (SPEC §6). Pure: the
// facts are computed elsewhere, from data already loaded.
import {
  AREAS, type AreaStatus, type Evaluation, type Metric, type MetricStatus, type PendingRule, type Status, type StatusMessage,
} from "@heartbeat/shared";
import { FACTS, isFactId, type FactId, type FactValues, type ProfileField } from "./facts.ts";
import type { Comparison, Condition, Rule } from "./rule.ts";
import { unsetSettings, type RuleSettings, type SettingKey } from "./settings.ts";

const SEVERITY: Record<Status, number> = { normal: 0, watch: 1, alert: 2 };

/** The more serious of two statuses. */
export function worse(a: Status, b: Status): Status {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

export type RuleOutcome =
  | { rule: Rule; kind: "pending"; waitingFor: string[] }
  | { rule: Rule; kind: "noData" }
  | { rule: Rule; kind: "checked"; fired: boolean; atMs: number };

/**
 * A rule is pending while any setting it (or one of its facts) needs is unset, or a profile field
 * one of its facts needs is unknown ("profile.sex"). Otherwise it is
 * checked when every fact it reads has data; a condition marked `onlyWithData` is skipped while
 * its fact has none.
 */
export function runRule(
  rule: Rule, settings: RuleSettings, facts: FactValues, missingProfile: readonly ProfileField[] = [],
): RuleOutcome {
  const waitingFor = [...pendingSettings(rule, settings), ...pendingProfile(rule, missingProfile)];
  if (waitingFor.length > 0) return { rule, kind: "pending", waitingFor };
  const applicable = rule.when.filter((condition) => !(condition.onlyWithData && facts[condition.fact] === undefined));
  const values = applicable.map((condition) => facts[condition.fact]);
  if (values.length === 0 || values.some((value) => value === undefined)) return { rule, kind: "noData" };
  const fired = applicable.every((condition) => holds(condition, settings, facts));
  const atMs = Math.max(...values.map((value) => value!.atMs));
  return { rule, kind: "checked", fired, atMs };
}

/** Every setting a rule reads: the ones its conditions compare with and the ones its facts need. */
export function ruleSettingKeys(rule: Rule): SettingKey[] {
  return [...new Set(rule.when.flatMap((condition) => [
    ...("setting" in condition ? [condition.setting] : []),
    ...FACTS[condition.fact].settings,
  ]))];
}

function pendingSettings(rule: Rule, settings: RuleSettings): SettingKey[] {
  return unsetSettings(settings, ruleSettingKeys(rule));
}

function pendingProfile(rule: Rule, missingProfile: readonly ProfileField[]): string[] {
  const needed = new Set(rule.when.flatMap((condition) => FACTS[condition.fact].profile));
  return missingProfile.filter((field) => needed.has(field)).map((field) => `profile.${field}`);
}

const COMPARE: Record<Comparison, (value: number, threshold: number) => boolean> = {
  gt: (v, t) => v > t,
  gte: (v, t) => v >= t,
  lt: (v, t) => v < t,
  lte: (v, t) => v <= t,
};

/** Only called once the rule is known not to be pending and the condition's fact has data. */
function holds(condition: Condition, settings: RuleSettings, facts: FactValues): boolean {
  if ("is" in condition) return facts[condition.fact]!.value === condition.is;
  return COMPARE[condition.op](facts[condition.fact]!.value, settings[condition.setting]!);
}

/** The metrics a rule reads, from its facts. */
export function ruleMetrics(rule: Rule): Metric[] {
  return [...new Set(rule.when.flatMap((condition) => FACTS[condition.fact].metrics))];
}

/** The metrics whose readings a rule rates: those of its facts that are a reading's own value. */
function ratedMetrics(rule: Rule): Metric[] {
  return [...new Set(rule.when.flatMap((condition) => {
    const spec = FACTS[condition.fact];
    return spec.ratesReadings ? spec.metrics : [];
  }))];
}

/** A rule that reads only the ship's sensors applies to the whole crew (SPEC §6.4). */
export function isCrewWide(rule: Rule): boolean {
  return rule.when.every((condition) => FACTS[condition.fact].scope === "ship");
}

const PLACEHOLDER = /\{(setting:)?([\w.]+)\}/g;

/**
 * Fills "{factId}" placeholders with the fact's value, rounded to the fact's decimals, and
 * "{setting:key}" placeholders with the setting's value. Unknown names are left as written.
 */
export function renderMessage(message: StatusMessage, facts: FactValues, settings: RuleSettings): StatusMessage {
  const fill = (template: string) =>
    template.replace(PLACEHOLDER, (placeholder: string, settingPrefix: string | undefined, name: string) => {
      if (settingPrefix) return isSettingKey(name, settings) ? formatSetting(settings[name]) : placeholder;
      return isFactId(name) ? formatFact(name, facts) : placeholder;
    });
  return { what: fill(message.what), why: fill(message.why), do: fill(message.do) };
}

export function isSettingKey(name: string, settings: RuleSettings): name is SettingKey {
  return Object.hasOwn(settings, name);
}

function formatSetting(value: number | null): string {
  return value === null ? "unknown" : String(value);
}

function formatFact(fact: FactId, facts: FactValues): string {
  const value = facts[fact]?.value;
  if (typeof value !== "number") return "unknown";
  return value.toFixed(FACTS[fact].decimals);
}

/** An area's status from the rules; the status use case adds the reason when it is unrated. */
export type AreaVerdict = Omit<AreaStatus, "reason">;

export interface RulesVerdict {
  overall: Status | null;
  areas: AreaVerdict[];
  metrics: MetricStatus[];
  evaluations: Evaluation[];
  pendingRules: PendingRule[];
}

/** Runs every rule and folds the outcomes into area, metric and overall statuses. */
export function evaluateRules(
  rules: readonly Rule[], settings: RuleSettings, facts: FactValues, astronautId: string,
  missingProfile: readonly ProfileField[] = [],
): RulesVerdict {
  const outcomes = rules.map((rule) => runRule(rule, settings, facts, missingProfile));
  const checked = outcomes.filter((o) => o.kind === "checked");
  const areas = areaStatuses(checked);
  const ratedAreas = rated(areas.map((a) => a.status));
  return {
    overall: ratedAreas.length === 0 ? null : ratedAreas.reduce(worse),
    areas,
    metrics: metricStatuses(checked),
    evaluations: checked.filter((o) => o.fired && o.rule.status !== "normal").map((o) => toEvaluation(o.rule, o.atMs, facts, settings, astronautId)).sort(alertsFirst),
    pendingRules: outcomes.flatMap((o) =>
      o.kind === "pending" ? [{ ruleId: o.rule.id, area: o.rule.area, waitingFor: o.waitingFor }] : []),
  };
}

type CheckedOutcome = Extract<RuleOutcome, { kind: "checked" }>;

/** A fired rule rates with its status; a quiet one rates 🟢, unless it rates only when fired (then null). */
function statusOf(outcome: CheckedOutcome): Status | null {
  if (outcome.fired) return outcome.rule.status;
  return outcome.rule.ratesOnlyWhenFired ? null : "normal";
}

const rated = (statuses: ReadonlyArray<Status | null>): Status[] => statuses.filter((s): s is Status => s !== null);

/** An area is rated by every checked rule in it, combination rules included; null if none rated it. */
function areaStatuses(checked: readonly CheckedOutcome[]): AreaVerdict[] {
  return AREAS.map((area) => {
    const statuses = rated(checked.filter((o) => o.rule.area === area).map(statusOf));
    return { area, status: statuses.length === 0 ? null : statuses.reduce(worse) };
  });
}

/** A reading gets the worse of its standard-range and personal-baseline statuses (SPEC §6.2). */
function metricStatuses(checked: readonly CheckedOutcome[]): MetricStatus[] {
  const byMetric = new Map<Metric, Status>();
  for (const outcome of checked) {
    if (outcome.rule.layer === "combination") continue;
    const status = statusOf(outcome);
    if (status === null) continue;
    for (const metric of ratedMetrics(outcome.rule)) {
      byMetric.set(metric, worse(byMetric.get(metric) ?? "normal", status));
    }
  }
  return [...byMetric].map(([metric, status]) => ({ metric, status }));
}

function toEvaluation(rule: Rule, atMs: number, facts: FactValues, settings: RuleSettings, astronautId: string): Evaluation {
  return {
    astronautId,
    ruleId: rule.id,
    title: rule.title,
    area: rule.area,
    hazard: rule.hazard,
    metrics: ruleMetrics(rule),
    layer: rule.layer,
    status: rule.status,
    message: renderMessage(rule.message, facts, settings),
    source: rule.source,
    crewWide: isCrewWide(rule),
    at: new Date(atMs).toISOString(),
  };
}

/** Stable: rules of equal status keep catalog order. */
function alertsFirst(a: Evaluation, b: Evaluation): number {
  return SEVERITY[b.status] - SEVERITY[a.status];
}
