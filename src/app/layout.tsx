import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "焚烧订单排期系统",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
