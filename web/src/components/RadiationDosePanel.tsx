import type { MissionDose } from "@heartbeat/shared";
import { PERCENT, formatNumber } from "@/lib/domain/format";
import { CAREER_DOSE_LABEL, NO_CAREER_DOSE, NO_STATUS, careerDoseText } from "@/lib/domain/readouts";
import styles from "./detail.module.css";

const FACTOR_DECIMALS = 2;

interface RadiationDosePanelProps {
  dose: MissionDose | null;
  statusProblem: string | null;
  /** The server's absorbed-to-dose-equivalent factor (GET /api/settings), shown, never applied. */
  doseEquivalentPerAbsorbedDose: number | null;
}

/**
 * Career dose against NASA's career limit, every number from the server's derived missionDose
 * (decision 5). It is a dose equivalent (estimate), compared with the effective-dose limit as the
 * closest stand-in (SPEC §6.5).
 */
export function RadiationDosePanel({ dose, statusProblem, doseEquivalentPerAbsorbedDose }: RadiationDosePanelProps) {
  return (
    <section aria-labelledby="dose-title" className="panel">
      <div className={styles.panelHead}>
        <h2 id="dose-title" className="panelTitle">
          Mission dose vs. limit
        </h2>
        {dose && (
          <span className="muted">
            Career limit: {formatNumber(dose.careerLimitMSv, 0)} mSv effective dose (NASA-STD-3001 [V1 4030])
          </span>
        )}
      </div>
      {dose ? (
        <>
          <div
            className={styles.bar}
            role="meter"
            aria-label={`${CAREER_DOSE_LABEL} as a share of the career limit`}
            aria-valuemin={0}
            aria-valuemax={PERCENT}
            aria-valuenow={Math.round(dose.shareOfCareerLimit * PERCENT)}
          >
            <div className={styles.barFillOk} style={{ width: `${Math.min(PERCENT, dose.shareOfCareerLimit * PERCENT)}%` }} />
          </div>
          <div className={styles.doseRow}>
            <span>{careerDoseText(dose).soFar}</span>
            <span>{careerDoseText(dose).projected}</span>
          </div>
          {doseEquivalentPerAbsorbedDose !== null && (
            <span className="muted">
              Estimate: the ship&apos;s absorbed dose × {formatNumber(doseEquivalentPerAbsorbedDose, FACTOR_DECIMALS)}, compared with NASA&apos;s effective-dose limit as the closest stand-in.
            </span>
          )}
        </>
      ) : (
        <p className={styles.pending}>{statusProblem ? `${NO_STATUS} (${statusProblem}).` : `${NO_CAREER_DOSE}.`}</p>
      )}
    </section>
  );
}
