import type { Metadata } from "next";
import { CheckInForm } from "@/components/CheckInForm";
import { PageHeader } from "@/components/PageHeader";
import { RecentCheckIns } from "@/components/RecentCheckIns";
import { newestFirst } from "@/lib/domain/checkin";
import { firstTimeOf } from "@/lib/domain/schedule";
import { getTasksToday } from "@/lib/onboard/api";
import { loadCrewSelection, loadRecentCheckIns } from "@/lib/onboard/loaders";
import { requestNow } from "@/lib/request-clock";
import { removeCheckInAction, submitCheckInAction } from "../actions";

export const metadata: Metadata = { title: "Mood check-in · Heartbeat Telemetry" };

/** The approved mood check-in (mockups/dashboard-check-in.dc.html, decision 9). */
export default async function CheckIn() {
  const nowMs = await requestNow();
  const { astronaut } = await loadCrewSelection();
  const [checkIns, tasks] = await Promise.all([loadRecentCheckIns(astronaut.id, nowMs), getTasksToday(astronaut.id)]);
  const checkInTime = firstTimeOf(tasks, "checkIn");
  const due = checkInTime ? `once a day, due ${checkInTime} UTC` : "once a day";

  return (
    <main className="page">
      <PageHeader title="Mood check-in" subtitle={`Isolation and confinement · ${astronaut.name} · ${due}`} />
      <div className="columns">
        <div className="mainColumn">
          <CheckInForm astronautId={astronaut.id} checkInTime={checkInTime} submit={submitCheckInAction} />
        </div>
        <div className="sideColumn">
          <RecentCheckIns checkIns={newestFirst(checkIns)} astronautId={astronaut.id} removeCheckIn={removeCheckInAction} />
        </div>
      </div>
    </main>
  );
}
