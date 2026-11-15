import type { Metadata } from "next";
import { AreaCard } from "@/components/AreaCard";
import { AttentionBanners } from "@/components/AttentionBanners";
import { AutoRefresh } from "@/components/AutoRefresh";
import { LiveRefresh } from "@/components/LiveRefresh";
import { DashboardHeader } from "@/components/DashboardHeader";
import { SurgeonNotes } from "@/components/SurgeonNotes";
import { TasksPanel } from "@/components/TasksPanel";
import dashboard from "@/components/dashboard.module.css";
import { AREA_INFO } from "@/lib/domain/areas";
import { buildCardModel } from "@/lib/domain/cards";
import { nextReminder } from "@/lib/domain/schedule";
import { attentionItems } from "@/lib/domain/status";
import { getTasksToday } from "@/lib/onboard/api";
import { loadAreaContext, loadCardCharts, loadCrewSelection, loadDashboardRelay, loadPoints } from "@/lib/onboard/loaders";
import { requestNow } from "@/lib/request-clock";
import { chooseAstronautAction, markNoteReadAction } from "./actions";

export const metadata: Metadata = { title: "Astronaut dashboard · Heartbeat Telemetry" };

export default async function AstronautDashboard() {
  const nowMs = await requestNow();
  const { crew, astronaut } = await loadCrewSelection();
  const [context, charts, tasks, points, relay] = await Promise.all([
    loadAreaContext(astronaut.id, nowMs),
    loadCardCharts(astronaut.id, nowMs),
    getTasksToday(astronaut.id),
    loadPoints(astronaut.id),
    loadDashboardRelay(astronaut.id, nowMs),
  ]);
  const status = context.status.ok ? context.status.value : null;
  const cards = AREA_INFO.map((area) => {
    const chart = charts.get(area.id);
    if (!chart) throw new Error(`No mini chart loaded for ${area.id}`);
    return buildCardModel(area, context.snapshot, status, chart);
  });

  return (
    <main className="page">
      <AutoRefresh />
      <LiveRefresh channel="onboard" astronautId={astronaut.id} />
      <DashboardHeader
        crew={crew}
        astronaut={astronaut}
        mission={context.snapshot.mission}
        next={nextReminder(tasks, nowMs)}
        points={points}
        relay={relay.relay}
        chooseAstronaut={chooseAstronautAction}
      />
      <SurgeonNotes astronautId={astronaut.id} notes={relay.notes} markRead={markNoteReadAction} />
      <AttentionBanners status={context.status} items={attentionItems(status)} relayedAlerts={relay.relayedAlerts} nowMs={nowMs} />
      <div className={dashboard.grid}>
        {cards.map((card) => (
          <AreaCard key={card.area.id} card={card} />
        ))}
      </div>
      <TasksPanel tasks={tasks} points={points} />
    </main>
  );
}
