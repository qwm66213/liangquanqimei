import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "粮全齐美数据看板",
  description: "按商品与仓库汇总期初、期末与区间入出库",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
