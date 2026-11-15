"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const REFRESH_INTERVAL_MS = 60_000;

/**
 * Re-renders the page's server data once a minute so readings and "due in" times stay current.
 * Relay events reload the page at once through LiveRefresh (/ws/onboard); readings and the rules'
 * status are not pushed that way, so this keeps them fresh.
 */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
