import EnterForm from "./EnterForm";

export const metadata = { title: "새한프라텍 사내용" };

/** 열람 코드 입력 — proxy.ts가 권한 없는 화면 요청을 여기로 보낸다 */
export default async function EnterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-4 px-4 py-12">
      <h1 data-testid="enter-title" className="text-lg font-bold">
        새한프라텍 사내용 · 열람 코드를 입력하세요
      </h1>
      <EnterForm next={next ?? "/"} />
    </main>
  );
}
