import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "科创教育平台 | hyacintech",
  description: "AI驱动的STEM教育平台，帮助学生进行科学探究",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
