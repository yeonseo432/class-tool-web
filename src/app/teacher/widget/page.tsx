import { Suspense } from 'react';
import type { Metadata } from 'next';
import Widget from './widget';

export const metadata: Metadata = { title: '수업 위젯' };

/**
 * 교사 수업 위젯 (legacy Widget.html) — /teacher/widget?lesson=<차시 id>
 * 기존에는 주소에 교사 TOKEN(?t=)을 넣었지만, 이제 로그인 쿠키로 확인해요.
 */
export default function WidgetPage() {
  return (
    <Suspense fallback={null}>
      <Widget />
    </Suspense>
  );
}
