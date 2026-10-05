import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow browser access through this machine's LAN address during development.
  allowedDevOrigins: ["10.105.1.50"],
};

export default nextConfig;
