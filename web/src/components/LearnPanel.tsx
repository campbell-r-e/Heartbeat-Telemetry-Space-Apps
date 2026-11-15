import type { LearnContent } from "@/lib/domain/learn";
import type { LimitLine } from "@/lib/domain/limits";
import { statusLook } from "@/lib/domain/status";
import styles from "./detail.module.css";

const InfoIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6M12 7.5v.5" />
  </svg>
);

const QUESTIONS = [
  { key: "whatIsIt", label: "What is it?" },
  { key: "howMeasured", label: "How it's measured in space" },
  { key: "whyItMatters", label: "Why it matters" },
  { key: "whenAttention", label: "When it needs attention" },
] as const;

/**
 * "What is this?" card (SPEC §6.6) with the limits the server applies (decision 17: no numbers are
 * typed in the web app), the NASA requirement IDs and source links.
 */
export function LearnPanel({ topic, content, limits }: { topic: string; content: LearnContent; limits: LimitLine[] }) {
  return (
    <aside aria-labelledby="learn-title" className="panel">
      <h2 id="learn-title" className={`panelTitle ${styles.learnTitle}`}>
        <InfoIcon />
        Learn: {topic.toLowerCase()}
      </h2>
      <dl className={styles.learn}>
        {QUESTIONS.map((question) => (
          <div key={question.key}>
            <dt>{question.label}</dt>
            <dd>{content[question.key]}</dd>
          </div>
        ))}
      </dl>
      <h3 className="eyebrow">Limits in use (from the onboard server)</h3>
      {limits.length > 0 ? (
        <ul className={styles.limits}>
          {limits.map((limit) => (
            <li key={limit.text} className={styles.limit}>
              <span data-tone={statusLook(limit.status).tone} className={styles.limitSymbol} aria-hidden="true">
                {limit.status ? statusLook(limit.status).symbol : "·"}
              </span>
              <span>
                {limit.text}
                {limit.status && limit.status !== "normal" && <span className="srOnly"> ({statusLook(limit.status).label})</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.pending}>The rules engine uses no fixed limits for this area.</p>
      )}
      <h3 className="eyebrow">Requirements and references</h3>
      <ul className={styles.requirements}>
        {content.requirements.map((requirement) => (
          <li key={requirement} className={styles.requirement}>
            {requirement}
          </li>
        ))}
      </ul>
      <h3 className="eyebrow">NASA sources</h3>
      <ul className={styles.sourceList}>
        {content.sources.map((source) => (
          <li key={source.url}>
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.label}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
