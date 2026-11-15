import Link from "next/link";
import type { GroundNote } from "@heartbeat/shared";
import type { FormAction } from "@/lib/action-result";
import { hasSimulated } from "@/lib/domain/chart";
import { STATUS_LOOK } from "@/lib/domain/status";
import {
  ALERT_CHART_EMPTY_TEXT, ALERT_CHART_SEVERAL_TEXT, ALERT_CHART_SPAN_TEXT, ALERT_FILTERS, consoleHref, emptyFeedText, surgeonAstronautPath, type AlertCardModel, type AlertChart, type ConsoleView } from "@/lib/domain/surgeon";
import { AlertActions } from "./AlertActions";
import { SentNotes } from "./SentNotes";
import { StatusPill } from "./StatusPill";
import { TimeSeriesChart } from "./TimeSeriesChart";
import styles from "./surgeon.module.css";

export interface AlertActionSet {
  acknowledge: FormAction;
  resolve: FormAction;
  sendNote: FormAction;
}

/** The open alert's extras, loaded only for the one that is open. */
export interface OpenAlertDetail {
  chartLabel: string | null;
  chart: AlertChart | null;
  notes: GroundNote[];
}

function AlertChartBox({ card, detail }: { card: AlertCardModel; detail: OpenAlertDetail }) {
  const label = detail.chartLabel ?? "Chart";
  const tone = STATUS_LOOK[card.status].tone;
  return (
    <div className={styles.chartBox}>
      <div className={styles.chartHead}>
        <span>{label}</span>
        <span>{ALERT_CHART_SPAN_TEXT}</span>
      </div>
      {detail.chart && detail.chart.data.points.length > 0 ? (
        <div role="img" aria-label={`${label} leading up to the alert`}>
          <TimeSeriesChart data={detail.chart.data} tone={tone} size="alert" markerMs={detail.chart.alertMs} />
          {hasSimulated(detail.chart.data.points) && <span className={styles.chartNote}>Dashed: simulated deep-space solar storm (demo data)</span>}
        </div>
      ) : (
        <div className={styles.chartEmpty}>
          {detail.chartLabel ? ALERT_CHART_EMPTY_TEXT : ALERT_CHART_SEVERAL_TEXT}
        </div>
      )}
    </div>
  );
}

interface AlertCardProps {
  card: AlertCardModel;
  view: ConsoleView;
  detail: OpenAlertDetail | null;
  actions: AlertActionSet;
  nowMs: number;
}

function AlertCard({ card, view, detail, actions, nowMs }: AlertCardProps) {
  const isOpen = detail !== null;
  return (
    <article className={styles.alertCard} data-emphasis={card.emphasis}>
      <Link href={consoleHref({ ...view, open: isOpen ? null : card.alertId })} aria-expanded={isOpen} className={styles.alertSummary} scroll={false}>
        <StatusPill status={card.status} />
        <span className={styles.alertTitle}>
          {card.who} · {card.title}
        </span>
        <span className={styles.state} data-state={card.state}>
          {card.stateText}
        </span>
        <span className={styles.times}>{card.times}</span>
      </Link>
      {detail && (
        <div className={styles.alertBody}>
          <dl className={styles.message}>
            <div>
              <dt className="eyebrow">What it means</dt>
              <dd>{card.what}</dd>
            </div>
            <div>
              <dt className="eyebrow">Astronaut was told</dt>
              <dd>{card.told}</dd>
            </div>
          </dl>
          <AlertChartBox card={card} detail={detail} />
          <AlertActions
            alertId={card.alertId}
            astronautId={card.astronautId}
            recipient={card.recipient}
            canAcknowledge={card.canAcknowledge}
            canResolve={card.canResolve}
            chartsHref={surgeonAstronautPath(card.astronautId)}
            {...actions}
          />
          <SentNotes notes={detail.notes} nowMs={nowMs} />
        </div>
      )}
    </article>
  );
}

interface AlertFeedProps {
  cards: AlertCardModel[];
  view: ConsoleView;
  openDetail: OpenAlertDetail | null;
  actions: AlertActionSet;
  nowMs: number;
}

/** The alert feed (SPEC §9.2): 🔴 and 🟡 as they reached the ground, with All / Alert / Watch filters. */
export function AlertFeed({ cards, view, openDetail, actions, nowMs }: AlertFeedProps) {
  return (
    <section aria-label="Alert feed" className={styles.feed}>
      <div className={styles.feedHead}>
        <h2 className={styles.sectionTitle}>Alert feed</h2>
        {ALERT_FILTERS.map((filter) => (
          <Link
            key={filter.id}
            href={consoleHref({ ...view, filter: filter.id })}
            aria-current={filter.id === view.filter ? "true" : undefined}
            className={styles.filter}
            scroll={false}
          >
            {filter.label}
          </Link>
        ))}
      </div>
      {cards.length === 0 && <p className={styles.empty}>{emptyFeedText(view.filter)}</p>}
      {cards.map((card) => (
        <AlertCard key={card.alertId} card={card} view={view} detail={card.alertId === view.open ? openDetail : null} actions={actions} nowMs={nowMs} />
      ))}
    </section>
  );
}
