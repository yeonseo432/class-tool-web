-- 과목명 '물리' → '물리학' (기본 문항 세트 v4 와 맞춤)
--   기본 세트 맞추기(sample.ts)는 과목 + 이름으로 개념 · 오개념을 찾으므로,
--   기존 '물리' 데이터도 같은 이름으로 바꿔야 '물리' / '물리학' 지도가 따로 생기지 않아요.
--   정확히 '물리' 인 값만 바꿔요 ('물리학', '물리 Ⅰ' 등은 그대로).
update public.questions      set subject = '물리학' where subject = '물리';
update public.concepts       set subject = '물리학' where subject = '물리';
update public.links          set subject = '물리학' where subject = '물리';
update public.misconceptions set subject = '물리학' where subject = '물리';
update public.classes        set subject = '물리학' where subject = '물리';
update public.live_sessions  set subject = '물리학' where subject = '물리';
