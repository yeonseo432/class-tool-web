/*
 * manatee 로고 (검은색 한 가지 · 투명 배경 PNG)
 *  - 얼굴: public/brand/manatee-face.png  → 작은 자리(메뉴 · 학생 화면 · 탭 아이콘 src/app/icon.png)
 *  - 전신: public/brand/manatee-full.png  → 큰 로고(첫 화면 · 로그인)
 */
/* eslint-disable @next/next/no-img-element -- 작은 정적 PNG라 next/image 최적화가 필요 없음 */

const FULL_RATIO = 900 / 613;   // manatee-full.png 가로 : 세로

/** 매너티 얼굴 */
export function ManateeMark({ size = 48, className }: { size?: number; className?: string }) {
  return <img className={className} src="/brand/manatee-face.png" width={size} height={size} alt="manatee" draggable={false} style={{ display: 'block' }} />;
}

/** 매너티 전신 */
export function ManateeFull({ height = 64, className }: { height?: number; className?: string }) {
  return (
    <img className={className} src="/brand/manatee-full.png" width={Math.round(height * FULL_RATIO)} height={height} alt="manatee"
      draggable={false} style={{ display: 'block' }} />
  );
}

/** 로고 + 글자 (manatee): 전신 매너티 + 글자 */
export function ManateeLogo({ size = 44, color = '#161616' }: { size?: number; color?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.22 }}>
      <ManateeFull height={Math.round(size * 1.15)} />
      <span style={{ fontWeight: 400, fontSize: size * 0.9, letterSpacing: 0, color, lineHeight: 1, fontFamily: "'Lobster', cursive" }}>manatee</span>
    </span>
  );
}
