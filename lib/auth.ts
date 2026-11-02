/**
 * F8 구현 전 임시 인증. F8에서 세션 기반으로 교체한다.
 * 역할: SALES | STOCK | ADMIN
 */
export type Role = "SALES" | "STOCK" | "ADMIN";
export type SessionUser = { id: number; loginId: string; name: string; role: Role };

export async function getCurrentUser(): Promise<SessionUser | null> {
  // TODO(F8): 세션 쿠키에서 사용자 조회
  return { id: 0, loginId: "dev", name: "개발자", role: "ADMIN" };
}

export function canUpload(user: SessionUser | null): boolean {
  return !!user && (user.role === "STOCK" || user.role === "ADMIN");
}
