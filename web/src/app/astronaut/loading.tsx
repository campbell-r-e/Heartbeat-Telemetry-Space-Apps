/** Shown while a page's live data loads from the onboard server. */
export default function Loading() {
  return (
    <main className="page">
      <p role="status" className="muted">
        Loading live data from the onboard server…
      </p>
    </main>
  );
}
