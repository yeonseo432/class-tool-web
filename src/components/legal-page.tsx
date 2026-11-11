import Link from 'next/link';
import { ManateeLogo } from '@/components/manatee';
import SiteFooter from '@/components/site-footer';
import { SITE } from '@/lib/site';
import s from './legal-page.module.css';

/** 이용약관 · 개인정보처리방침 공통 틀 (로그인 없이 볼 수 있어요) */
export default function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={s.bg}>
      <header className={s.head}>
        <Link href="/" aria-label="처음 화면으로"><ManateeLogo size={34} /></Link>
        <nav className={s.tabs}>
          <Link href="/terms" className={title === '이용약관' ? s.on : ''}>이용약관</Link>
          <Link href="/privacy" className={title === '개인정보처리방침' ? s.on : ''}>개인정보처리방침</Link>
        </nav>
      </header>
      <main className={s.doc}>
        <h1>{title}</h1>
        <p className={s.meta}>시행일: {SITE.effective}</p>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
