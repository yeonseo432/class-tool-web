import 'server-only';
import { createHash, createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

/* =================================================================
 *  학생 로그인 (Supabase 계정 없이)
 *  - 처음 비밀번호: 교사가 나눠 주는 학생별 6자리 숫자(students.initial_pw).
 *    처음 로그인할 때 자기 비밀번호를 정해야 들어갈 수 있고, 그때 initial_pw 는 지워져요.
 *  - 자기 비밀번호: scrypt 해시(students.password_hash)
 *  - 로그인 상태: 서명한 쿠키(httpOnly)에 학생 id 목록 + 로그인 번호(sid).
 *    같은 학년·반·번호·이름 학생이 여러 선생님 명단에 있으면(물리·화학 선생님 등) 함께 담겨요.
 *    새로 로그인하면 students.session_id 가 바뀌어 이전 기기는 로그아웃돼요.
 * ================================================================= */

export const COOKIE = 'qc_student';
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 120;   // 120일 (한 학기)
export const PW_MIN = 4, PW_MAX = 30;

/** 교사가 나눠 줄 처음 비밀번호 (6자리 숫자, 암호학적 난수) */
export const newInitialPassword = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

export function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const h = scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString('base64url')}$${h.toString('base64url')}`;
}

export function checkPassword(pw: string, stored: string | null) {
  if (!stored) return false;
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64url');
  const got = scryptSync(pw, Buffer.from(salt, 'base64url'), want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** 처음 비밀번호 비교 (걸리는 시간으로 맞힌 자리를 알 수 없게) */
export function checkInitial(pw: string, code: string | null) {
  if (!code) return false;
  const a = createHash('sha256').update(pw).digest(), b = createHash('sha256').update(code).digest();
  return timingSafeEqual(a, b);
}

/** 쿠키 서명 키: STUDENT_SESSION_SECRET (없으면 SUPABASE_SECRET_KEY 에서 유도) */
function key() {
  const s = process.env.STUDENT_SESSION_SECRET || process.env.SUPABASE_SECRET_KEY;
  if (!s) throw new Error('STUDENT_SESSION_SECRET 또는 SUPABASE_SECRET_KEY 환경변수가 필요해요.');
  return createHash('sha256').update('qc-student-session:' + s).digest();
}

export type StudentSession = { ids: string[]; sid: string; iat: number };

export const newSessionId = () => randomBytes(12).toString('base64url');

export function signSession(ids: string[], sid: string) {
  const body = Buffer.from(JSON.stringify({ ids, sid, iat: Date.now() } satisfies StudentSession)).toString('base64url');
  const mac = createHmac('sha256', key()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function readSession(token: string | undefined | null): StudentSession | null {
  if (!token) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const want = createHmac('sha256', key()).update(body).digest();
  const got = Buffer.from(mac, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString()) as StudentSession;
    if (!Array.isArray(s.ids) || !s.ids.length || !s.sid || Date.now() - Number(s.iat) > COOKIE_MAX_AGE * 1000) return null;
    return { ids: s.ids.map(String).slice(0, 20), sid: String(s.sid), iat: Number(s.iat) };
  } catch {
    return null;
  }
}
