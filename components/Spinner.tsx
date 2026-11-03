/** 누르는 즉시 보이는 작은 로딩 표시 (색은 글자색을 따른다) */
export default function Spinner({ label = "불러오는 중" }: { label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px]"
    />
  );
}
