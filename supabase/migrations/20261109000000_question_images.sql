-- 문제 이미지 저장소 (기존: 구글 드라이브 '수업도구_문제이미지' 폴더 + 링크 공개)
-- 학생 태블릿에서 로그인 없이 보이도록 public 버킷. 경로는 <교사 uid>/<파일>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('question-images', 'question-images', true, 5242880, array['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
on conflict (id) do nothing;

create policy "teacher uploads own images" on storage.objects for insert to authenticated
  with check (bucket_id = 'question-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "teacher updates own images" on storage.objects for update to authenticated
  using (bucket_id = 'question-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "teacher deletes own images" on storage.objects for delete to authenticated
  using (bucket_id = 'question-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
