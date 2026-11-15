import Link from "next/link";
import { CONSOLE_TABS, consoleHref, type ConsoleView } from "@/lib/domain/surgeon";
import styles from "./surgeon.module.css";

/** The console's two tabs (SPEC §9.2): Alerts, with the count still open, and Crew & Watches. */
export function ConsoleTabs({ view, openCount }: { view: ConsoleView; openCount: number }) {
  return (
    <nav role="tablist" aria-label="Console sections" className={styles.tabs}>
      {CONSOLE_TABS.map((tab) => (
        <Link
          key={tab.id}
          role="tab"
          aria-selected={tab.id === view.tab}
          href={consoleHref({ ...view, tab: tab.id })}
          className={styles.tab}
          scroll={false}
        >
          {tab.label}
          {tab.id === "alerts" && (
            <span className={styles.count}>
              {openCount}
              <span className="srOnly"> not resolved</span>
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
