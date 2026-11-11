-- =====================================================================
--  학생 명단(반)에 학년도 추가
--   - 학년도 = 3월 ~ 다음 해 2월 (2026학년도 = 2026-03-01 ~ 2027-02-28)
--   - 학년도가 끝나면 명단 화면 · 학생 로그인에서 빠져요 (데이터는 남아 지난 수업 분석은 그대로)
--   - 이미 있는 반은 만든 날짜의 학년도로 채워요
-- =====================================================================
alter table public.homerooms add column if not exists year int;

update public.homerooms
   set year = case when extract(month from created_at at time zone 'Asia/Seoul') <= 2
                   then extract(year from created_at at time zone 'Asia/Seoul')::int - 1
                   else extract(year from created_at at time zone 'Asia/Seoul')::int end
 where year is null;

alter table public.homerooms alter column year set default (
  case when extract(month from now() at time zone 'Asia/Seoul') <= 2
       then extract(year from now() at time zone 'Asia/Seoul')::int - 1
       else extract(year from now() at time zone 'Asia/Seoul')::int end);
alter table public.homerooms alter column year set not null;
alter table public.homerooms drop constraint if exists homerooms_year_check;
alter table public.homerooms add constraint homerooms_year_check check (year between 2000 and 2100);

-- 같은 학교 · 학년 · 반이라도 학년도가 다르면 따로
alter table public.homerooms drop constraint if exists homerooms_owner_id_school_grade_class_no_key;
alter table public.homerooms drop constraint if exists homerooms_owner_year_school_grade_class_key;
alter table public.homerooms add constraint homerooms_owner_year_school_grade_class_key unique (owner_id, year, school, grade, class_no);
drop index if exists homerooms_login_idx;
create index if not exists homerooms_login_idx on public.homerooms (grade, class_no, year);
