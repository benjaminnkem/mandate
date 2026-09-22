import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Playwright's e2e suite drives the dev server over 127.0.0.1 rather than localhost; without this, Next
  // blocks that origin's dev-only requests (HMR, refresh) as a cross-origin request by default.
  allowedDevOrigins: ["127.0.0.1"],
};

export default config;
