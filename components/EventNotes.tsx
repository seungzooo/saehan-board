"use client";

/** 탐지 결과 메모 — 보기는 누구나, 남기기는 관리 코드 세션에서만(서버 액션도 requirePin) */
import { saveEventNoteAction } from "@/app/analytics/actions";
import { formatDateTime } from "@/lib/format";
import { useState, useTransition } from "react";

export default function EventNotes({ eventId, notes, canNote }: { eventId: string; notes: { id: number; text: string; createdAt: string }[]; canNote: boolean }) {
  const [list, setList] = useState(notes);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="border-t border-blue-200 pt-2" data-testid="ev-notes">
      <p className="text-xs font-semibold text-blue-900">메모 (확인한 내용 — 원인 단정이 아닌 기록)</p>
      {list.length === 0 ? (
        <p className="text-xs text-blue-900/70">아직 메모가 없습니다.</p>
      ) : (
        <ul className="text-xs">
          {list.map((n) => (
            <li key={n.id} className="num">
              {formatDateTime(n.createdAt)} · {n.text}
            </li>
          ))}
        </ul>
      )}
      {canNote ? (
        <form
          className="mt-1 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const t = text.trim();
            if (!t) return;
            start(async () => {
              const r = await saveEventNoteAction(eventId, t);
              if (r.ok) {
                setList((cur) => [...cur, r.note]);
                setText("");
                setMsg(null);
              } else setMsg(r.message);
            });
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={300}
            aria-label="메모"
            placeholder="예: 거래처 확인 — 3월 판촉 물량"
            className="h-10 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 text-sm"
          />
          <button type="submit" disabled={pending || !text.trim()} className="h-10 shrink-0 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white disabled:bg-zinc-300">
            {pending ? "저장 중…" : "메모 저장"}
          </button>
        </form>
      ) : (
        <p className="mt-1 text-xs text-blue-900/70">메모는 관리 코드로 들어온 기기에서만 남길 수 있습니다.</p>
      )}
      {msg && (
        <p role="alert" className="text-xs text-red-700">
          {msg}
        </p>
      )}
    </div>
  );
}
