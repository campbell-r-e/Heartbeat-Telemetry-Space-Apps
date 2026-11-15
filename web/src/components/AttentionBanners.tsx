import type { AstronautStatus, Evaluation, OnboardAlert } from "@heartbeat/shared";
import { findArea } from "@/lib/domain/areas";
import type { Loaded } from "@/lib/domain/onboard-response";
import { relayedAlertFor } from "@/lib/domain/relay";
import { statusLook } from "@/lib/domain/status";
import { RelayTag } from "./RelayTag";
import styles from "./status.module.css";

const MESSAGE_PARTS = [
  { key: "what", label: "What it means" },
  { key: "why", label: "Why in space" },
  { key: "do", label: "What to do" },
] as const;

interface BannerProps {
  evaluation: Evaluation;
  /** The alert sent to the flight surgeon for this red banner; null when none was sent. */
  relayed: OnboardAlert | null;
  nowMs: number;
}

function AttentionBanner({ evaluation, relayed, nowMs }: BannerProps) {
  const look = statusLook(evaluation.status);
  const areaTitle = findArea(evaluation.area)?.title ?? evaluation.area;
  return (
    <section data-tone={look.tone} className={styles.banner} role={evaluation.status === "alert" ? "alert" : undefined} aria-label={`${look.label}: ${areaTitle}`}>
      <div className={styles.bannerHead}>
        <span className={styles.badge}>
          <span aria-hidden="true">{look.symbol}</span>
          {look.label}
        </span>
        <h2 className={styles.bannerTitle}>
          {evaluation.title} · {areaTitle}
        </h2>
        {relayed && <RelayTag alert={relayed} nowMs={nowMs} />}
      </div>
      <dl className={styles.message}>
        {MESSAGE_PARTS.map((part) => (
          <div key={part.key}>
            <dt className="eyebrow">{part.label}</dt>
            <dd>{evaluation.message[part.key]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

interface AttentionBannersProps {
  status: Loaded<AstronautStatus>;
  items: Evaluation[];
  /** Alerts sent to the flight surgeon, for the red banners' countdown tag. */
  relayedAlerts: readonly OnboardAlert[];
  nowMs: number;
}

/**
 * One banner per active alert or watch, red above yellow (SPEC §9.1). When the status could not be
 * loaded, an error notice says why instead of showing no banners (decision 16).
 */
export function AttentionBanners({ status, items, relayedAlerts, nowMs }: AttentionBannersProps) {
  if (!status.ok) {
    return (
      <p className={styles.problemNotice} role="alert" data-tone="bad">
        <span aria-hidden="true">■</span>
        Status unavailable: {status.problem}. Alerts and guidance cannot be shown until the rules engine answers.
      </p>
    );
  }
  return (
    <>
      {items.map((evaluation) => (
        <AttentionBanner key={`${evaluation.ruleId}-${evaluation.at}`} evaluation={evaluation} relayed={relayedAlertFor(evaluation, relayedAlerts)} nowMs={nowMs} />
      ))}
    </>
  );
}
