'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import s from './login.module.css';

type Mode = 'login' | 'signup';

/** 로그인 후 돌아갈 경로 — 같은 사이트 안의 경로만 허용 */
function safeNext(v: string | null) {
  return v && v.startsWith('/') && !v.startsWith('//') ? v : '/teacher';
}

const KO_ERRORS: Record<string, string> = {
  'Invalid login credentials': '이메일 또는 비밀번호가 맞지 않아요.',
  'Email not confirmed': '이메일 인증이 아직 안 됐어요. 받은 메일의 링크를 눌러 주세요.',
  'User already registered': '이미 가입된 이메일이에요. 로그인해 주세요.',
};
const ko = (m: string) => KO_ERRORS[m] ?? m;

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState(params.get('error') ? '인증 링크가 만료됐거나 올바르지 않아요. 다시 시도해 주세요.' : '');
  const [info, setInfo] = useState(params.get('confirmed') ? '이메일 인증이 완료됐어요. 이메일과 비밀번호로 로그인해 주세요.' : '');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setInfo('');
    if (!email.trim()) return setErr('이메일을 입력해 주세요.');
    if (pw.length < 6) return setErr('비밀번호는 6자 이상이어야 해요.');
    setBusy(true);
    const supabase = createClient();
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
        if (error) return setErr(ko(error.message));
        router.replace(next);
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: pw,
          options: { emailRedirectTo: `${location.origin}/auth/confirm?next=${encodeURIComponent(next)}` },
        });
        if (error) return setErr(ko(error.message));
        // 이미 인증까지 끝난 이메일이면 Supabase 는 (계정 존재를 숨기려고) 오류 없이 연결된 로그인 수단이 0개인
        // 가짜 사용자를 돌려주고 메일은 보내지 않음 → 이미 가입된 계정으로 안내하고 로그인 화면으로
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setMode('login');
          setPw('');
          return setErr('이미 가입된 이메일이에요. 비밀번호를 입력해 로그인해 주세요.');
        }
        if (data.session) {
          // 이메일 인증을 끈 프로젝트면 바로 로그인됨
          router.replace(next);
          router.refresh();
        } else {
          setInfo(`${email.trim()} 으로 인증 메일을 보냈어요. 메일의 링크를 누르면 바로 시작할 수 있어요.`);
          setPw('');
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={s.form}>
      <p className={s.msg}>
        {mode === 'login' ? '교사 계정으로 로그인하세요.' : '처음 사용하시네요! 교사 계정을 만들어 주세요.'}
      </p>
      <input
        className={s.inp}
        type="email"
        placeholder="이메일"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoFocus
      />
      <input
        className={s.inp}
        type="password"
        placeholder="비밀번호 (6자 이상)"
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        value={pw}
        onChange={(e) => setPw(e.target.value)}
      />
      <button className={s.btn} disabled={busy}>
        {busy ? '잠시만요…' : mode === 'login' ? '들어가기' : '계정 만들고 시작하기'}
      </button>
      <div className={s.err} role="alert">{err}</div>
      {info && <div className={s.info}>{info}</div>}
      <button
        type="button"
        className={s.switch}
        onClick={() => {
          setMode(mode === 'login' ? 'signup' : 'login');
          setErr('');
          setInfo('');
        }}
      >
        {mode === 'login' ? '처음이세요? 계정 만들기' : '이미 계정이 있어요 · 로그인'}
      </button>
    </form>
  );
}
