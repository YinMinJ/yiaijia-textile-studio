import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "宜爱家 · 家纺设计工作台",
  description: "上传商品实拍，制作5张主图与790宽详情切片。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
