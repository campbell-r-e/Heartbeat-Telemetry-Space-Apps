import Link from "next/link";
import type { ReactNode } from "react";
import { DASHBOARD_PATH } from "@/lib/domain/areas";
import { ThemeToggle } from "./ThemeToggle";
import controls from "./controls.module.css";
import styles from "./detail.module.css";

const BackIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

/** The full-page header shared by detail pages, the meal picker and the check-in: back · title · theme. */
interface PageHeaderProps {
  title: string;
  badge?: ReactNode;
  subtitle: string;
  /** A line under the subtitle, such as the server's reason for "No status". */
  note?: ReactNode;
  /** Where the back button leads; the dashboard unless given. */
  back?: { href: string; label: string };
}

const DASHBOARD_BACK = { href: DASHBOARD_PATH, label: "Dashboard" };

export function PageHeader({ title, badge, subtitle, note, back = DASHBOARD_BACK }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <Link href={back.href} className={`${controls.button} ${controls.onPage}`}>
        <BackIcon />
        {back.label}
      </Link>
      <div className={styles.titleBlock}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{title}</h1>
          {badge}
        </div>
        <span className={styles.subtitle}>{subtitle}</span>
        {note}
      </div>
      <ThemeToggle onPage />
    </header>
  );
}
