-- gpt-image-1 · dall-e-3 를 쓸 수 없는 키가 있어 기본 그림 모델을 gpt-image-1.5 로
alter table public.teacher_settings alter column image_model set default 'gpt-image-1.5';
update public.teacher_settings set image_model = 'gpt-image-1.5' where image_model in ('gpt-image-1', 'dall-e-3', '');
