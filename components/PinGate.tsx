import { pinState } from "@/lib/pin";
import Link from "next/link";
import PinForm from "./PinForm";

/**
 * 보호 화면 감싸기 (서버 컴포넌트). PIN이 맞으면 children, 아니면 PIN 입력,
 * UPLOAD_PIN이 없으면 "관리자 PIN 미설정" — 화면을 열지 않는다.
 * 서버 액션은 별도로 requirePin()으로 검사한다 (화면 가림만으로 보호하지 않음).
 */
export default async function PinGate({ title, children }: { title: string; children: React.ReactNode }) {
  const state = await pinState();
  if (state === "OK") return <>{children}</>;
  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-4 px-4 py-12">
      <h1 className="text-xl font-bold">{title}</h1>
      {state === "UNSET" ? (
        <div data-testid="pin-unset" className="rounded-lg border border-dashed border-zinc-400 p-4 text-sm">
          <p className="font-semibold">관리자 PIN 미설정</p>
          <p className="mt-1 text-zinc-600">이 화면은 공용 PIN을 입력해야 열립니다. 관리자가 서버 환경변수 UPLOAD_PIN을 설정할 때까지 사용할 수 없습니다.</p>
        </div>
      ) : (
        <PinForm />
      )}
      <Link href="/" className="text-sm text-blue-600">
        재고 조회는 PIN 없이 볼 수 있습니다 →
      </Link>
    </main>
  );
}
