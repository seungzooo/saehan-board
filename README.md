# 출고/재고보드

영업담당자가 스마트폰에서 실제 출고 가능한 재고를 확인하는 사내 웹. 스펙은 `CLAUDE.md`.

## 시작하기

```bash
npm install                 # postinstall에서 prisma generate 실행
npx prisma migrate dev      # SQLite dev.db 생성 (.env의 DATABASE_URL)
npm run db:seed             # docs/data/clean/*.csv → DB (약 2분)
npm run dev                 # http://localhost:3000
```

개발용 계정: `admin / admin1234`, `stock / stock1234`, `sales / sales1234` (F8 구현 후 사용)

## 스크립트

| 명령 | 설명 |
| --- | --- |
| `npm run test` | vitest (엑셀 파서·매핑 단위 테스트) |
| `npm run data:clean` | `docs/data/*.xls` 원본(CP949 탭 텍스트) → `docs/data/clean/*.csv` 재생성 |
| `npm run db:seed` | 정리본 CSV import + MonthlyStat + 개발용 기초재고 + 사용자 |
| `npm run db:reset` | DB 초기화 후 seed |

## 구현 현황

- [x] Prisma 스키마 (`prisma/schema.prisma`) — SQLite, 배포 시 provider만 postgresql로
- [x] seed (`prisma/seed.ts`)
- [x] F1 엑셀 업로드 (`/upload`) — 재고 / 생산실적 / 출고실적 / 제품 마스터 / 거래처
- [ ] F2 변동 입력
- [ ] F3 가용재고 조회
- [x] F8 삭제 — 로그인 없이 모든 화면 접근 (2026-11-03 결정)

## F1 동작 규칙

- 파일 형식은 매직 바이트로 판별: xlsx / 진짜 xls / 텍스트(UTF-8 또는 CP949, 탭 또는 쉼표).
- 컬럼 매핑은 `config/excel-mapping.ts`. 필수 컬럼이 없으면 어떤 컬럼인지 보여주고 저장하지 않는다.
- 같은 파일(SHA-256 동일)은 두 번 저장하지 않는다.
- 재고: 업로드 1회 = UploadBatch 1개, 같은 품번 행은 합산. 없는 품번은 Product에 생성.
- 생산·출고실적: 파일이 덮는 기간(최소~최대 일자)의 기존 행을 지우고 교체. 생산실적은 같은 부서만.
  업로드 뒤 `MonthlyStat` 전체 재계산.
- 거래처 B2B/B2C: 분류표 업로드(`typeSource=MANUAL`) 전까지는 5년 출고 100건 초과 = B2B 자동 판정.
