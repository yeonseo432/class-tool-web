import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { API } from '@/server/api';
import { ApiError, type Ctx } from '@/server/core';

/**
 * 교사용 기능 호출 창구 (legacy `function api(token, fn, args)`)
 *   POST /api/teacher  { "fn": "bootstrap", "args": [] }
 *   → 200 { ok: true, data } | 4xx/5xx { ok: false, error, code? }
 * 로그인은 Supabase 세션 쿠키로 확인하고, 데이터 접근은 RLS로 교사 본인 것만.
 */
/** AI 그림 만들기(aiImage)는 1~2분 걸릴 수 있어 여유를 두고 300초 */
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  let body: { fn?: unknown; args?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail('요청 형식이 올바르지 않아요.', 400);
  }
  const fn = typeof body.fn === 'string' && Object.hasOwn(API, body.fn) ? API[body.fn] : null;
  if (!fn) return fail('알 수 없는 기능: ' + String(body.fn), 400);
  const args = Array.isArray(body.args) ? body.args : [];

  const sb = await createClient();
  const { data } = await sb.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) return fail('AUTH: 다시 로그인해 주세요.', 401, 'AUTH');

  const ctx: Ctx = { sb, uid, origin: request.nextUrl.origin };
  try {
    const result = await fn(ctx, ...args);
    return NextResponse.json({ ok: true, data: result ?? null });
  } catch (e) {
    if (e instanceof ApiError) return fail(e.message, e.status);
    console.error(`[api/teacher] ${String(body.fn)} failed`, e);
    return fail('서버 오류가 났어요. 잠시 후 다시 시도해 주세요.', 500);
  }
}

function fail(error: string, status: number, code?: string) {
  return NextResponse.json({ ok: false, error, ...(code ? { code } : {}) }, { status });
}
