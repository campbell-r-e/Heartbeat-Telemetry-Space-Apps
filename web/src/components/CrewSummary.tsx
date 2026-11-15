import Link from "next/link";
import { surgeonAstronautPath, type CrewCardModel } from "@/lib/domain/surgeon";
import { StatusPill } from "./StatusPill";
import styles from "./surgeon.module.css";

/** The crew beside the alert feed: each astronaut's overall status, six areas and watch, as last relayed. */
export function CrewSummary({ cards }: { cards: CrewCardModel[] }) {
  return (
    <aside aria-label="Crew summary" className={styles.crewAside}>
      <h2 className={styles.sectionTitle}>Crew</h2>
      {cards.length === 0 && <p className={styles.empty}>No crew roster has reached the ground yet.</p>}
      {cards.map((card) => (
        <Link key={card.astronautId} href={surgeonAstronautPath(card.astronautId)} className={styles.crewCard}>
          <div className={styles.crewHead}>
            <span className={styles.crewName}>{card.name}</span>
            <StatusPill status={card.status} />
          </div>
          <ul className={styles.chips} aria-label={`${card.name}'s areas`}>
            {card.areas.map((area) => (
              <li key={area.name} data-tone={area.tone} className={styles.chip}>
                {area.symbol} {area.name}
              </li>
            ))}
          </ul>
          <span className={styles.watchLine}>{card.watchLine}</span>
        </Link>
      ))}
    </aside>
  );
}
