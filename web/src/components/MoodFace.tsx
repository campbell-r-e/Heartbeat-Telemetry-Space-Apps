/** Mouth shapes of the five drawn mood faces, from the approved check-in mockup (1 = very low). */
const MOUTHS: Readonly<Record<number, string>> = {
  1: "M11 24c3-4 9-4 12 0",
  2: "M12 23c2.5-2 7.5-2 10 0",
  3: "M12 22h10",
  4: "M12 21c2.5 2 7.5 2 10 0",
  5: "M11 20c3 4.5 9 4.5 12 0",
};

/** A drawn face for a mood score (no emoji, decision 9). Decorative: the label names the mood. */
export function MoodFace({ mood }: { mood: number }) {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="17" cy="17" r="14" />
      <circle cx="12" cy="14" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="22" cy="14" r="1.4" fill="currentColor" stroke="none" />
      <path d={MOUTHS[mood]} />
    </svg>
  );
}
