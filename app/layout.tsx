import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "출고/재고보드",
  description: "실제 출고 가능한 재고 확인",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

const NAV = [
  { href: "/stock", label: "재고" },
  { href: "/adjust", label: "변동" },
  { href: "/upload", label: "업로드" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-zinc-50 text-zinc-900">
        <nav className="sticky top-0 z-10 flex items-center gap-1 border-b border-zinc-200 bg-white px-2">
          <Link href="/" className="px-2 py-3 text-sm font-bold">
            재고보드
          </Link>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="px-3 py-3 text-sm text-zinc-700">
              {n.label}
            </Link>
          ))}
        </nav>
        {children}
      </body>
    </html>
  );
}
