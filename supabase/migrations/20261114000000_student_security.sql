-- =====================================================================
--  학생 사칭 방지
--  - 처음 비밀번호: 0000 대신 교사가 나눠 주는 학생별 6자리 숫자(initial_pw).
--    학생이 처음 로그인하면 자기 비밀번호를 정해야 들어갈 수 있고, 그때 initial_pw 는 지워져요.
--  - 한 기기만: 새로 로그인하면 session_id 가 바뀌어 이전 기기는 로그아웃 ("다른 기기에서 로그인" 안내)
-- =====================================================================

alter table public.students add column if not exists initial_pw text;
alter table public.students add column if not exists session_id text;

-- 새 학생은 서버가 무작위 6자리를 넣지만, 직접 넣은 행도 비어 있지 않게
alter table public.students alter column initial_pw set default lpad((floor(random() * 1000000))::int::text, 6, '0');
alter table public.students drop constraint if exists students_initial_pw_check;
alter table public.students add constraint students_initial_pw_check check (initial_pw is null or initial_pw ~ '^[0-9]{6}$');

-- 아직 자기 비밀번호를 정하지 않은(0000 쓰던) 학생에게 6자리 처음 비밀번호를 만들어 줌
update public.students
   set initial_pw = lpad((floor(random() * 1000000))::int::text, 6, '0')
 where password_hash is null and initial_pw is null;
