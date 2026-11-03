"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";
import Spinner from "./Spinner";

function Indicator() {
  const { pending } = useLinkStatus();
  return pending ? (
    <span className="ml-1.5 inline-flex" data-testid="link-pending">
      <Spinner />
    </span>
  ) : null;
}

/** 서버를 거치는 이동(페이지·목록 종류) — 누르는 즉시 링크 안에 로딩 표시 */
export default function PendingLink({ children, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link {...props}>
      {children}
      <Indicator />
    </Link>
  );
}
