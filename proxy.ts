/**
 * 사내 조회 권한 — 모든 화면·서버 요청(RSC 데이터, 서버 액션 포함)을 열람 쿠키 또는 관리 코드 세션으로 보호한다.
 * 쿠키 서명까지 검증한다(존재 여부만 보지 않음). 수정·업로드 권한은 각 서버 액션의 requirePin()이 따로 검사한다.
 */
import { NextResponse, type NextRequest } from "next/server";
import { accessFrom, isPublicPath } from "@/lib/access-core";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  if (accessFrom((n) => request.cookies.get(n)?.value)) return NextResponse.next();

  // 화면 요청(일반 GET)은 입력 화면으로, 그 밖의 요청(서버 액션·RSC 데이터)은 401
  const isAction = request.method !== "GET" || request.headers.has("next-action");
  const isRsc = request.headers.get("rsc") === "1" || request.nextUrl.searchParams.has("_rsc");
  if (isAction || isRsc) {
    return new NextResponse("열람 코드가 필요합니다.", {
      status: 401,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/enter";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
