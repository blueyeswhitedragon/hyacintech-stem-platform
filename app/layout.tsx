import type { Metadata } from "next";
import { EB_Garamond, JetBrains_Mono, Noto_Sans_SC } from "next/font/google";
import "./globals.css";

// next/font 在构建期下载并自托管字体，线上不依赖 Google CDN 可达性。
const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-sans-sc",
  display: "swap",
});

// 衬线只服务版本号与英文标识，因此不需要中文字重。
const ebGaramond = EB_Garamond({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-eb-garamond",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

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
    <html lang="zh-CN" className={`${notoSansSC.variable} ${ebGaramond.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
