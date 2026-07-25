import type { NextConfig } from "next";

const configuredDevOrigins = (process.env.NEXT_ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedDevOrigins = [...new Set(["127.0.0.1", ...configuredDevOrigins])];

const nextConfig: NextConfig = {
  allowedDevOrigins,
};

export default nextConfig;
