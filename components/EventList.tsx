"use client";

/**
 * 탐지된 변화 목록 — 제목(실제 값)을 누르면 바로 아래에 하나만 펼친다:
 * 실제 수량 / 평소 수량과 비교 기간 / 차이를 만든 거래처·품목 / 관련 일정과 확인할 점 (+ 같은 사건으로 묶인 다른 단위, 메모)
 */
import type { EventGroupView, EventView } from "@/lib/events/query";
import { useState } from "react";
import EventNotes from "./EventNotes";

export function EventDetailBody({ e, related = [], canNote }: { e: EventView; related?: EventView[]; canNote: boolean }) {
  const d = e.detail;
  const block = (title: string, lines: string[], testid: string) =>
    lines.length > 0 && (
      <div data-testid={testid}>
        <p className="text-xs font-semibold text-blue-900">{title}</p>
        <ul className="num list-disc pl-5 text-sm">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="flex flex-col gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-blue-950" data-testid="event-detail">
      <p className="text-xs font-semibold text-blue-800">실제로 변한 것</p>
      {block("실제 수량", d.actual, "ev-actual")}
      {block("평소 수량과 비교 기간", d.baseline, "ev-baseline")}
      {block("차이를 만든 거래처·품목", d.contributors, "ev-contributors")}
      <p className="mt-1 text-xs font-semibold text-blue-800">왜 변했을 가능성이 있는지 — 확인할 것</p>
      {block("관련 일정", d.calendar, "ev-calendar")}
      {block("확인할 점", d.checks, "ev-checks")}
      {related.length > 0 && (
        <div data-testid="ev-related">
          <p className="text-xs font-semibold text-blue-900">같은 변화로 묶인 다른 단위 {related.length}건</p>
          <ul className="list-disc pl-5 text-xs">
            {related.slice(0, 6).map((r) => (
              <li key={r.id}>{r.title}</li>
            ))}
          </ul>
        </div>
      )}
      <EventNotes eventId={e.id} notes={e.notes} canNote={canNote} />
    </div>
  );
}

export default function EventList({ groups, canNote, testid = "event-list" }: { groups: EventGroupView[]; canNote: boolean; testid?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (groups.length === 0) return <p className="rounded-lg border border-zinc-200 p-3 text-sm text-zinc-500">해당하는 변화가 없습니다.</p>;
  return (
    <ol className="flex flex-col gap-2" data-testid={testid}>
      {groups.map((g, i) => {
        const isOpen = open === g.lead.id;
        return (
          <li key={g.lead.id} data-testid="event-item" data-kind={g.lead.kind} data-scope={g.lead.scope}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : g.lead.id)}
              className={`flex w-full min-h-12 items-start gap-2 rounded-lg border px-3 py-2 text-left hover:border-blue-400 ${isOpen ? "border-blue-400 bg-blue-50/50" : "border-zinc-200"}`}
            >
              <span className="num mt-0.5 shrink-0 text-xs text-zinc-400">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-zinc-900" data-testid="event-title">
                  {g.lead.title}
                </span>
                <span className="mt-0.5 flex flex-wrap gap-1 text-xs">
                  <span className={`rounded px-1.5 py-0.5 font-semibold ${g.lead.diff >= 0 ? "bg-blue-100 text-blue-800" : "bg-orange-100 text-orange-800"}`}>{g.lead.kindLabel}</span>
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-600">{g.lead.grain === "WEEK" ? "주 단위" : "월 단위"}</span>
                  {g.related.length > 0 && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-600">관련 {g.related.length}건 묶음</span>}
                  {g.lead.notes.length > 0 && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">메모 {g.lead.notes.length}</span>}
                </span>
              </span>
            </button>
            {isOpen && (
              <div className="mt-1">
                <EventDetailBody e={g.lead} related={g.related} canNote={canNote} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
