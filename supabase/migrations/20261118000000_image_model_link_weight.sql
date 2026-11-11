-- 그림 만들기에 쓸 OpenAI 모델 (글 모델 openai_model 과 따로). 기본: 그림을 만들 수 있는 gpt-image-1
alter table public.teacher_settings add column if not exists image_model text not null default 'gpt-image-1';

-- 개념 지도 연결선: 두 개념이 서로 관련된 정도 (0~1, AI가 정해 줌 · 교사가 직접 이은 선은 null)
alter table public.links add column if not exists weight real;
alter table public.links drop constraint if exists links_weight_check;
alter table public.links add constraint links_weight_check check (weight is null or (weight >= 0 and weight <= 1));
