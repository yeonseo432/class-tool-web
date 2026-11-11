import { Suspense } from 'react';
import type { Metadata } from 'next';
import LoginForm from './login-form';
import { ManateeLogo } from '@/components/manatee';
import SiteFooter from '@/components/site-footer';
import s from './login.module.css';

export const metadata: Metadata = { title: '교사 로그인' };

export default function LoginPage() {
  return (
    <div className={s.bg}>
      <div className={s.box}>
        <div className={s.logo}><ManateeLogo size={46} /></div>
        <h2 className={s.title}>교사 로그인</h2>
        {/* useSearchParams(?next=)를 읽으므로 Suspense 안에서 렌더링 */}
        <Suspense fallback={<p className={s.msg}>불러오는 중…</p>}>
          <LoginForm />
        </Suspense>
      </div>
      <SiteFooter className={s.foot} />
    </div>
  );
}
