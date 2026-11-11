import 'server-only';
import type { Tables } from '@/lib/database.types';
import { DONT_KNOW, type Phase } from '@/lib/live';
import { createAdminClient } from '@/lib/supabase/admin';
import { ApiError, must, schoolYear, str, type DB } from './core';
import { isCorrect } from './api/live';
import { cleanStudentNo, STUDENT_NO } from './api/roster';
import * as M from './mappers';
import { notifyLive } from './realtime';
import {
  checkInitial, checkPassword, hashPassword, newSessionId, PW_MAX, PW_MIN, type StudentSession,
} from './student-auth';

/* =================================================================
 *  학생용 (교사 명단에 있는 학생만) — /api/student
 *  로그인: 학습코드(반마다 4자리) · 학번 + 비밀번호 → 서명한 쿠키(학생 id 목록 + 로그인 번호)
 *    - 처음에는 교사가 나눠 준 6자리 처음 비밀번호 → 그 자리에서 자기 비밀번호를 정해야 들어감
 *    - 새로 로그인하면 이전 기기는 로그아웃 (사칭을 당한 학생이 바로 알 수 있게)
 *  화면: 평소엔 빈 화면 → 교사가 [문제 출제하기]를 누르면 문제 → 제출하면 고른 답 · 정답 → [제출 마감]이면 다시 빈 화면
 *  secret key 클라이언트를 쓰므로 학생 · 수업 · 단계 · 문제를 여기서 반드시 직접 검증.
 * ================================================================= */

type Session = Tables<'live_sessions'>;
type StudentRow = Tables<'students'>;
const ANSWER_MAX = 200;
/** 너무 쉬운 비밀번호 (반 친구가 바로 맞힐 수 있는 것) */
const WEAK = new Set(['0000', '1111', '1234', '12345', '123456', '4321', '0123', 'abcd', 'qwer', 'password', '1q2w3e4r']);

/** 쿠키를 읽고 쓰는 창구 (Route Handler 가 넘겨줌) */
export type CookieIO = { session: StudentSession | null; login: (ids: string[], sid: string) => void; logout: () => void };

const snapshot = (s: Session) => (Array.isArray(s.questions) ? (s.questions as unknown as M.Question[]) : []);

export const MSG_OTHER_DEVICE = '같은 학생 정보로 다른 기기에서 로그인해서 이 기기는 로그아웃됐어요. 본인이 아니라면 다시 로그인해 비밀번호를 바꾸고 선생님께 알려 주세요.';
export const MSG_RESET = '선생님이 비밀번호를 새로 만들었어요. 선생님께 받은 6자리 처음 비밀번호로 다시 로그인해 주세요.';

/** 쿠키의 학생들. 다른 기기에서 새로 로그인했거나 교사가 비밀번호를 새로 만들었으면 로그아웃 */
async function me(sb: DB, io: CookieIO) {
  const s = io.session;
  if (!s) return [];
  let rows = must(await sb.from('students').select('*').in('id', s.ids));
  if (rows.length) {
    // 학년도가 끝난 명단의 학생은 로그아웃
    const live = new Set(must(await sb.from('homerooms').select('id').in('id', [...new Set(rows.map((r) => r.homeroom_id))]).gte('year', schoolYear())).map((h) => h.id));
    rows = rows.filter((r) => live.has(r.homeroom_id));
  }
  if (!rows.length) { io.logout(); return []; }
  if (rows.some((r) => r.session_id !== s.sid)) {
    io.logout();
    throw new ApiError(rows.some((r) => !r.session_id) ? MSG_RESET : MSG_OTHER_DEVICE, 401);
  }
  return rows;
}

function profile(rows: StudentRow[], hr: { grade: number; class_name: string } | undefined) {
  const r = rows[0];
  return { name: r.name, studentNo: r.student_no ?? '', grade: hr?.grade ?? 0, className: hr?.class_name ?? '' };
}

function checkNewPassword(next: string, old: string) {
  if (next.length < PW_MIN || next.length > PW_MAX) throw new ApiError(`새 비밀번호는 ${PW_MIN}~${PW_MAX}자로 정해 주세요.`);
  if (next === old) throw new ApiError('지금 비밀번호와 다른 비밀번호로 정해 주세요.');
  if (WEAK.has(next.toLowerCase()) || /^(.)\1+$/.test(next)) throw new ApiError('친구가 쉽게 맞힐 수 있는 비밀번호예요. 다른 비밀번호로 정해 주세요.');
}

export type LoginResult = { needNewPassword: true } | ({ needNewPassword: false } & ReturnType<typeof profile>);

/**
 * 로그인: 학습코드(반마다 4자리)로 반을 찾고, 그 반의 학번 학생 + 비밀번호.
 * 같은 학교 · 같은 학번의 학생이 이번 학년도 다른 반(다른 선생님 · 다른 과목) 명단에도 있고 비밀번호가 같으면 함께 로그인해요
 * (한 번 로그인하면 들어 있는 모든 반의 수업에 들어갈 수 있게).
 * 처음 비밀번호(6자리)로 들어오면 newPw(자기 비밀번호)를 함께 보내야 해요 — 없으면 { needNewPassword: true }.
 */
export async function studentLogin(io: CookieIO, codeIn: unknown, studentNoIn: unknown, pwIn: unknown, newPwIn?: unknown): Promise<LoginResult> {
  const code = str(codeIn).trim(), studentNo = cleanStudentNo(studentNoIn), pw = str(pwIn);
  if (!/^[0-9]{4}$/.test(code)) throw new ApiError('학습코드 4자리 숫자를 입력해 주세요.');
  if (!STUDENT_NO.test(studentNo)) throw new ApiError('학번을 숫자로 입력해 주세요. (예: 30301)');
  if (!pw) throw new ApiError('비밀번호를 입력해 주세요.');
  const sb = createAdminClient();
  const year = schoolYear();
  // 학년도가 끝난 명단은 빼고 (지난 학년도 반은 로그인할 수 없어요)
  const hr = must(await sb.from('homerooms').select('id, school, grade, class_name').eq('code', code).gte('year', year)).at(0);
  if (!hr) throw new ApiError('학습코드가 맞지 않아요. 선생님이 알려 준 4자리 코드를 확인해 주세요.', 403);
  const main = must(await sb.from('students').select('*').eq('homeroom_id', hr.id).eq('student_no', studentNo)).at(0);
  if (!main) throw new ApiError('이 반 명단에 없는 학번이에요. 학번을 확인하고, 그래도 안 되면 선생님께 말씀드려 주세요.', 403);
  // 같은 학교 이번 학년도 다른 반의 같은 학번 (학교 이름이 없으면 이 반만)
  const sibHr = hr.school
    ? must(await sb.from('homerooms').select('id').eq('school', hr.school).gte('year', year).neq('id', hr.id)).map((h) => h.id)
    : [];
  const sibs = sibHr.length ? must(await sb.from('students').select('*').in('homeroom_id', sibHr).eq('student_no', studentNo)) : [];
  let ok: StudentRow[];
  if (checkPassword(pw, main.password_hash)) {
    ok = [main, ...sibs.filter((r) => checkPassword(pw, r.password_hash))];
  } else if (!main.password_hash && checkInitial(pw, main.initial_pw)) {
    const next = str(newPwIn);
    if (!next) return { needNewPassword: true };
    checkNewPassword(next, pw);
    must(await sb.from('students').update({ password_hash: hashPassword(next), initial_pw: null }).eq('id', main.id));
    // 다른 반 명단에서 이미 같은 비밀번호를 정했다면 그 명단도 함께 로그인
    ok = [main, ...sibs.filter((r) => checkPassword(next, r.password_hash))];
  } else {
    throw new ApiError('비밀번호가 맞지 않아요. 처음이면 선생님이 나눠 준 6자리 비밀번호를 넣고, 잊었으면 선생님께 새로 만들어 달라고 하세요.', 400);
  }
  const sid = newSessionId();
  must(await sb.from('students').update({ session_id: sid }).in('id', ok.map((r) => r.id)));
  io.login(ok.map((r) => r.id), sid);
  return { needNewPassword: false, ...profile(ok, hr) };
}

export async function studentMe(io: CookieIO) {
  const sb = createAdminClient();
  const rows = await me(sb, io);
  if (!rows.length) return null;
  const hr = must(await sb.from('homerooms').select('grade, class_name').eq('id', rows[0].homeroom_id).maybeSingle()) ?? undefined;
  return profile(rows, hr);
}

export async function studentLogout(io: CookieIO) {
  io.logout();
  return { ok: true };
}

/** 비밀번호 바꾸기 (명단 여러 곳에 있으면 모두 함께) */
export async function studentPassword(io: CookieIO, curIn: unknown, nextIn: unknown) {
  const cur = str(curIn), next = str(nextIn);
  const sb = createAdminClient();
  const rows = await me(sb, io);
  if (!rows.length) throw new ApiError('다시 로그인해 주세요.', 401);
  if (!rows.every((r) => checkPassword(cur, r.password_hash))) throw new ApiError('지금 비밀번호가 맞지 않아요.');
  checkNewPassword(next, cur);
  must(await sb.from('students').update({ password_hash: hashPassword(next) }).in('id', rows.map((r) => r.id)));
  return { ok: true };
}

/** 내 반(명단)이 연결된 클래스에서 진행 중인 수업 (가장 최근 것) + 그 수업 선생님 명단의 나 */
async function activeFor(sb: DB, rows: StudentRow[]) {
  const hids = [...new Set(rows.map((r) => r.homeroom_id))];
  const classes = must(await sb.from('classes').select('id, homeroom_id').in('homeroom_id', hids));
  if (!classes.length) return null;
  const s = must(await sb.from('live_sessions').select('*').in('class_id', classes.map((c) => c.id)).neq('phase', 'ended')
    .order('started_at', { ascending: false }).limit(1)).at(0);
  if (!s) return null;
  const hid = classes.find((c) => c.id === s.class_id)?.homeroom_id;
  const stu = rows.find((r) => r.homeroom_id === hid && r.owner_id === s.owner_id);
  return stu ? { s, stu } : null;
}

export type StudentView = {
  /** idle: 빈 화면 · question: 문제 풀기 · result: 제출 후 · 정답 공개 */
  view: 'idle' | 'question' | 'result';
  /** 빈 화면일 때 이유 — none: 진행 중인 수업 없음 · waiting: 문제 내기 전 · closed: 제출 마감(안 낸 학생) */
  status?: 'none' | 'waiting' | 'closed';
  channel: string | null;
  question: null | {
    id: string; no: number; type: 'mc' | 'short'; stem: string; choices: string[]; imageUrl: string;
    /** 그림 선지 (없으면 '') */
    choiceImages: string[];
    /** 객관식에서 골라야 하는 답의 개수 */
    need: number;
  };
  /**
   * 제출 후 · 정답 공개 때도 question 에 문제 원문을 함께 보내요 (학생이 문제와 자기 답을 계속 볼 수 있게).
   * 제출 후 · 정답 공개. 정답 여부와 정답은 교사가 [정답 공개]를 누른 뒤(revealed)에만 보내요
   * (먼저 낸 학생이 아직 푸는 친구에게 정답을 알려 주지 않도록). answer=null: 제출하지 않음
   */
  result: null | { answer: string | null; correct: boolean | null; correctAnswer: string | null; revealed: boolean };
};

export async function studentState(io: CookieIO): Promise<StudentView> {
  const sb = createAdminClient();
  const rows = await me(sb, io);
  if (!rows.length) throw new ApiError('다시 로그인해 주세요.', 401);
  const idle: StudentView = { view: 'idle', status: 'none', channel: null, question: null, result: null };
  const a = await activeFor(sb, rows);
  if (!a) return idle;
  const { s, stu } = a;
  // 접속 표시 (세션마다 한 번, 위젯의 '접속 n명')
  const j = must(await sb.from('live_joins')
    .upsert({ session_id: s.id, student_name: stu.id }, { onConflict: 'session_id,student_name', ignoreDuplicates: true })
    .select('student_name'));
  if (j.length) await notifyLive(s.id, 'join');
  const q = snapshot(s)[s.idx];
  const phase = s.phase as Phase;
  if (!q || phase === 'waiting') return { ...idle, status: 'waiting', channel: s.id };
  const mine = must(await sb.from('responses').select('answer, correct').eq('session_id', s.id).eq('question_id', q.id)
    .eq('student_key', stu.id).maybeSingle());
  const question = qView(q, s.idx);
  if (phase === 'reveal') {
    // 정답 공개: 문제 · 내 답 · 정답 여부 · 정답 (해설은 보내지 않음, 안 낸 학생은 정답만)
    return { view: 'result', channel: s.id, question,
      result: { answer: mine?.answer ?? null, correct: mine ? mine.correct : null, correctAnswer: q.answer, revealed: true } };
  }
  if (mine) {
    // 제출 후: 문제와 내가 고른 답 (정답 여부는 공개할 때)
    return { view: 'result', channel: s.id, question, result: { answer: mine.answer, correct: null, correctAnswer: null, revealed: false } };
  }
  if (phase !== 'open') return { ...idle, status: 'closed', channel: s.id };
  return { view: 'question', channel: s.id, result: null, question };
}

/** 학생에게 보내는 문제 (정답 · 오개념 · 해설은 빼고) */
function qView(q: M.Question, idx: number): NonNullable<StudentView['question']> {
  return {
    id: q.id, no: idx + 1, type: q.type, stem: q.stem, choices: q.type === 'mc' ? q.choices : [], imageUrl: q.imageUrl,
    choiceImages: q.type === 'mc' ? q.choices.map((_, i) => q.choiceImages?.[i] ?? '') : [],
    need: q.type === 'mc' ? Math.max(1, M.answerNos(q.answer).length) : 1,
  };
}

export async function studentSubmit(io: CookieIO, qid: unknown, answerIn: unknown) {
  const sb = createAdminClient();
  const rows = await me(sb, io);
  if (!rows.length) throw new ApiError('다시 로그인해 주세요.', 401);
  const a = await activeFor(sb, rows);
  if (!a || a.s.phase !== 'open') throw new ApiError('지금은 답을 제출할 수 없어요.');
  const { s, stu } = a;
  const q = snapshot(s)[s.idx];
  if (!q || q.id !== str(qid)) throw new ApiError('문제가 바뀌었어요. 화면을 확인해 주세요.');
  let answer = str(answerIn).trim().slice(0, ANSWER_MAX);
  if (!answer) throw new ApiError('답을 선택(입력)해 주세요.');
  let misNames: string[] = [];
  if (q.type === 'mc' && answer === DONT_KNOW) {
    // '모르겠어요': 오답으로 기록하되 선지 · 오개념은 없음
  } else if (q.type === 'mc') {
    const nos = M.answerNos(answer);
    const need = Math.max(1, M.answerNos(q.answer).length);
    if (!nos.length || nos.some((n) => n > q.choices.length) || nos.length !== answer.split('|').length) throw new ApiError('보기 중에서 골라 주세요.');
    if (nos.length !== need) throw new ApiError(`답을 ${need}개 골라 주세요.`);
    answer = nos.join('|');
    const right = new Set(M.answerNos(q.answer));
    nos.filter((n) => !right.has(n)).forEach((n) => (q.choiceMisNames?.[n - 1] ?? []).forEach((x) => !misNames.includes(x) && misNames.push(x)));
  }
  const correct = isCorrect(q, answer);
  if (correct) misNames = [];
  const r = await sb.from('responses').insert({
    owner_id: s.owner_id, lesson_id: s.lesson_id, session_id: s.id, question_id: q.id,
    student_key: stu.id, student_name: stu.name, answer, correct, misconception: M.joinNames(misNames), concept_ids: q.conceptIds ?? [],
  });
  if (r.error?.code === '23505') throw new ApiError('이미 제출했어요.');
  if (r.error) throw new ApiError('제출하지 못했어요. 다시 시도해 주세요.', 500);
  await sb.from('live_joins').upsert({ session_id: s.id, student_name: stu.id }, { onConflict: 'session_id,student_name', ignoreDuplicates: true });
  await notifyLive(s.id, 'response');
  return { ok: true };
}
