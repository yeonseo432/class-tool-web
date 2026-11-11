import 'server-only';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

export type DB = SupabaseClient<Database>;

/** 교사 API 실행 문맥: 교사 세션 클라이언트(RLS 적용) + 교사 id + 앱 주소 */
export type Ctx = { sb: DB; uid: string; origin: string };

/** 사용자에게 그대로 보여줄 오류 (기존 GAS의 throw new Error('…해 주세요.')) */
export class ApiError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Supabase 결과에서 data를 꺼내고, 오류면 ApiError로 (성공 쪽 타입으로 좁힘) */
export function must<R extends { error: PostgrestError | null; data: unknown }>(r: R): Extract<R, { error: null }>['data'] {
  if (r.error) throw new ApiError('데이터베이스 오류: ' + r.error.message, 500);
  return r.data as Extract<R, { error: null }>['data'];
}

/**
 * 1000행 제한(PostgREST max rows)을 넘는 목록을 끝까지 가져옴.
 * make(from, to) 는 .order(...).range(from, to) 가 붙은 쿼리를 돌려줘야 해요 (순서가 있어야 페이지가 안 섞임).
 */
const PAGE = 1000;
export async function all<T>(
  make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const r = await make(from, from + PAGE - 1);
    if (r.error) throw new ApiError('데이터베이스 오류: ' + r.error.message, 500);
    out.push(...(r.data ?? []));
    if (!r.data || r.data.length < PAGE) return out;
  }
}

/**
 * id 목록으로 거르는 큰 목록: id 를 150개씩 나눠 .in() 으로 가져옴 (주소 길이 제한) + 각 묶음은 all() 로 1000행씩.
 * make(chunk, from, to) 는 .in(열, chunk).order(...).range(from, to) 가 붙은 쿼리를 돌려줘야 해요.
 */
export async function allIn<T>(
  ids: string[],
  make: (chunk: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
): Promise<T[]> {
  const out: T[] = [];
  const uniqIds = [...new Set(ids)];
  for (let i = 0; i < uniqIds.length; i += 150) {
    const chunk = uniqIds.slice(i, i + 150);
    out.push(...(await all((a, b) => make(chunk, a, b))));
  }
  return out;
}

/** 기존 uid_(p): 접두어 + 10자리 */
export function uid(prefix: string) {
  return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
}

const TZ = 'Asia/Seoul';
/** 서울 기준 오늘 (yyyy-MM-dd) */
export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** 학년도 (3월 ~ 다음 해 2월): 2027-02-10 → 2026, 2027-03-02 → 2027 */
export function schoolYear(d = today()) {
  const [y, m] = d.split('-').map(Number);
  return m <= 2 ? y - 1 : y;
}

export const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
/** 'yyyy-MM-dd' → UTC 자정 Date */
export const parseDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

export const str = (v: unknown) => (v == null ? '' : String(v));
export const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))) : []);
export const uniq = <T>(a: T[]) => a.filter((v, i) => a.indexOf(v) === i);
