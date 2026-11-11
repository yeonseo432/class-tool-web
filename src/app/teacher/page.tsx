import type { Metadata } from 'next';
import TeacherApp from './teacher-app';

export const metadata: Metadata = { title: '교사 화면' };

/** 교사 화면 — 로그인은 proxy.ts 가 확인하고, 데이터는 화면 스크립트가 /api/teacher 로 불러와요 */
export default function TeacherPage() {
  return <TeacherApp />;
}
