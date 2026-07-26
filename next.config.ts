import type { NextConfig } from "next";

// allowedDevOrigins 只接受主机名：带协议或路径会静默失配，导致 /_next 静态资源
// 返回 403、页面拿到 HTML 却无法水合（表单退化成原生 GET 提交）。此处做容错清洗。
const configuredDevOrigins = (process.env.NEXT_ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim().replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, ""))
  .filter(Boolean);
const allowedDevOrigins = [...new Set(["127.0.0.1", ...configuredDevOrigins])];

const nextConfig: NextConfig = {
  allowedDevOrigins,
};

export default nextConfig;
