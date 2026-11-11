-- 개념 지도: 큰 단원 노드('힘과 에너지' 등)와 일반 개념 노드를 구분
--   unit 노드는 하위 개념이 없어도 지도에 나타나고, 개념 노드는 unit 열에 소속 단원 이름을 가짐
alter table public.concepts add column if not exists kind text not null default 'concept';
alter table public.concepts drop constraint if exists concepts_kind_check;
alter table public.concepts add constraint concepts_kind_check check (kind in ('concept', 'unit'));

-- 문항 정보: 문항 기호(예: '역학 1-1'), 그림 상황 설명, 문항에서 드러난 오개념(선지와 무관하게 문항 단위)
--   객관식 정답이 여러 개면 answer 에 '1|3' 처럼 | 로 구분 (단답형과 같은 방식)
alter table public.questions add column if not exists code text not null default '';
alter table public.questions add column if not exists figure text not null default '';
alter table public.questions add column if not exists mis_ids text[] not null default '{}';
