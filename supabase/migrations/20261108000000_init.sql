-- =====================================================================
--  수업도구 초기 스키마
--  Google Sheets(수업도구 DB) 탭 → Postgres 테이블 1:1 대응
--  - 기존 시트의 id(f_, q_, c_, e_, s_, k_, l_, m_ 접두어)를 그대로 text PK로 사용
--  - 모든 교사 데이터에 owner_id(auth.users) + RLS → 교사별 데이터 분리
--  - 학생은 로그인 없이 서버 API(Route Handler, secret key)로만 접근
-- =====================================================================

-- ---------- 공통: updated_at 자동 갱신 ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- 교사 설정 (Script Properties의 OPENAI_MODEL 대체) ----------
create table public.teacher_settings (
  owner_id     uuid primary key default auth.uid() references auth.users on delete cascade,
  openai_model text not null default 'gpt-4o-mini',
  updated_at   timestamptz not null default now()
);

-- ---------- 문제은행 ----------
create table public.folders (
  id         text primary key,
  owner_id   uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null,
  parent_id  text references public.folders on delete cascade,   -- null = 최상위
  created_at timestamptz not null default now()
);
create index folders_owner_idx on public.folders (owner_id);
create index folders_parent_idx on public.folders (parent_id);

create table public.questions (
  id             text primary key,
  owner_id       uuid not null default auth.uid() references auth.users on delete cascade,
  folder_id      text references public.folders on delete cascade,  -- null = 최상위
  title          text not null default '',
  subject        text not null default '',
  type           text not null default 'mc' check (type in ('mc', 'short')),
  stem           text not null default '',
  choices        text[] not null default '{}',
  answer         text not null default '',          -- mc: 1부터 시작하는 번호 / short: 허용 답안을 | 로 구분
  explanation    text not null default '',
  image_url      text not null default '',
  concept_ids    text[] not null default '{}',      -- 교사가 지정한 개념
  misconceptions text[] not null default '{}',      -- 선지별 오개념 문장 (정답 선지는 '')
  analysis       jsonb,                             -- AI 사전 분석 결과 (Analysis.gs normalizeAnalysis_)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index questions_owner_idx on public.questions (owner_id);
create index questions_folder_idx on public.questions (folder_id);
create index questions_subject_idx on public.questions (owner_id, subject);
create trigger questions_touch before update on public.questions
  for each row execute function public.touch_updated_at();

-- ---------- 학기 · 공휴일 ----------
create table public.semesters (
  id         text primary key,
  owner_id   uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null,
  start_date date not null,
  end_date   date not null,
  check (start_date <= end_date)
);
create index semesters_owner_idx on public.semesters (owner_id);

create table public.holidays (
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  date     date not null,
  name     text not null default '휴일',
  primary key (owner_id, date)
);

-- ---------- 클래스 · 차시 ----------
create table public.classes (
  id          text primary key,
  owner_id    uuid not null default auth.uid() references auth.users on delete cascade,
  semester_id text not null references public.semesters on delete restrict,
  name        text not null,
  subject     text not null default '',
  schedule    jsonb not null default '[]',   -- [{day:0~6, start:'09:00', end:'09:45'}]
  intro       text not null default '',
  created_at  timestamptz not null default now()
);
create index classes_owner_idx on public.classes (owner_id);
create index classes_semester_idx on public.classes (semester_id);

create table public.lessons (
  id           text primary key,
  owner_id     uuid not null default auth.uid() references auth.users on delete cascade,
  class_id     text not null references public.classes on delete cascade,
  no           int not null default 0,
  date         date not null,
  day          text not null default '',     -- '월' 등
  time         text not null default '',     -- '09:00~09:45'
  title        text not null default '',
  question_ids text[] not null default '{}', -- 순서 있는 문제 목록
  done         date                          -- 수업 종료한 날
);
create index lessons_owner_idx on public.lessons (owner_id);
create index lessons_class_idx on public.lessons (class_id, date);

-- ---------- 개념 지도 · 오개념 ----------
create table public.concepts (
  id          text primary key,
  owner_id    uuid not null default auth.uid() references auth.users on delete cascade,
  subject     text not null,
  name        text not null,
  x           int not null default 100,
  y           int not null default 100,
  description text not null default ''
);
create index concepts_owner_subject_idx on public.concepts (owner_id, subject);

create table public.links (
  id       text primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  subject  text not null,
  from_id  text not null references public.concepts on delete cascade,
  to_id    text not null references public.concepts on delete cascade,
  check (from_id <> to_id)
);
create index links_owner_subject_idx on public.links (owner_id, subject);

create table public.misconceptions (
  id          text primary key,
  owner_id    uuid not null default auth.uid() references auth.users on delete cascade,
  subject     text not null,
  name        text not null,
  description text not null default '',
  concept_ids text[] not null default '{}'
);
create index misconceptions_owner_subject_idx on public.misconceptions (owner_id, subject);

-- ---------- 실시간 수업 (CacheService · Script Properties 대체) ----------
create table public.live_sessions (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users on delete cascade,
  code       text not null check (code ~ '^[0-9]{4}$'),
  lesson_id  text not null references public.lessons on delete cascade,
  title      text not null default '',
  subject    text not null default '',
  idx        int not null default 0,
  phase      text not null default 'waiting' check (phase in ('waiting', 'open', 'closed', 'reveal', 'ended')),
  questions  jsonb not null default '[]',    -- 수업 시작 시점의 문제 스냅샷
  started_at timestamptz not null default now(),
  ended_at   timestamptz
);
-- 진행 중인 수업끼리만 코드가 겹치지 않으면 됨 (종료된 코드는 재사용)
create unique index live_sessions_active_code on public.live_sessions (code) where phase <> 'ended';
create unique index live_sessions_active_lesson on public.live_sessions (lesson_id) where phase <> 'ended';

create table public.live_joins (
  session_id   uuid not null references public.live_sessions on delete cascade,
  student_name text not null,
  joined_at    timestamptz not null default now(),
  primary key (session_id, student_name)
);

-- ---------- 학생 응답 ----------
create table public.responses (
  id            bigint generated always as identity primary key,
  owner_id      uuid not null references auth.users on delete cascade,
  lesson_id     text not null references public.lessons on delete cascade,
  session_id    uuid references public.live_sessions on delete set null,
  question_id   text not null,               -- 문제가 삭제돼도 통계용으로 남김 (FK 없음)
  student_key   text not null,
  student_name  text not null,
  answer        text not null,
  correct       boolean not null,
  misconception text not null default '',
  concept_ids   text[] not null default '{}',
  created_at    timestamptz not null default now()
);
create index responses_owner_idx on public.responses (owner_id);
create index responses_lesson_idx on public.responses (lesson_id, question_id);
-- 한 수업에서 같은 학생이 같은 문제를 두 번 제출하지 못하게 (LockService 대체)
create unique index responses_once_per_session
  on public.responses (session_id, question_id, student_key) where session_id is not null;

-- =====================================================================
--  RLS: 교사는 자기 데이터만. 학생(anon)은 테이블에 직접 접근 불가.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['teacher_settings', 'folders', 'questions', 'semesters', 'holidays', 'classes',
                           'lessons', 'concepts', 'links', 'misconceptions', 'live_sessions', 'responses']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "owner full access" on public.%I for all to authenticated
         using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
  end loop;
end $$;

alter table public.live_joins enable row level security;
create policy "owner reads joins" on public.live_joins for select to authenticated
  using (exists (select 1 from public.live_sessions s
                 where s.id = live_joins.session_id and s.owner_id = (select auth.uid())));
