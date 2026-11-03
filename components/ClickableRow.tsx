"use client";

import { useRouter } from "next/navigation";

/** 표의 행 전체를 링크로 — 클릭·Enter로 이동, 마우스를 올리면 강조 */
export default function ClickableRow({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <tr
      tabIndex={0}
      role="link"
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(href);
      }}
      className={`cursor-pointer hover:bg-blue-50 focus:bg-blue-50 focus:outline-none ${className}`}
    >
      {children}
    </tr>
  );
}
