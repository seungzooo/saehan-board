/**
 * 실적(출고·생산) 기반 집계 캐시. 실적이 바뀔 때만 무효화한다:
 *   업로드 저장 · 업로드 취소 · 집계 완료 월 수정 → updateTag(DATA_TAG)  (app/upload/actions.ts)
 * 현재 재고·소진일수처럼 실시간으로 바뀌는 값은 여기 두지 않는다.
 * 값은 JSON으로 저장되므로 Map·Set·Date를 쓰지 않는 직렬화 가능한 모양만 반환한다.
 * CACHE_VERSION: 반환 모양을 바꾸면 올린다 (배포 후 옛 모양이 남지 않게).
 */
import { unstable_cache } from "next/cache";
import { getActivityBasis, getActivityMapData, getManagedCodeList } from "@/lib/activity-data";
import { getAnalysisBasis, getOverview, getProductAnalysisStatic } from "./query";
import { getCompletionInfo, getItemShipData, getMonthlyUnitsData, getPeriodData } from "./shipments";

export const DATA_TAG = "sales-production-data";
// 스키마(DATABASE_SCHEMA)도 키에 넣는다 — 시연·e2e용 분리 스키마의 값이 운영 캐시와 섞이지 않게
const CACHE_VERSION = `v2:${process.env.DATABASE_SCHEMA || "public"}`;
const opts = { tags: [DATA_TAG], revalidate: false as const };

export const cachedPeriodData = unstable_cache(getPeriodData, [CACHE_VERSION, "period-data"], opts);
export const cachedCompletionInfo = unstable_cache(getCompletionInfo, [CACHE_VERSION, "completion-info"], opts);
export const cachedMonthlyUnits = unstable_cache(async (code: string | null) => getMonthlyUnitsData(code ?? undefined), [CACHE_VERSION, "monthly-units"], opts);
export const cachedAnalysisBasis = unstable_cache(getAnalysisBasis, [CACHE_VERSION, "analysis-basis"], opts);
export const cachedOverview = unstable_cache(async () => getOverview("ALL"), [CACHE_VERSION, "overview"], opts);
export const cachedItemShipData = unstable_cache(async (code: string) => getItemShipData(code), [CACHE_VERSION, "item-ship-data"], opts);
export const cachedProductAnalysis = unstable_cache(async (code: string) => getProductAnalysisStatic(code, "ALL"), [CACHE_VERSION, "product-analysis"], opts);

// 관리 대상 판정(최근 12개 달 정상·내수 출고)도 출고실적에서만 나온다
export const cachedActivityBasis = unstable_cache(getActivityBasis, [CACHE_VERSION, "activity-basis"], opts);
export const cachedActivityMap = unstable_cache(getActivityMapData, [CACHE_VERSION, "activity-map"], opts);
export const cachedManagedCodes = unstable_cache(getManagedCodeList, [CACHE_VERSION, "managed-codes"], opts);
