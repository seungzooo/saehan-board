import { pinState } from "@/lib/pin";
import Link from "next/link";
import PinForm from "./PinForm";

/**
 * 보호 화면 감싸기 (서버 컴포넌트). PIN이 맞으면 children, 아니면 PIN 입력,
 * UPLOAD_PIN이 없으면 "관리자 PIN 미설정" — 화면을 열지 않는다.
 * 서버 액션은 별도로 requirePin()으로 검사한다 (화면 가림만으로 보호하지 않음).
 */
export default async function PinGate({ children }: { title?: string; children: React.ReactNode }) {
  const state = await pinState();
  if (state === "OK") return <>{children}</>;
  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-4 px-4 py-12">
      <h1 className="text-xl font-bold">관리자 확인</h1>
      <p data-testid="pin-desc" className="text-sm text-zinc-600">재고 업로드와 변동 입력은 생산지원팀만 할 수 있습니다. 관리 코드를 입력하세요.</p>
      {state === "UNSET" ? (
        <div data-testid="pin-unset" className="rounded-lg border border-dashed border-zinc-400 p-4 text-sm">
          <p className="font-semibold">관리 코드가 아직 정해지지 않았습니다</p>
          <p className="mt-1 text-zinc-600">생산지원팀이 관리 코드를 정할 때까지 이 화면을 쓸 수 없습니다.</p>
        </div>
      ) : (
        <PinForm />
      )}
      <Link href="/" className="text-sm text-blue-600">
        재고 조회는 관리 코드 없이 볼 수 있습니다 →
      </Link>
    </main>
  );
}
