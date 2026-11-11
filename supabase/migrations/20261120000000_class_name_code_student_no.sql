-- =====================================================================
--  고교학점제 반 이름 · 학습코드 · 학번
--   - 반 이름을 직접 입력 (homerooms.class_name: 'A반', '3반', '물리학A' …). class_no 는 예전 값만 남겨 둠
--   - 학습코드 (homerooms.code): 반마다 4자리 숫자, 같은 학년도 안에서 겹치지 않음
--   - 학번 (students.student_no): 예) 30301 (= 3학년 3반 1번). 학생은 학습코드 + 학번 + 비밀번호로 로그인
-- =====================================================================

-- ---------- 반 이름 ----------
alter table public.homerooms add column if not exists class_name text not null default '';
update public.homerooms set class_name = class_no || '반' where class_name = '' and class_no is not null;
alter table public.homerooms alter column class_no drop not null;
alter table public.homerooms drop constraint if exists homerooms_class_name_check;
alter table public.homerooms add constraint homerooms_class_name_check check (length(class_name) between 1 and 20);
alter table public.homerooms drop constraint if exists homerooms_owner_year_school_grade_class_key;
alter table public.homerooms drop constraint if exists homerooms_owner_year_school_grade_name_key;
alter table public.homerooms add constraint homerooms_owner_year_school_grade_name_key unique (owner_id, year, school, grade, class_name);

-- ---------- 학습코드 ----------
alter table public.homerooms add column if not exists code text;
alter table public.homerooms drop constraint if exists homerooms_code_check;
alter table public.homerooms add constraint homerooms_code_check check (code ~ '^[0-9]{4}$');

/** 같은 학년도에서 아직 안 쓴 4자리 코드 */
create or replace function public.new_homeroom_code(p_year int) returns text
language plpgsql as $$
declare c text;
begin
  for i in 1..200 loop
    c := lpad((floor(random() * 10000))::int::text, 4, '0');
    if not exists (select 1 from public.homerooms where year = p_year and code = c) then return c; end if;
  end loop;
  raise exception '학습코드를 만들지 못했어요';
end $$;

-- 반을 만들 때 비어 있는 값 채우기 (반 이름: 예전 화면이 넣는 class_no → 'n반', 학습코드: 새로)
create or replace function public.homerooms_fill() returns trigger
language plpgsql as $$
begin
  if coalesce(new.class_name, '') = '' and new.class_no is not null then new.class_name := new.class_no || '반'; end if;
  if new.code is null or (tg_op = 'UPDATE' and new.year <> old.year
      and exists (select 1 from public.homerooms where year = new.year and code = new.code and id <> new.id)) then
    new.code := public.new_homeroom_code(new.year);
  end if;
  return new;
end $$;
drop trigger if exists homerooms_fill on public.homerooms;
create trigger homerooms_fill before insert or update on public.homerooms for each row execute function public.homerooms_fill();

do $$
declare r record;
begin
  for r in select id, year from public.homerooms where code is null order by created_at loop
    update public.homerooms set code = public.new_homeroom_code(r.year) where id = r.id;
  end loop;
end $$;
alter table public.homerooms alter column code set not null;
drop index if exists homerooms_year_code_key;
create unique index homerooms_year_code_key on public.homerooms (year, code);

-- ---------- 학번 ----------
alter table public.students add column if not exists student_no text;
alter table public.students drop constraint if exists students_student_no_check;
alter table public.students add constraint students_student_no_check check (student_no is null or student_no ~ '^[0-9]{4,8}$');
-- 이미 있는 학생: 학년 · 반(숫자) · 번호로 채움 (2학년 3반 1번 → 20301)
update public.students s
   set student_no = (h.grade * 10000 + h.class_no * 100 + s.number)::text
  from public.homerooms h
 where s.homeroom_id = h.id and s.student_no is null and h.class_no is not null;
drop index if exists students_homeroom_no_key;
create unique index students_homeroom_no_key on public.students (homeroom_id, student_no);
create index if not exists students_login_no_idx on public.students (student_no);
