import type { Metadata } from "next";
import { AlertFeed, type OpenAlertDetail } from "@/components/AlertFeed";
import { ConsoleTabs } from "@/components/ConsoleTabs";
import { CrewSummary } from "@/components/CrewSummary";
import { CrewWatches } from "@/components/CrewWatches";
import { LiveRefresh } from "@/components/LiveRefresh";
import { StormControl } from "@/components/StormControl";
import { SurgeonHeader } from "@/components/SurgeonHeader";
import styles from "@/components/surgeon.module.css";
import {
  alertCard, alertChartLabel, crewCard, crewNames, feedAlerts, missionLine, openAlertCount, parseConsoleView,
} from "@/lib/domain/surgeon";
import { stormControl } from "@/lib/domain/storm";
import { loadAlertChart, loadConsole, loadSolarStorm } from "@/lib/onboard/loaders";
import { requestNow } from "@/lib/request-clock";
import {
  acknowledgeAlertAction, addAstronautAction, assignWatchAction, changeDelayAction, removeAstronautAction, resolveAlertAction, sendNoteAction,
  stormAction, unassignWatchAction,
} from "./actions";

export const metadata: Metadata = { title: "Flight surgeon console · Heartbeat Telemetry" };

/**
 * Mission Control's flight surgeon console (SPEC §9.2, mockups/surgeon-console.dc.html). It reads only
 * the ground's endpoints, so it always shows what Earth has received: late by the link delay.
 */
export default async function SurgeonConsole({ searchParams }: PageProps<"/surgeon">) {
  const view = parseConsoleView(await searchParams);
  const nowMs = await requestNow();
  const [{ crew, mission, alerts, notes }, storm] = await Promise.all([loadConsole(nowMs), loadSolarStorm()]);
  const names = crewNames(crew.crew);
  const openAlert = alerts.find((alert) => alert.alertId === view.open) ?? null;
  const openDetail: OpenAlertDetail | null = openAlert && {
    chartLabel: alertChartLabel(openAlert),
    chart: await loadAlertChart(openAlert),
    notes: notes.filter((note) => note.alertId === openAlert.alertId),
  };

  return (
    <main className={`page ${styles.page}`}>
      <LiveRefresh channel="ground" />
      <SurgeonHeader missionLine={missionLine(mission, crew.crew.length)} relay={crew.relay} dataAsOf={crew.dataAsOf} nowMs={nowMs} changeDelay={changeDelayAction} />
      <StormControl model={stormControl(storm)} action={stormAction} />
      <ConsoleTabs view={view} openCount={openAlertCount(alerts)} />
      {view.tab === "alerts" ? (
        <div className={styles.alertsLayout}>
          <AlertFeed
            cards={feedAlerts(alerts, view.filter).map((alert) => alertCard(alert, names))}
            view={view}
            openDetail={openDetail}
            actions={{ acknowledge: acknowledgeAlertAction, resolve: resolveAlertAction, sendNote: sendNoteAction }}
            nowMs={nowMs}
          />
          <CrewSummary cards={crew.crew.map((member) => crewCard(member, nowMs))} />
        </div>
      ) : (
        <CrewWatches
          ground={crew}
          nowMs={nowMs}
          actions={{ addAstronaut: addAstronautAction, assignWatch: assignWatchAction, unassignWatch: unassignWatchAction, removeAstronaut: removeAstronautAction }}
        />
      )}
    </main>
  );
}
