-- 문제의 updated_at 은 '문제 내용'이 바뀔 때만 갱신 (AI 사전 분석 결과 저장은 수정으로 치지 않음)
-- legacy: analysisStatus_ 가 updatedAt > analysis.at 이면 '분석 후 수정됨(stale)' 으로 표시
create or replace function public.touch_question_updated_at()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'analysis' - 'updated_at') is distinct from (to_jsonb(old) - 'analysis' - 'updated_at') then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end $$;

drop trigger if exists questions_touch on public.questions;
create trigger questions_touch before update on public.questions
  for each row execute function public.touch_question_updated_at();
