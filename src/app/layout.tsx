import type { Metadata, Viewport } from 'next';
import './globals.css';

/** 글꼴: Pretendard (가변 글꼴 · 화면에 쓰인 글자만 내려받는 dynamic subset) — globals.css 의 --font-sans */
/** 로고 글씨: Lobster (Google Fonts) */
const LOBSTER = 'https://fonts.googleapis.com/css2?family=Lobster&display=swap';
const PRETENDARD = 'https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css';

export const metadata: Metadata = {
  title: { default: 'manatee', template: '%s · manatee' },
  description: '실시간 수업 문제풀이 · 개념지도 · 형성평가 분석',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link rel="stylesheet" href={PRETENDARD} crossOrigin="anonymous" />
        {/* 로고 글씨 (manatee) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={LOBSTER} />
      </head>
      <body>{children}</body>
    </html>
  );
}
