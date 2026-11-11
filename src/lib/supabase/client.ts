import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/database.types';

/** 브라우저(Client Component)용 Supabase 클라이언트 — 교사 로그인 세션을 쿠키로 공유 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
