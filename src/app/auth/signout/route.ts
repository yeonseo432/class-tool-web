import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** 로그아웃 (POST만 — 링크 미리보기 등으로 로그아웃되지 않도록) */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const dest = request.nextUrl.clone();
  dest.pathname = '/login';
  dest.search = '';
  return NextResponse.redirect(dest, { status: 303 });
}
