-- 개념 지도: 개념마다 단원(과목 > 단원 > 개념 > 오개념 목록 트리용)
alter table public.concepts add column if not exists unit text not null default '';

-- 문제: 선지별로 연결한 오개념 id (choices 와 같은 순서, 연결 없음 = '')
--   misconceptions(text[]) 에는 같은 순서로 오개념 이름이 함께 저장돼요 (학생 응답 기록 · 개념지도 통계용)
alter table public.questions add column if not exists choice_mis_ids text[] not null default '{}';

-- 예시 데이터(단원 · 오개념 · 오개념이 연결된 문제)를 교사마다 한 번만 넣기 위한 표시
alter table public.teacher_settings add column if not exists sample_seeded boolean not null default false;
