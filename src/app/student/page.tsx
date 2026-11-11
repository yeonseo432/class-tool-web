import { Suspense } from 'react';
import type { Metadata } from 'next';
import StudentApp from './student-app';

export const metadata: Metadata = { title: '수업 참여' };

/** 학생 태블릿 화면 — 학년 · 반 · 번호 · 이름 + 비밀번호로 로그인 (교사의 학생 명단에 있어야 해요) */
export default function StudentPage() {
  return (
    <Suspense fallback={null}>
      <StudentApp />
    </Suspense>
  );
}
