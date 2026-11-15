import Link from "next/link";
import type { CardModel } from "@/lib/domain/cards";
import { readoutCaption } from "@/lib/domain/readouts";
import { statusLook } from "@/lib/domain/status";
import { Sparkline } from "./Sparkline";
import { StatusPill, StatusReason } from "./StatusPill";
import styles from "./dashboard.module.css";

export function AreaCard({ card }: { card: CardModel }) {
  const { area, headline } = card;
  const tone = statusLook(card.status).tone;
  return (
    <Link href={area.cardHref} className={styles.card} data-tone={tone}>
      <div className={styles.cardHead}>
        <div className={styles.cardTitle}>
          <h2 className={styles.cardName}>{area.title}</h2>
          <span className={styles.hazard}>{area.hazard}</span>
        </div>
        <StatusPill status={card.status} />
      </div>
      <StatusReason reason={card.statusReason} />
      <div className={styles.value}>
        <span className={styles.mainNumber}>{headline.value}</span>
        <span className={styles.unit}>{readoutCaption(headline)}</span>
      </div>
      <Sparkline data={card.chart} tone={tone} />
      <ul className={styles.subs}>
        {card.secondaries.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className={styles.note}>{card.note}</p>
    </Link>
  );
}
