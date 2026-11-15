import type { NextConfig } from "next";

import { serverUrl } from "./src/lib/server-url";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The shared package ships TypeScript source, so Next.js bundles it.
  transpilePackages: ["@heartbeat/shared"],
  // The browser listens to the onboard server's live updates (/ws/onboard, /ws/ground) through
  // this app's own origin; Next.js forwards the WebSocket upgrade.
  async rewrites() {
    return [{ source: "/ws/:channel(onboard|ground)", destination: `${serverUrl()}/ws/:channel` }];
  },
};

export default nextConfig;
