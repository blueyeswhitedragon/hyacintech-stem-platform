import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { PhaseProvider } from "./lib/PhaseContext";

const inter = Inter({ subsets: ["latin"] });

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
      <body className={inter.className}>
        <PhaseProvider>
          {children}
        </PhaseProvider>
      </body>
    </html>
  );
}