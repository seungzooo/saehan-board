"use client";

import Link from "next/link";

/** 서버·DB 오류 — 막다른 화면 대신 다시 시도 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 p-4 py-12 text-center">
      <p className="text-base font-semibold text-zinc-900">서버 연결 안 됨 — 다시 시도</p>
      <p className="text-sm text-zinc-500">잠시 후 다시 시도하세요. 계속되면 재고 담당자에게 알려 주세요.</p>
      {error.digest && <p className="text-xs text-zinc-400">오류 코드 {error.digest}</p>}
      <button type="button" onClick={reset} className="h-12 rounded-lg bg-blue-600 px-6 text-base font-semibold text-white">
        다시 시도
      </button>
      <Link href="/" className="text-sm text-blue-600">
        재고 검색으로
      </Link>
    </main>
  );
}
