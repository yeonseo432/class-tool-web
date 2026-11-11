-- =====================================================================
--  기본 문항 세트 v2 (모든 교사 계정에 같은 최종 세트) · 선지 그림
--  - questions.sample_key : 기본 세트에서 온 문항이면 원본 문항 번호(예: '역학 1-1'). 교사가 만든 · 복제한 문항은 null
--  - questions.choice_images : 선지별 그림 주소 (choices 와 같은 순서, 없으면 '')
--  - teacher_settings.sample_version : 이 계정에 들어간 기본 세트 버전. 앱의 버전보다 낮으면 접속할 때 새 세트로 바꿔 넣어요
--    (예전 기본 문항은 지우고 새로 넣음 · 교사가 따로 만든 문항은 그대로)
-- =====================================================================

alter table public.questions add column if not exists sample_key text;
alter table public.questions add column if not exists choice_images text[] not null default '{}';
create index if not exists questions_sample_idx on public.questions (owner_id, sample_key) where sample_key is not null;

alter table public.teacher_settings add column if not exists sample_version int not null default 0;
