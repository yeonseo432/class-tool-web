-- =====================================================================
--  학생 명단 · 학생 로그인 · 선지별 오개념 여러 개 · '직접 그리기' 선지 정리
-- =====================================================================

-- ---------- 학생 명단: 학교 > 학년 > 반(homerooms) > 학생(students) ----------
create table if not exists public.homerooms (
  id         text primary key,
  owner_id   uuid not null default auth.uid() references auth.users on delete cascade,
  school     text not null default '',
  grade      int  not null check (grade between 1 and 12),
  class_no   int  not null check (class_no between 1 and 99),
  created_at timestamptz not null default now(),
  unique (owner_id, school, grade, class_no)
);
create index if not exists homerooms_login_idx on public.homerooms (grade, class_no);

create table if not exists public.students (
  id            text primary key,
  owner_id      uuid not null default auth.uid() references auth.users on delete cascade,
  homeroom_id   text not null references public.homerooms on delete cascade,
  number        int  not null check (number between 1 and 99),
  name          text not null check (length(name) between 1 and 30),
  password_hash text,                       -- null = 초기 비밀번호(0000)
  created_at    timestamptz not null default now(),
  unique (homeroom_id, number)
);
create index if not exists students_owner_idx on public.students (owner_id);
create index if not exists students_login_idx on public.students (homeroom_id, number, name);

alter table public.homerooms enable row level security;
alter table public.students enable row level security;
drop policy if exists "owner full access" on public.homerooms;
create policy "owner full access" on public.homerooms for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists "owner full access" on public.students;
create policy "owner full access" on public.students for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- 클래스(수업)에 연결한 학생 명단(학년·반)
alter table public.classes add column if not exists homeroom_id text references public.homerooms on delete set null;

-- 실시간 수업: 학생은 코드 대신 '자기 반 클래스'의 진행 중인 수업을 찾아 들어가요
alter table public.live_sessions add column if not exists class_id text references public.classes on delete cascade;
create index if not exists live_sessions_class_active on public.live_sessions (class_id) where phase <> 'ended';
update public.live_sessions s set class_id = l.class_id from public.lessons l where s.lesson_id = l.id and s.class_id is null;
-- live_joins.student_name 에는 이제 학생 id(students.id)를 넣어요 (세션마다 한 줄)
-- responses.student_key 에는 학생 id, student_name 에는 학생 이름을 넣어요

-- ---------- 선지별 오개념 여러 개 ----------
--  questions.choice_mis_ids[i] = 그 선지에 연결한 오개념 id 들을 ',' 로 이은 문자열 (없으면 '')
--  questions.misconceptions[i] = 같은 순서의 오개념 이름들을 줄바꿈(E'\n')으로 이은 문자열
--  (기존 값은 id 하나 · 이름 하나라서 그대로 호환돼요)
--  questions.mis_ids(문항 단위 '드러난 오개념')는 화면에서 없앴어요. 기존 값은 지우지 않고 남겨 둬요.

-- ---------- '(보기 중에 답이 없으면 직접 그리기)' 선지 · 발문 안내 문구 정리 ----------
update public.questions q
   set choices        = q.choices[1:n - 1],
       misconceptions = q.misconceptions[1:least(coalesce(array_length(q.misconceptions, 1), 0), n - 1)],
       choice_mis_ids = q.choice_mis_ids[1:least(coalesce(array_length(q.choice_mis_ids, 1), 0), n - 1)]
  from (select id, array_length(choices, 1) as n from public.questions) x
 where x.id = q.id and x.n > 2 and q.choices[x.n] like '%직접 그리%';

update public.questions
   set stem = btrim(regexp_replace(stem, '\s*\(\s*보기 중에 답이 없다면[^)]*직접 그리시오\s*\)', '', 'g'))
 where stem ~ '보기 중에 답이 없다면[^)]*직접 그리시오';
