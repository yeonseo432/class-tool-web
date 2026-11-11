import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * 로그인 화면으로 보내지 않는 경로.
 * /api 는 각 Route Handler가 직접 로그인을 확인하고 JSON(401)으로 답해요.
 */
const PUBLIC_PREFIXES = ['/login', '/auth', '/student', '/api', '/terms', '/privacy'];

const isPublic = (path: string) =>
  path === '/' || PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));

/** 교사 세션 토큰을 갱신하고, 로그인이 필요한 경로는 /login 으로 보냄 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
          // 토큰이 담긴 응답이 CDN에 캐시되지 않도록
          Object.entries(headers ?? {}).forEach(([k, v]) => supabaseResponse.headers.set(k, v));
        },
      },
    },
  );

  // createServerClient 와 getClaims 사이에 다른 코드를 넣지 말 것 (세션이 풀리는 원인)
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  if (!user && !isPublic(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', request.nextUrl.pathname);
    const redirect = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    for (const h of ['cache-control', 'expires', 'pragma']) {
      const v = supabaseResponse.headers.get(h);
      if (v) redirect.headers.set(h, v);
    }
    return redirect;
  }

  return supabaseResponse;
}
