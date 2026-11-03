/**
 * 분석 화면 한 영역: 질문 제목 · 기간/단위/데이터 기준일 · 한 줄 답 · 그래프.
 * 영역마다 위쪽 여백과 구분선으로 나눈다.
 */
export default function Section({
  id,
  question,
  meta,
  answer,
  children,
}: {
  id: string;
  question: string;
  /** 제목 옆: 선택 연도 또는 실제 분석 기간 · 단위 · 데이터 기준일 */
  meta: string;
  /** 한 줄 답 (없으면 생략) */
  answer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} data-testid={`section-${id}`} className="flex scroll-mt-16 flex-col gap-3 border-t border-zinc-200 pt-8 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h2 className="text-lg font-bold text-zinc-900" data-testid={`question-${id}`}>
            {question}
          </h2>
          <span className="num text-xs text-zinc-500" data-testid={`meta-${id}`}>
            {meta}
          </span>
        </div>
        {answer && (
          <p className="text-base font-medium text-zinc-800" data-testid={`answer-${id}`}>
            {answer}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}
