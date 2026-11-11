import Link from 'next/link';
import { ManateeLogo } from '@/components/manatee';
import SiteFooter from '@/components/site-footer';

/** 첫 화면: 교사 · 학생 들어가기 */
export default function Home() {
  return (
    <main style={{ minHeight: '100vh', background: '#f3ebdd', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px 16px 0' }}>
      <div style={{ width: 'min(440px, 100%)', textAlign: 'center', margin: 'auto 0' }}>
        <ManateeLogo size={64} />
        <p style={{ color: '#7a7066', margin: '18px 0 36px', fontSize: 17 }}>수업 중에 문제를 함께 풀고, 바로 확인해요.</p>
        <div style={{ display: 'grid', gap: 14 }}>
          <Link href="/login" style={btn(true)}>교사로 시작하기</Link>
          <Link href="/student" style={btn(false)}>학생 수업 참여</Link>
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}

const btn = (dark: boolean): React.CSSProperties => ({
  display: 'block', padding: 18, borderRadius: 16, fontWeight: 800, fontSize: 18, textDecoration: 'none',
  ...(dark
    ? { background: 'linear-gradient(160deg,#3a3a3a 0%,#1b1b1b 46%,#060606 100%)', color: '#fff', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.16), 0 2px 6px rgba(0,0,0,.18)' }
    : { background: '#f2937b', color: '#161616' }),
});
