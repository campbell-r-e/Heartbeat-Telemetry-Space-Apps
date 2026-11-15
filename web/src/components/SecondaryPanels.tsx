import type { Tone } from "@/lib/domain/status";
import type { LoadedPanel } from "@/lib/onboard/loaders";
import { ChartPanel } from "./ChartPanel";
import { NutrientTotals } from "./NutrientTotals";
import { RadiationDosePanel } from "./RadiationDosePanel";

/** The area-specific panels under the main chart, each carrying its own data. */
export function SecondaryPanels({ panels, rangePhrase, tone }: { panels: LoadedPanel[]; rangePhrase: string; tone: Tone }) {
  return (
    <>
      {panels.map((panel, index) => {
        switch (panel.kind) {
          case "chart":
            return <ChartPanel key={index} title={panel.chart.title} data={panel.data} rangePhrase={rangePhrase} tone={tone} />;
          case "radiationDose":
            return <RadiationDosePanel key={index} dose={panel.dose} statusProblem={panel.statusProblem} doseEquivalentPerAbsorbedDose={panel.doseEquivalentPerAbsorbedDose} />;
          case "nutrientTotals":
            return <NutrientTotals key={index} today={panel.today} yesterday={panel.yesterday} yesterdayReason={panel.yesterdayReason} statusProblem={panel.statusProblem} />;
        }
      })}
    </>
  );
}
