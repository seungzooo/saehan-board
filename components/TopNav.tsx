"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "재고", match: (p: string) => p === "/" || p.startsWith("/stock") },
  { href: "/adjust", label: "변동", match: (p: string) => p.startsWith("/adjust") },
  { href: "/analytics", label: "분석", match: (p: string) => p.startsWith("/analytics") },
];

/** 상단 메뉴: 재고 | 변동 | 분석 … 업로드(오른쪽 끝, 설정 아이콘). 현재 메뉴만 파란색 */
export default function TopNav() {
  const path = usePathname() ?? "/";
  const uploadActive = path.startsWith("/upload");
  return (
    <nav className="sticky top-0 z-20 border-b border-zinc-200 bg-white">
      <div className="mx-auto flex h-12 w-full max-w-2xl items-center gap-1 px-2">
        {ITEMS.map((it) => {
          const active = it.match(path);
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? "page" : undefined}
              className={`flex h-12 min-w-12 items-center justify-center px-3 text-base ${
                active ? "border-b-2 border-blue-600 font-semibold text-blue-600" : "text-zinc-600 hover:text-zinc-900"
              }`}
            >
              {it.label}
            </Link>
          );
        })}
        <Link
          href="/upload"
          aria-label="업로드"
          aria-current={uploadActive ? "page" : undefined}
          title="엑셀 업로드"
          className={`ml-auto flex h-12 items-center gap-1 px-3 text-sm ${
            uploadActive ? "border-b-2 border-blue-600 font-semibold text-blue-600" : "text-zinc-500 hover:text-zinc-900"
          }`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 15V3" />
            <path d="m7 8 5-5 5 5" />
            <path d="M5 21h14a2 2 0 0 0 2-2v-4" />
            <path d="M3 15v4a2 2 0 0 0 2 2" />
          </svg>
          업로드
        </Link>
      </div>
    </nav>
  );
}
