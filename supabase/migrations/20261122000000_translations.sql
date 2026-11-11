-- =====================================================================
--  학생 화면 번역 캐시 — 문제 발문 · 선지 · 정답 글을 학생이 고른 언어로 번역한 결과
--  같은 글은 한 번만 번역 (lang + 원문 sha256). 서버(secret key)만 읽고 써요 — 학생 · 교사 직접 접근 불가.
--  정답 판정은 언제나 원문 기준이라 이 표는 화면에 보여 주는 데에만 써요.
-- =====================================================================
create table if not exists public.translations (
  lang text not null,
  src_hash text not null,
  src text not null,
  out text not null,
  created_at timestamptz not null default now(),
  primary key (lang, src_hash)
);

alter table public.translations enable row level security;
