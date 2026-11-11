-- 기본 AI 모델: 글 gpt-6-luna · 그림 gpt-image-2.5-sunburst (모든 교사 계정을 바꾸고, 새 계정도 이 값으로)
alter table public.teacher_settings alter column openai_model set default 'gpt-6-luna';
alter table public.teacher_settings alter column image_model set default 'gpt-image-2.5-sunburst';
update public.teacher_settings set openai_model = 'gpt-6-luna', image_model = 'gpt-image-2.5-sunburst';
