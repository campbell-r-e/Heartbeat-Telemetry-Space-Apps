"use client";

import { useEffect, type ReactNode } from "react";
import controls from "./controls.module.css";
import styles from "./status.module.css";

interface ServerErrorNoticeProps {
  error: unknown;
  retry: () => void;
  title: string;
  /** What to check, in the page's own words. */
  children: ReactNode;
}

/** The error page body shared by the dashboard and the surgeon console: logs the error, says why, offers a retry. */
export function ServerErrorNotice({ error, retry, title, children }: ServerErrorNoticeProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="page">
      <section data-tone="bad" className={styles.banner} role="alert">
        <div className={styles.bannerHead}>
          <span className={styles.badge}>Error</span>
          <h1 className={styles.bannerTitle}>{title}</h1>
        </div>
        <p>{children}</p>
        <div>
          <button type="button" className={controls.button} onClick={() => retry()}>
            Try again
          </button>
        </div>
      </section>
    </main>
  );
}
