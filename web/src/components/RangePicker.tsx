import Link from "next/link";
import type { SeriesRange } from "@heartbeat/shared";
import { rangeOption } from "@/lib/domain/ranges";
import controls from "./controls.module.css";

/** The ranges an area offers (1 h / 24 h / 7 d / Mission). Links, so each range is a shareable URL. */
export function RangePicker({ basePath, current, offered }: { basePath: string; current: SeriesRange; offered: readonly SeriesRange[] }) {
  return (
    <nav aria-label="Time range" className={controls.segmented}>
      {offered.map(rangeOption).map((option) => (
        <Link
          key={option.id}
          href={`${basePath}?range=${option.id}`}
          aria-current={option.id === current ? "true" : undefined}
          className={controls.segment}
          scroll={false}
        >
          {option.label}
        </Link>
      ))}
    </nav>
  );
}
