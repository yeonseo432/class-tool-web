import 'server-only';
import type { Tables } from '@/lib/database.types';
import { DONT_KNOW, type Phase } from '@/lib/live';
import { ApiError, must, str, today, type Ctx, type DB } from '../core';
import * as M from '../mappers';
import { notifyLive } from '../realtime';

/* =================================================================
 *  실시간 수업 — 교사(위젯) 쪽 (legacy Code.js 실시간 섹션)
 *  기존: CacheService + Script Properties  →  live_sessions / live_joins / responses 테이블
 *  학생 쪽(studentJoin · studentState · studentSubmit)은 3단계에서 /api/student 로 옮김
 * ================================================================= */

type Session = Tables<'live_sessions'>;

/**
 * 정답 판정 (학생 제출 API에서도 사용)
 * 객관식: 학생 답 '1|3' 과 정답 '1|3' 의 번호 집합이 같아야 정답 (정답이 여러 개면 모두 골라야 함)
 */
export function isCorrect(q: Pick<M.Question, 'type' | 'answer'>, ans: string) {
  if (q.type === 'mc') {
    const a = M.answerNos(q.answer), b = M.answerNos(ans);
    return a.length > 0 && a.length === b.length && a.every((x, i) => x === b[i]);
  }
  const n = (s: string) => String(s).replace(/\s+/g, '').toLowerCase();
  return String(q.answer).split('|').map(n).filter(Boolean).includes(n(ans));
}

/** 차시에 담긴 문제를 순서대로 (수업 시작 시점 스냅샷용) */
async function lessonQuestions(sb: DB, lessonId: string) {
  const l = must(await sb.from('lessons').select('question_ids').eq('id', lessonId).maybeSingle());
  const ids = l?.question_ids ?? [];
  if (!ids.length) return [];
  const rows = must(await sb.from('questions').select('*').in('id', ids)).map(M.question);
  return ids.map((id) => rows.find((q) => q.id === id)).filter((q): q is M.Question => !!q);
}

const snapshot = (s: Session) => (Array.isArray(s.questions) ? (s.questions as unknown as M.Question[]) : []);

async function activeByCode(sb: DB, code: unknown) {
  const s = must(await sb.from('live_sessions').select('*').eq('code', str(code).trim()).neq('phase', 'ended').maybeSingle());
  if (!s) throw new ApiError('진행 중인 수업이 없어요.');
  return s;
}

/** 수업 시작: 진행 중인 세션이 있으면 이어서, 없으면 새 4자리 코드로 */
export async function startLive(ctx: Ctx, lessonIdIn: unknown) {
  const { sb } = ctx;
  const lessonId = str(lessonIdIn);
  const l = must(await sb.from('lessons').select('id, no, class_id, classes(name, subject)').eq('id', lessonId).maybeSingle());
  if (!l) throw new ApiError('차시를 찾을 수 없어요.');
  const qs = await lessonQuestions(sb, lessonId);   // 시작할 때마다 최신 문제 반영
  let s = must(await sb.from('live_sessions').select('*').eq('lesson_id', lessonId).neq('phase', 'ended').maybeSingle());
  // 같은 클래스에서 진행 중인 다른 차시 수업은 끝냄 (학생은 자기 반의 진행 중인 수업 하나로 들어가요)
  const others = must(await sb.from('live_sessions').update({ phase: 'ended', ended_at: new Date().toISOString() })
    .eq('class_id', l.class_id).neq('lesson_id', lessonId).neq('phase', 'ended').select('id'));
  for (const o of others) await notifyLive(o.id, 'phase');
  if (s) {
    must(await sb.from('live_sessions').update({ questions: qs, class_id: l.class_id }).eq('id', s.id));
  } else {
    // 진행 중인 수업끼리 코드가 겹치면 unique 제약에 걸리므로 다시 뽑음
    for (let i = 0; i < 20 && !s; i++) {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      const r = await sb.from('live_sessions').insert({
        code, lesson_id: lessonId, class_id: l.class_id, title: `${l.classes?.name ?? ''} · ${l.no}차시`, subject: l.classes?.subject ?? '', questions: qs,
      }).select().single();
      if (!r.error) s = r.data;
      else if (r.error.code !== '23505') throw new ApiError('수업을 시작하지 못했어요: ' + r.error.message, 500);
      // 같은 차시를 동시에 두 번 시작하면(두 번 클릭 · 개발 모드의 두 번 실행) 먼저 만든 세션을 이어서 씀
      else s = must(await sb.from('live_sessions').select('*').eq('lesson_id', lessonId).neq('phase', 'ended').maybeSingle());
    }
    if (!s) throw new ApiError('수업 코드를 만들지 못했어요. 다시 시도해 주세요.', 500);
  }
  await notifyLive(s.id, 'phase');
  return liveStats(ctx, s.code);
}

export async function liveControl(ctx: Ctx, code: unknown, action: unknown, idx?: unknown) {
  const { sb } = ctx;
  const s = await activeByCode(sb, code);
  const total = snapshot(s).length;
  const patch: { idx?: number; phase?: Phase; ended_at?: string } = {};
  switch (str(action)) {
    case 'goto': patch.idx = Math.max(0, Math.min(total - 1, Number(idx) || 0)); patch.phase = 'waiting'; break;
    case 'open': patch.phase = 'open'; break;
    case 'reveal': patch.phase = 'reveal'; break;
    case 'end': patch.phase = 'ended'; patch.ended_at = new Date().toISOString(); break;
    default: throw new ApiError('알 수 없는 동작이에요.');
  }
  must(await sb.from('live_sessions').update(patch).eq('id', s.id));
  await notifyLive(s.id, 'phase');
  if (patch.phase === 'ended') {
    must(await sb.from('lessons').update({ done: today() }).eq('id', s.lesson_id));
    return { phase: 'ended' as const };
  }
  return liveStats(ctx, s.code);
}

/** 위젯 화면용 현황: 현재 문제, 접속 인원, 제출 · 정답 · 선지별 분포, 아직 안 낸 학생 */
export async function liveStats({ sb }: Ctx, code: unknown) {
  const s = await activeByCode(sb, code);
  const qs = snapshot(s);
  const q = qs[s.idx] ?? null;
  const [joinRows, cls] = await Promise.all([
    sb.from('live_joins').select('student_name').eq('session_id', s.id),
    s.class_id ? sb.from('classes').select('homeroom_id').eq('id', s.class_id).maybeSingle() : Promise.resolve(null),
  ]);
  const homeroomId = cls ? must(cls)?.homeroom_id ?? '' : '';
  const roster = homeroomId
    ? must(await sb.from('students').select('id, number, name').eq('homeroom_id', homeroomId).order('number'))
    : [];
  const joinedIds = new Set(must(joinRows).map((j) => j.student_name));
  const out = {
    code: s.code, channel: s.id, lessonId: s.lesson_id, title: s.title, phase: s.phase as Phase, idx: s.idx, total: qs.length,
    questions: qs.map((x) => ({ id: x.id, title: x.title, type: x.type })),
    q, joined: roster.length ? roster.filter((r) => joinedIds.has(r.id)).length : joinedIds.size,
    rosterN: roster.length, hasRoster: !!homeroomId, n: 0, correctN: 0,
    counts: [] as number[], unknownN: 0, shorts: [] as { text: string; count: number; c: boolean }[],
    /** 제출한 학생 · 고른 선지 번호 (모르겠어요 = []) — 위젯에서 선지를 누르면 그 선지를 고른 학생 이름을 보여 줌 */
    submitted: [] as { name: string; c: boolean; nos: number[]; unknown: boolean }[],
    missing: [] as { name: string; joined: boolean }[],
  };
  if (q) {
    const rs = must(await sb.from('responses').select('student_key, student_name, answer, correct')
      .eq('session_id', s.id).eq('question_id', q.id).order('created_at'));
    out.n = rs.length;
    if (q.type === 'mc') out.counts = q.choices.map(() => 0);
    const sm = new Map<string, { text: string; count: number; c: boolean }>();
    const no = new Map(roster.map((r) => [r.id, r.number]));
    rs.forEach((r) => {
      if (r.correct) out.correctN++;
      const n = no.get(r.student_key);
      const unknown = q.type === 'mc' && r.answer.trim() === DONT_KNOW;
      out.submitted.push({ name: (n ? n + ' ' : '') + r.student_name, c: r.correct, nos: q.type === 'mc' ? M.answerNos(r.answer) : [], unknown });
      if (unknown) out.unknownN++;
      else if (q.type === 'mc') {
        M.answerNos(r.answer).forEach((k) => { if (k >= 1 && k <= out.counts.length) out.counts[k - 1]++; });
      } else {
        const t = r.answer.trim();
        const x = sm.get(t) ?? { text: t, count: 0, c: r.correct };
        x.count++;
        sm.set(t, x);
      }
    });
    out.shorts = [...sm.values()].sort((a, b) => b.count - a.count);
    const done = new Set(rs.map((r) => r.student_key));
    out.missing = roster.filter((r) => !done.has(r.id)).map((r) => ({ name: `${r.number} ${r.name}`, joined: joinedIds.has(r.id) }));
  }
  return out;
}
