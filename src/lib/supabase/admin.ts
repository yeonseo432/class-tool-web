import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

/**
 * secret key로 RLS를 우회하는 관리자 클라이언트.
 * 로그인하지 않는 학생 API(/api/student/*)에서만 사용하고,
 * 호출하는 쪽에서 수업 코드·진행 단계를 반드시 직접 검증해야 해요.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY 환경변수가 없어요.');
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
