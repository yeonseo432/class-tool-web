import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@/server/core';
import {
  studentLogin, studentLogout, studentMe, studentPassword, studentReview, studentState, studentSubmit, studentTranslate, type CookieIO,
} from '@/server/student';
import { COOKIE, COOKIE_MAX_AGE, readSession, signSession } from '@/server/student-auth';

/**
 * 학생용 창구 — POST /api/student { fn, args }
 *   studentLogin(code, studentNo, password, newPassword?) · studentMe() · studentLogout() · studentPassword(cur, next)
 *   studentState() · studentSubmit(qid, answer) · studentReview() (끝난 수업에서 틀린 문제)
 *   studentTranslate(lang, 'current' | 'review') (문제 번역 → { 원문: 번역 }, 화면 표시용)
 * 로그인 상태는 서명한 httpOnly 쿠키 (교사의 학생 명단에 있는 학생만)
 */
const FNS: Record<string, (io: CookieIO, ...a: unknown[]) => Promise<unknown>> = {
  studentLogin: (io, code, no, pw, np) => studentLogin(io, code, no, pw, np),
  studentMe: (io) => studentMe(io),
  studentLogout: (io) => studentLogout(io),
  studentPassword: (io, a, b) => studentPassword(io, a, b),
  studentState: (io) => studentState(io),
  studentSubmit: (io, q, a) => studentSubmit(io, q, a),
  studentReview: (io) => studentReview(io),
  studentTranslate: (io, lang, target) => studentTranslate(io, lang, target),
};

export async function POST(request: NextRequest) {
  let body: { fn?: unknown; args?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail('요청 형식이 올바르지 않아요.', 400);
  }
  const fn = typeof body.fn === 'string' && Object.hasOwn(FNS, body.fn) ? FNS[body.fn] : null;
  if (!fn) return fail('알 수 없는 기능이에요.', 400);

  let setCookie: string | null | undefined;   // undefined: 그대로 · null: 지우기 · 문자열: 새로 설정
  const io: CookieIO = {
    session: readSession(request.cookies.get(COOKIE)?.value),
    login: (ids, sid) => { setCookie = signSession(ids, sid); },
    logout: () => { setCookie = null; },
  };
  let res: NextResponse;
  try {
    const data = await fn(io, ...(Array.isArray(body.args) ? body.args : []));
    res = NextResponse.json({ ok: true, data }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof ApiError) res = fail(e.message, e.status, e.status === 401 ? 'AUTH' : undefined);
    else {
      console.error(`[api/student] ${String(body.fn)} failed`, e);
      res = fail('서버 오류가 났어요. 잠시 후 다시 시도해 주세요.', 500);
    }
  }
  if (setCookie === null) res.cookies.delete(COOKIE);
  else if (setCookie) {
    res.cookies.set(COOKIE, setCookie, {
      httpOnly: true, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:', path: '/', maxAge: COOKIE_MAX_AGE,
    });
  }
  return res;
}

function fail(error: string, status: number, code?: string) {
  return NextResponse.json({ ok: false, error, ...(code ? { code } : {}) }, { status, headers: { 'cache-control': 'no-store' } });
}
