'use client';

/**
 * 문제 이미지. 예전 구글 드라이브 썸네일 주소가 막히면 lh3 주소로 한 번 더 시도
 * (legacy Student.html 의 onerror 처리). 새 이미지는 Supabase Storage 주소.
 */
export default function QuestionImage({ src, className, alt = '문제 그림' }: { src: string; className?: string; alt?: string }) {
  if (!src) return null;
  return (
    // 외부(Storage · Drive) 이미지라 next/image 최적화 대신 그대로 표시
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={src}
      alt={alt}
      onError={(e) => {
        const img = e.currentTarget;
        if (img.dataset.retry) return;
        img.dataset.retry = '1';
        img.src = img.src.replace('drive.google.com/thumbnail?id=', 'lh3.googleusercontent.com/d/').replace(/&sz=.*/, '');
      }}
    />
  );
}
