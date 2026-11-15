import type { Metadata } from "next";
import { ChartPanel } from "@/components/ChartPanel";
import { LiveRefresh } from "@/components/LiveRefresh";
import { NoteForm } from "@/components/NoteForm";
import { PageHeader } from "@/components/PageHeader";
import { RangePicker } from "@/components/RangePicker";
import { SentNotes } from "@/components/SentNotes";
import { StatusPill } from "@/components/StatusPill";
import { RANGE_IDS, parseRangeParam } from "@/lib/domain/ranges";
import { notesNewestFirst } from "@/lib/domain/relay";
import { SURGEON_PATH, groundChartSpecs, surgeonAstronautPath } from "@/lib/domain/surgeon";
import { astronautHeader, astronautPanels } from "@/lib/domain/surgeon-astronaut";
import { getGroundCrew, getGroundNotes } from "@/lib/onboard/api";
import { loadGroundCharts } from "@/lib/onboard/loaders";
import { requestNow } from "@/lib/request-clock";
import { sendNoteAction } from "../../actions";

export const metadata: Metadata = { title: "Astronaut charts · Flight surgeon console" };

/**
 * "View full charts" (SPEC §9.2 astronaut drill-down): the dashboard's charts, read-only, as Mission
 * Control can know them (readings up to now − the link delay; check-ins, calories and exercise
 * minutes from the last daily log that reached the ground), plus the notes sent and a note box.
 */
export default async function SurgeonAstronaut({ params, searchParams }: PageProps<"/surgeon/astronauts/[id]">) {
  const astronautId = decodeURIComponent((await params).id);
  const range = parseRangeParam((await searchParams).range, RANGE_IDS);
  const nowMs = await requestNow();
  const specs = groundChartSpecs();
  const [ground, notes, { series, dailyLog }] = await Promise.all([
    getGroundCrew(),
    getGroundNotes(astronautId),
    loadGroundCharts(specs, astronautId, range),
  ]);
  const member = ground.crew.find((entry) => entry.astronautId === astronautId) ?? null;
  const header = astronautHeader({ astronautId, member, oneWayDelayMs: ground.relay.oneWayDelayMs, dailyLogReceivedAt: dailyLog.receivedAt, nowMs });
  const panels = astronautPanels({ specs, series, dailyLog: dailyLog.log, range, member });

  return (
    <main className="page">
      <LiveRefresh channel="ground" />
      <PageHeader title={header.name} badge={<StatusPill status={header.status} />} subtitle={header.subtitle} back={{ href: SURGEON_PATH, label: "Console" }} />
      <div className="columns">
        <div className="mainColumn">
          {panels.map((panel) =>
            panel.data ? (
              <ChartPanel
                key={panel.key}
                title={panel.title}
                data={panel.data}
                rangePhrase={panel.rangePhrase}
                tone={panel.tone}
                controls={panel.showsRangePicker ? <RangePicker basePath={surgeonAstronautPath(astronautId)} current={range} offered={RANGE_IDS} /> : undefined}
                reader="surgeon"
              />
            ) : (
              <section key={panel.key} aria-label={`${panel.title} chart`} className="panel">
                <h2 className="panelTitle">{panel.title}</h2>
                <p className="muted">{panel.emptyText}</p>
              </section>
            ),
          )}
        </div>
        <div className="sideColumn">
          <section aria-label="Notes" className="panel">
            <h2 className="panelTitle">Notes to {header.name}</h2>
            {member && <NoteForm astronautId={astronautId} name={header.name} sendNote={sendNoteAction} />}
            <SentNotes notes={notesNewestFirst(notes)} nowMs={nowMs} />
            {notes.length === 0 && <p className="muted">No notes sent yet.</p>}
          </section>
        </div>
      </div>
    </main>
  );
}
