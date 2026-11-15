import { readoutCaption, type Readout } from "@/lib/domain/readouts";
import styles from "./detail.module.css";

/** The detail page's key numbers. */
export function ReadoutTiles({ readouts }: { readouts: Readout[] }) {
  return (
    <dl className={styles.readouts}>
      {readouts.map((readout) => (
        <div key={readout.label} className={styles.readout}>
          <dt className="eyebrow">{readout.label}</dt>
          <dd className={styles.readoutValue}>{readout.value}</dd>
          <dd className={styles.readoutCaption}>{readoutCaption(readout)}</dd>
        </div>
      ))}
    </dl>
  );
}
