import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** 가입 인증 메일의 링크가 돌아오는 곳 (PKCE code 또는 token_hash 둘 다 처리) */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const nextParam = url.searchParams.get('next');
  const next = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/teacher';
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;

  const supabase = await createClient();
  let ok = false;
  if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  else if (tokenHash && type) ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;

  const dest = url.clone();
  dest.search = '';
  if (ok) dest.pathname = next;
  else {
    dest.pathname = '/login';
    dest.searchParams.set('next', next);
    // ?code= 로 돌아왔다면 이메일 인증 자체는 Supabase 에서 이미 끝난 상태.
    // 가입한 곳과 다른 브라우저(휴대폰 메일 앱 등)에서 열어 자동 로그인만 못 한 경우라 로그인하라고 안내.
    dest.searchParams.set(code ? 'confirmed' : 'error', '1');
  }
  return NextResponse.redirect(dest);
}
