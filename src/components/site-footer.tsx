import Link from 'next/link';
import { SITE } from '@/lib/site';
import s from './site-footer.module.css';

/**
 * 공통 푸터 — 이용약관 · 개인정보처리방침 · 개발자 · 공모전 정보
 * 대문 · 교사 로그인 · 학생 로그인 · 약관 화면 아래에 붙여요. (교사 화면 대문은 public/teacher-app/app.js 에 같은 내용)
 * t: 학생 화면처럼 번역이 필요하면 넘겨요 (없으면 한국어 그대로)
 */
export default function SiteFooter({ t = (x: string) => x, className }: { t?: (ko: string) => string; className?: string }) {
  return (
    <footer className={`${s.foot} ${className ?? ''}`}>
      <nav className={s.links}>
        <Link href="/terms">{t('이용약관')}</Link>
        <span aria-hidden>·</span>
        <Link href="/privacy"><b>{t('개인정보처리방침')}</b></Link>
      </nav>
      <p>{SITE.name} · {SITE.team} {SITE.members.join(' · ')}</p>
      <p>{SITE.contest} {t('출품작')} · © {SITE.year}</p>
    </footer>
  );
}
