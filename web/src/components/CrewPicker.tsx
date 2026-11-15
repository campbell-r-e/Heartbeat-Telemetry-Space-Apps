"use client";

import { useTransition } from "react";
import type { Astronaut } from "@heartbeat/shared";
import styles from "./dashboard.module.css";

interface CrewPickerProps {
  crew: Astronaut[];
  selectedId: string;
  /** Remembers the choice for this browser (a server action passed in by the page). */
  choose: (astronautId: string) => Promise<void>;
}

/** Which crew member the dashboard shows (decision 13). */
export function CrewPicker({ crew, selectedId, choose }: CrewPickerProps) {
  const [pending, startTransition] = useTransition();
  return (
    <label className={styles.crewPicker}>
      <span className="srOnly">Crew member</span>
      <select
        value={selectedId}
        disabled={pending}
        onChange={(event) => {
          const id = event.target.value;
          startTransition(() => choose(id));
        }}
        className={styles.crewSelect}
      >
        {crew.map((astronaut) => (
          <option key={astronaut.id} value={astronaut.id}>
            {astronaut.name}
          </option>
        ))}
      </select>
    </label>
  );
}
