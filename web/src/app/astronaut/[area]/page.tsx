import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AttentionBanners } from "@/components/AttentionBanners";
import { AutoRefresh } from "@/components/AutoRefresh";
import { LiveRefresh } from "@/components/LiveRefresh";
import { ChartPanel } from "@/components/ChartPanel";
import controls from "@/components/controls.module.css";
import { HistoryPanel } from "@/components/HistoryPanel";
import { LearnPanel } from "@/components/LearnPanel";
import { PageHeader } from "@/components/PageHeader";
import { RangePicker } from "@/components/RangePicker";
import { ReadoutTiles } from "@/components/ReadoutTiles";
import { SecondaryPanels } from "@/components/SecondaryPanels";
import { StatusPill, StatusReason } from "@/components/StatusPill";
import { AREA_CHARTS } from "@/lib/domain/area-charts";
import { detailPath, findArea } from "@/lib/domain/areas";
import { areaLimits } from "@/lib/domain/limits";
import { LEARN } from "@/lib/domain/learn";
import { parseRangeParam, rangeOption } from "@/lib/domain/ranges";
import { areaReadouts } from "@/lib/domain/readouts";
import { ALERT_HISTORY_DAYS, areaReason, areaStatus, attentionItems, statusLook } from "@/lib/domain/status";
import { getSettings } from "@/lib/onboard/api";
import { loadAlertLog, loadAreaContext, loadChart, loadCrewSelection, loadPanels, loadRelayedAlerts } from "@/lib/onboard/loaders";
import { requestNow } from "@/lib/request-clock";

export async function generateMetadata({ params }: PageProps<"/astronaut/[area]">): Promise<Metadata> {
  const area = findArea((await params).area);
  return { title: `${area?.title ?? "Area"} · Heartbeat Telemetry` };
}

/** Full-page detail for one area, in the pattern of the approved radiation mockup (SPEC §9.1). */
export default async function AreaDetail({ params, searchParams }: PageProps<"/astronaut/[area]">) {
  const area = findArea((await params).area);
  if (!area) notFound();
  const charts = AREA_CHARTS[area.id];
  const range = parseRangeParam((await searchParams).range, charts.ranges);
  const { phrase } = rangeOption(range);

  const nowMs = await requestNow();
  const { astronaut } = await loadCrewSelection();
  const [context, mainChart, alertLog, settings, relayedAlerts] = await Promise.all([
    loadAreaContext(astronaut.id, nowMs),
    loadChart(charts.main.source, astronaut.id, range, nowMs),
    loadAlertLog(astronaut.id, area.id, nowMs),
    getSettings(),
    loadRelayedAlerts(astronaut.id, nowMs),
  ]);
  const panels = await loadPanels(charts.secondary, { astronautId: astronaut.id, range, nowMs, status: context.status, settings });
  const status = context.status.ok ? context.status.value : null;
  const readouts = areaReadouts(area.id, context.snapshot);
  const tone = statusLook(areaStatus(status, area.id)).tone;

  return (
    <main className="page">
      <AutoRefresh />
      <LiveRefresh channel="onboard" />
      <PageHeader
        title={area.title}
        badge={<StatusPill status={areaStatus(status, area.id)} />}
        note={<StatusReason reason={areaReason(status, area.id)} />}
        subtitle={`${area.hazard} · Source: ${area.source} · ${astronaut.name}`}
      />
      <AttentionBanners status={context.status} items={attentionItems(status, area.id)} relayedAlerts={relayedAlerts} nowMs={nowMs} />
      <ReadoutTiles readouts={[readouts.headline, ...readouts.details]} />
      {area.action && (
        <div>
          <Link href={area.action.href} className={controls.accentButton}>
            {area.action.text}
          </Link>
        </div>
      )}
      <div className="columns">
        <div className="mainColumn">
          <ChartPanel
            title={charts.main.title}
            data={mainChart}
            rangePhrase={phrase}
            tone={tone}
            controls={<RangePicker basePath={detailPath(area.id)} current={range} offered={charts.ranges} />}
          />
          <SecondaryPanels panels={panels} rangePhrase={phrase} tone={tone} />
          <HistoryPanel log={alertLog} days={ALERT_HISTORY_DAYS} />
        </div>
        <div className="sideColumn">
          <LearnPanel topic={area.title} content={LEARN[area.id]} limits={areaLimits(settings.limits, area.id)} />
        </div>
      </div>
    </main>
  );
}
