import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/database.types';

/**
 * Server Component · Route Handler · Server Action 용 Supabase 클라이언트.
 * 요청마다 새로 만들어야 해요 (전역 변수에 담지 말 것).
 * 교사 세션으로 동작하므로 RLS(owner_id = auth.uid())가 그대로 적용돼요.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Component에서는 쿠키를 쓸 수 없음 — 토큰 갱신은 proxy.ts가 처리
          }
        },
      },
    },
  );
}
