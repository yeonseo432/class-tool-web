import 'server-only';
import { DONT_KNOW } from '@/lib/live';
import { all, allIn, ApiError, must, str, type Ctx } from '../core';
import * as M from '../mappers';
import { openaiJson } from '../openai';
import { classesMeta } from './classes';
import { homeroomLabel } from './roster';

/* =================================================================
 *  형성평가 통계 · 정기고사 출제 가이드
 *  - 통계: legacy Analysis.js 3장 (객관식 복수 정답 · 선지별 오개념 여러 개 · 학생 명단 반영)
 *  - 출제 가이드: 학생 능력 추정 · 절대 난이도 · 예상 점수 분포 없이
 *    "개념의 상대적 강약(순위)"과 "오개념 선택 비율"만으로 시험 목적별 설계를 추천
 * ================================================================= */

const MASTERY_CUT = 0.7;   // 형성평가 통계의 '숙달 학생' 기준 (개념 정답률)

/* ---------- 수학 도구 ---------- */
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
function sd(a: number[]) {
  if (a.length < 2) return null;
  const m = mean(a)!;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
}
function pearson(x: number[], y: number[]) {
  const n = x.length, mx = mean(x)!, my = mean(y)!;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}
/** 비율의 95% 신뢰구간 (Wilson) */
function wilson(x: number, n: number): [number, number] | null {
  if (!n) return null;
  const z = 1.96, p = x / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}
/** 최대 잔여법(Hamilton): 정수 total을 가중치에 비례해 나눔. mins = 항목별 최소값 */
function hamilton(weights: number[], total: number, mins?: number[] | null) {
  const n = weights.length, out: number[] = [];
  for (let i = 0; i < n; i++) out.push(mins ? mins[i] : 0);
  if (!n) return out;
  const rest = total - out.reduce((s, v) => s + v, 0);
  if (rest <= 0) return out;
  const sum = weights.reduce((s, v) => s + Math.max(0, v), 0);
  const raw = weights.map((w) => (sum > 0 ? Math.max(0, w) / sum : 1 / n) * rest);
  raw.forEach((r, i) => (out[i] += Math.floor(r)));
  let left = total - out.reduce((s, v) => s + v, 0);
  const order = raw.map((_, i) => i)
    .sort((a, b) => (raw[b] - Math.floor(raw[b])) - (raw[a] - Math.floor(raw[a])) || weights[b] - weights[a]);
  for (let k = 0; left > 0; k++, left--) out[order[k % n]]++;
  return out;
}

/* ---------- 문항의 사전 분석 정보 (예전 AI 분석 결과가 있으면 함께 사용) ---------- */
type Analysis = {
  conceptIds?: string[]; linkIds?: string[]; choices?: { misIds: string[]; note: string }[];
  shortPatterns?: { pattern: string; misIds: string[] }[]; level?: string; difficulty?: number | null; at?: number;
};
const qAnalysis = (q: M.Question | undefined): Analysis | null =>
  q && q.analysis && typeof q.analysis === 'object' && !Array.isArray(q.analysis) ? (q.analysis as Analysis) : null;
/** 교사가 지정한 개념 + AI가 찾은 개념 */
const qConcepts = (q: M.Question) => {
  const a = qAnalysis(q);
  return q.conceptIds.concat(a?.conceptIds ?? []).filter((v, i, arr) => v && arr.indexOf(v) === i);
};
/** 선지 번호(1부터)를 고르면 드러나는 오개념 키 목록: 교사가 연결한 오개념 id → (예전) AI 분석 → 저장된 이름('t:이름') */
function choiceMis(q: M.Question, no: number): string[] {
  const ids = q.choiceMis?.[no - 1] ?? [];
  if (ids.length) return ids.slice();
  const c = qAnalysis(q)?.choices?.[no - 1];
  if (c?.misIds?.length) return c.misIds.slice();
  return (q.choiceMisNames?.[no - 1] ?? []).map((t) => 't:' + t);
}
/** 학생이 고른 오답 선지들에서 드러난 오개념 (중복 없이) */
function pickedMis(q: M.Question, r: { answer: string; correct: boolean }) {
  if (r.correct) return [];
  if (q.type === 'short') return shortMis(q, r.answer);
  const right = new Set(M.answerNos(q.answer)), out: string[] = [];
  M.answerNos(r.answer).filter((n) => !right.has(n)).forEach((n) => choiceMis(q, n).forEach((k) => !out.includes(k) && out.push(k)));
  return out;
}
/** '모르겠어요' 응답 (객관식 답 '0') */
const isUnknown = (r: { answer: string }) => str(r.answer).trim() === DONT_KNOW;
const normAns = (s: unknown) => str(s).replace(/\s+/g, '').toLowerCase();
function shortMis(q: M.Question, ans: string) {
  const n = normAns(ans);
  const hit = (qAnalysis(q)?.shortPatterns ?? []).find((s) => normAns(s.pattern) === n);
  return hit ? hit.misIds.slice() : [];
}

/* =================================================================
 *  1. 형성평가 통계
 * ================================================================= */
type Scope = { subject?: string; classId?: string; from?: string; to?: string };
type Resp = { lessonId: string; questionId: string; student: string; name: string; cls: string; answer: string; correct: boolean; t: number };
type RosterStu = { key: string; id: string; no: number; name: string; cls: string; homeroom: string };
type Data = {
  subject: string; classes: { id: string; name: string }[]; lessons: number;
  concepts: M.Concept[]; links: M.Link[]; miscons: M.Misconception[]; questions: M.Question[]; responses: Resp[];
  roster: RosterStu[];
};

/** opt = {subject, classId, from, to} 범위의 원자료 (+ 클래스에 연결한 학생 명단) */
async function loadScope(ctx: Ctx, opt: Scope): Promise<Data> {
  const { sb } = ctx;
  const subject = str(opt?.subject);
  const classes = (await classesMeta(ctx)).filter((c) => c.subject === subject && (!opt?.classId || c.id === opt.classId));
  const cls = new Map(classes.map((c) => [c.id, c]));
  const hids = [...new Set(classes.map((c) => c.homeroomId).filter(Boolean))];
  // 이 과목 클래스의 차시 → 그 차시의 응답만 DB에서 가져옴 (예전: 교사의 모든 응답을 받아 서버에서 거름)
  const classIds = classes.map((c) => c.id);
  const lessonRows = classIds.length
    ? await allIn(classIds, (ids, a, b) => sb.from('lessons').select('id, class_id, date').in('class_id', ids).order('id').range(a, b))
    : [];
  const inRange = lessonRows.filter((l) => (!opt?.from || l.date >= opt.from) && (!opt?.to || l.date <= opt.to));
  const [respRows, con, lnk, mis, qRows, hrRows, stuRows] = await Promise.all([
    allIn(inRange.map((l) => l.id), (ids, a, b) => sb.from('responses')
      .select('lesson_id, question_id, student_key, student_name, answer, correct, created_at').in('lesson_id', ids).order('id').range(a, b)),
    // 정렬 순서가 같으면 결과(동점 순서 포함)가 항상 같도록 id 순
    sb.from('concepts').select('*').eq('subject', subject).neq('kind', 'unit').order('id'),
    sb.from('links').select('*').eq('subject', subject).order('id'),
    sb.from('misconceptions').select('*').eq('subject', subject).order('id'),
    all((a, b) => sb.from('questions').select('*').order('id').range(a, b)),
    hids.length ? sb.from('homerooms').select('*').in('id', hids) : Promise.resolve(null),
    hids.length ? sb.from('students').select('id, homeroom_id, number, name').in('homeroom_id', hids).order('number') : Promise.resolve(null),
  ]);
  const les = new Map<string, { class_id: string }>();
  inRange.forEach((l) => les.set(l.id, l));
  // 학생 명단: 클래스마다 (같은 명단을 두 클래스가 쓰면 클래스별로 따로)
  const hrs = hrRows ? must(hrRows) : [], stus = stuRows ? must(stuRows) : [];
  const roster: RosterStu[] = [];
  classes.forEach((c) => {
    const hr = hrs.find((h) => h.id === c.homeroomId);
    if (!hr) return;
    stus.filter((s) => s.homeroom_id === hr.id).forEach((s) => roster.push({
      key: c.id + '|' + s.id, id: s.id, no: s.number, name: s.name, cls: c.name, homeroom: homeroomLabel(hr),
    }));
  });
  const used = new Set<string>();
  const responses: Resp[] = [];
  respRows.forEach((r) => {
    const l = les.get(r.lesson_id);
    if (!l) return;
    used.add(r.question_id);
    responses.push({
      lessonId: r.lesson_id, questionId: r.question_id,
      student: l.class_id + '|' + (r.student_key || r.student_name), name: r.student_name || r.student_key,
      cls: cls.get(l.class_id)!.name, answer: r.answer, correct: r.correct, t: new Date(r.created_at).getTime(),
    });
  });
  const concepts = must(con).map(M.concept);
  // 단원 노드(kind 'unit')나 지워진 개념과의 연결은 빼요 (화면에 '← ?' 로 보이지 않게)
  const conIds = new Set(concepts.map((c) => c.id));
  return {
    subject, classes: classes.map((c) => ({ id: c.id, name: c.name })), lessons: les.size,
    concepts, links: must(lnk).map(M.link).filter((l) => conIds.has(l.from) && conIds.has(l.to)), miscons: must(mis).map(M.misconception),
    questions: qRows.map(M.question).filter((q) => q.subject === subject || used.has(q.id)),
    responses, roster,
  };
}

export async function getFormativeStats(ctx: Ctx, opt: Scope) {
  const D = await loadScope(ctx, opt);
  return { ...computeStats(D), classes: D.classes, lessons: D.lessons, hasRoster: D.roster.length > 0 };
}

type Stu = {
  key: string; name: string; cls: string; no: number | null; homeroom: string; inRoster: boolean;
  n: number; c: number; con: Record<string, { n: number; c: number }>; mis: Record<string, number>;
};
type MisAcc = {
  hits: number; wrongN: number; expoN: number; expected: number; variance: number;
  expo: Record<string, 1>; hitStu: Record<string, number>; items: Record<string, 1>; concepts: Record<string, number>;
};

function computeStats(D: Data) {
  const qById = new Map(D.questions.map((q) => [q.id, q]));
  const mById = new Map(D.miscons.map((m) => [m.id, m]));
  const rosterBy = new Map(D.roster.map((s) => [s.key, s]));

  // (1) 같은 학생·차시·문항은 마지막 응답만
  const last: Record<string, Resp> = {};
  D.responses.forEach((r) => {
    if (!qById.has(r.questionId)) return;
    const k = r.student + '#' + r.lessonId + '#' + r.questionId;
    if (!last[k] || last[k].t <= r.t) last[k] = r;
  });
  const R = Object.values(last);

  // (2) 학생별 정답률 (명단에 있으면 번호 · 명단 이름으로)
  const stu: Record<string, Stu> = {};
  const newStu = (key: string, name: string, cls: string): Stu => {
    const ro = rosterBy.get(key);
    return {
      key, name: ro?.name ?? name, cls, no: ro?.no ?? null, homeroom: ro?.homeroom ?? '', inRoster: !!ro,
      n: 0, c: 0, con: {}, mis: {},
    };
  };
  R.forEach((r) => {
    const s = (stu[r.student] ??= newStu(r.student, r.name, r.cls));
    s.n++;
    if (r.correct) s.c++;
  });

  // (3) 문항 분석: 난이도(p), 변별도(상·하위 27% 차이 D, 점이연 상관 r_pb), 선지(오답) 분석
  const byItem: Record<string, Resp[]> = {};
  R.forEach((r) => (byItem[r.questionId] ??= []).push(r));
  const items = Object.keys(byItem).map((qid) => {
    const q = qById.get(qid)!, rs = byItem[qid], a = qAnalysis(q);
    const n = rs.length, c = rs.filter((r) => r.correct).length;
    const ranked = rs.map((r) => {
      const s = stu[r.student];
      return { r, rest: s.n > 1 ? (s.c - (r.correct ? 1 : 0)) / (s.n - 1) : null };
    }).filter((x): x is { r: Resp; rest: number } => x.rest !== null).sort((x, y) => y.rest - x.rest);
    const g = ranked.length >= 4 ? Math.max(1, Math.round(ranked.length * 0.27)) : 0;
    const upper = ranked.slice(0, g), lower = g ? ranked.slice(-g) : [];
    const pOf = (arr: typeof ranked) => (arr.length ? arr.filter((x) => x.r.correct).length / arr.length : null);
    const pU = pOf(upper), pL = pOf(lower);
    const chose = (r: Resp, no: number) => M.answerNos(r.answer).includes(no);
    const out = {
      id: qid, title: q.title, type: q.type, stem: q.stem.slice(0, 140), multi: M.answerNos(q.answer).length > 1,
      n, c, p: n ? c / n : null,
      D: pU !== null && pL !== null ? pU - pL : null,
      rpb: ranked.length >= 5 ? pearson(ranked.map((x) => (x.r.correct ? 1 : 0)), ranked.map((x) => x.rest)) : null,
      concepts: qConcepts(q), links: a?.linkIds ?? [],
      analyzed: !!a || q.choiceMis.some((x) => x.length > 0),
      unknown: q.type !== 'short' ? rs.filter((r) => isUnknown(r)).length : 0,
      choices: [] as { no: number; text: string; image: string; correct: boolean; count: number; rate: number; upRate: number | null; loRate: number | null; mis: string[]; note: string; flags: string[] }[],
      shorts: [] as { text: string; count: number; mis: string[] }[],
    };
    if (q.type !== 'short') {
      const ans = new Set(M.answerNos(q.answer)), wrong = n - c - rs.filter((r) => isUnknown(r)).length;
      out.choices = q.choices.map((txt, i) => {
        const no = i + 1;
        const cnt = rs.filter((r) => chose(r, no)).length;
        const up = upper.filter((x) => chose(x.r, no)).length;
        const lo = lower.filter((x) => chose(x.r, no)).length;
        const ch = {
          no, text: str(txt).slice(0, 80), image: q.choiceImages?.[i] ?? '', correct: ans.has(no), count: cnt, rate: n ? cnt / n : 0,
          upRate: g ? up / g : null, loRate: g ? lo / g : null, mis: choiceMis(q, no),
          note: a?.choices?.[i]?.note ?? '', flags: [] as string[],
        };
        if (!ch.correct) {
          if (cnt >= 2 && (ch.rate >= 0.15 || (wrong && cnt / wrong >= 0.5))) ch.flags.push('매력적 오답');
          if (g && up > lo) ch.flags.push('상위권 유인');
          if (cnt === 0 && n >= 5) ch.flags.push('기능 안 함');
        }
        return ch;
      });
    } else {
      const m: Record<string, { text: string; count: number; mis: string[] }> = {};
      rs.filter((r) => !r.correct).forEach((r) => {
        const t = r.answer.trim();
        (m[t] ??= { text: t, count: 0, mis: shortMis(q, t) }).count++;
      });
      out.shorts = Object.values(m).sort((x, y) => y.count - x.count).slice(0, 8);
    }
    return out;
  });

  // (4) 개념별 숙달도 + 개념 문항에서의 오개념 선택 비율
  type ConAcc = { n: number; c: number; stu: Record<string, { n: number; c: number }>; mis: Record<string, number>; misExpo: number; misHit: number };
  const con: Record<string, ConAcc> = {};
  D.concepts.forEach((c) => (con[c.id] = { n: 0, c: 0, stu: {}, mis: {}, misExpo: 0, misHit: 0 }));
  R.forEach((r) => {
    const s = stu[r.student], q = qById.get(r.questionId)!;
    const offers = q.type !== 'short' ? q.choices.some((_, i) => choiceMis(q, i + 1).length > 0) : (qAnalysis(q)?.shortPatterns ?? []).length > 0;
    const hit = pickedMis(q, r).length > 0;
    qConcepts(q).forEach((cid) => {
      const x = con[cid];
      if (!x) return;
      x.n++;
      if (r.correct) x.c++;
      if (offers) { x.misExpo++; if (hit) x.misHit++; }
      const sx = (x.stu[r.student] ??= { n: 0, c: 0 });
      sx.n++;
      if (r.correct) sx.c++;
      const sc = (s.con[cid] ??= { n: 0, c: 0 });
      sc.n++;
      if (r.correct) sc.c++;
    });
  });

  // (5) 오개념: 노출(그 오개념이 담긴 선지가 있던 응답) 대비 선택, 우연 대비 z검정
  const mis: Record<string, MisAcc> = {};
  const M_ = (key: string) => (mis[key] ??= { hits: 0, wrongN: 0, expoN: 0, expected: 0, variance: 0, expo: {}, hitStu: {}, items: {}, concepts: {} });
  R.forEach((r) => {
    const q = qById.get(r.questionId)!, isMc = q.type !== 'short';
    const offered: Record<string, number> = {};
    if (isMc) q.choices.forEach((_, i) => choiceMis(q, i + 1).forEach((k) => (offered[k] = (offered[k] || 0) + 1)));
    else (qAnalysis(q)?.shortPatterns ?? []).forEach((s) => s.misIds.forEach((k) => (offered[k] = (offered[k] || 0) + 1)));
    const k1 = Math.max(1, q.choices.length - M.answerNos(q.answer).length);
    Object.keys(offered).forEach((key) => {
      const m = M_(key);
      m.expo[r.student] = 1;
      m.expoN++;
      m.items[q.id] = 1;
      if (!r.correct && !(isMc && isUnknown(r))) {
        m.wrongN++;
        if (isMc) { const p0 = Math.min(1, offered[key] / k1); m.expected += p0; m.variance += p0 * (1 - p0); }
      }
    });
    pickedMis(q, r).forEach((key) => {
      const m = M_(key);
      m.hits++;
      m.items[q.id] = 1;
      m.hitStu[r.student] = (m.hitStu[r.student] || 0) + 1;
      stu[r.student].mis[key] = (stu[r.student].mis[key] || 0) + 1;
      qConcepts(q).forEach((cid) => {
        m.concepts[cid] = (m.concepts[cid] || 0) + 1;
        if (con[cid]) con[cid].mis[key] = (con[cid].mis[key] || 0) + 1;
      });
    });
  });
  D.miscons.forEach((m) => M_(m.id));   // 아직 다루지 않은 오개념도 목록에 표시
  const misName = (key: string) => mById.get(key)?.name ?? key.replace(/^t:/, '');
  const miscons = Object.keys(mis).map((key) => {
    const m = mis[key], def = mById.get(key);
    const expoN = Object.keys(m.expo).length, hitN = Object.keys(m.hitStu).length;
    const z = m.variance > 0 ? (m.hits - m.expected) / Math.sqrt(m.variance) : null;
    const cons = def?.conceptIds.length ? def.conceptIds.slice() : Object.keys(m.concepts).sort((x, y) => m.concepts[y] - m.concepts[x]);
    return {
      key, name: misName(key), desc: def?.desc ?? '', listed: !!def,
      hits: m.hits, wrongN: m.wrongN,
      /** 선택 비율 = 이 오개념 선지를 고른 응답 / 이 오개념 선지가 있던 문항의 응답 (문항 수 차이에 흔들리지 않도록 비율로) */
      expoResp: m.expoN, rate: m.expoN ? m.hits / m.expoN : null,
      share: m.wrongN ? m.hits / m.wrongN : null, expectedShare: m.wrongN ? m.expected / m.wrongN : null,
      z, significant: z !== null && z >= 1.96 && m.hits >= 3,
      exposed: expoN, students: hitN, prevalence: expoN ? hitN / expoN : null, ci: wilson(hitN, expoN),
      persistent: Object.keys(m.hitStu).filter((k) => m.hitStu[k] >= 2).length,
      items: Object.keys(m.items).length, concepts: cons.slice(0, 4),
    };
  }).sort((x, y) => (y.rate ?? -1) - (x.rate ?? -1) || y.hits - x.hits || y.exposed - x.exposed);

  const concepts = D.concepts.map((c) => {
    const x = con[c.id];
    const rates = Object.values(x.stu).map((v) => v.c / v.n);
    return {
      id: c.id, name: c.name, unit: c.unit, x: Number(c.x) || 0, y: Number(c.y) || 0,
      n: x.n, c: x.c, rate: x.n ? x.c / x.n : null, mastery: (x.c + 1) / (x.n + 2),
      students: rates.length, sd: sd(rates),
      mastered: rates.length ? rates.filter((v) => v >= MASTERY_CUT).length / rates.length : null,
      misExpo: x.misExpo, misHit: x.misHit, misRate: x.misExpo ? x.misHit / x.misExpo : null,
      mis: Object.keys(x.mis).map((k) => ({ key: k, name: misName(k), count: x.mis[k] })).sort((p, q) => q.count - p.count).slice(0, 5),
    };
  });

  // (6) 개념 간 연결: 연결 문항 정답률 + '앞 개념은 숙달했는데 뒤 개념은 미숙달'인 비율(연결 단절률)
  const linkItems: Record<string, { n: number; c: number }> = {};
  R.forEach((r) => {
    (qAnalysis(qById.get(r.questionId))?.linkIds ?? []).forEach((lid) => {
      const x = (linkItems[lid] ??= { n: 0, c: 0 });
      x.n++;
      if (r.correct) x.c++;
    });
  });
  const cName = new Map(D.concepts.map((c) => [c.id, c.name]));
  const links = D.links.map((l) => {
    const A = con[l.from], B = con[l.to];
    let base = 0, brk = 0;
    if (A && B) Object.keys(A.stu).forEach((k) => {
      const a = A.stu[k], b = B.stu[k];
      if (!b) return;
      if (a.c / a.n >= MASTERY_CUT) { base++; if (b.c / b.n < MASTERY_CUT) brk++; }
    });
    const li = linkItems[l.id];
    const itemRate = li?.n ? li.c / li.n : null, breakRate = base ? brk / base : null;
    return {
      id: l.id, from: l.from, to: l.to,
      fromName: cName.get(l.from) ?? '?', toName: cName.get(l.to) ?? '?',
      itemN: li ? li.n : 0, itemRate, base, breakN: brk, breakRate,
      difficulty: itemRate !== null ? 1 - itemRate : breakRate,
    };
  });

  // (7) 학생·전체 요약 (명단에 있는데 아직 응답이 없는 학생도 포함)
  D.roster.forEach((r) => { stu[r.key] ??= newStu(r.key, r.name, r.cls); });
  const students = Object.values(stu).map((s) => ({
    key: s.key, name: s.name, cls: s.cls, no: s.no, homeroom: s.homeroom, inRoster: s.inRoster,
    n: s.n, c: s.c, rate: s.n ? s.c / s.n : null, con: s.con,
    weak: Object.keys(s.con).filter((cid) => (s.con[cid].c + 1) / (s.con[cid].n + 2) < 0.5),
    mis: Object.keys(s.mis).sort((x, y) => s.mis[y] - s.mis[x]).slice(0, 3).map((key) => ({ key, name: misName(key), count: s.mis[key] })),
  })).sort((x, y) => (x.rate ?? 2) - (y.rate ?? 2) || x.cls.localeCompare(y.cls, 'ko') || (x.no ?? 99) - (y.no ?? 99));
  const rates = students.filter((s) => s.n).map((s) => s.rate!);
  const hist = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  rates.forEach((v) => hist[Math.min(9, Math.floor(v * 10))]++);
  return {
    overview: {
      students: rates.length, roster: D.roster.length, responses: R.length, items: items.length,
      analyzedItems: items.filter((i) => i.analyzed).length,
      mean: mean(rates), sd: sd(rates), hist,
    },
    concepts, links, miscons, items, students,
  };
}
type Stats = ReturnType<typeof computeStats>;

/* =================================================================
 *  2. 정기고사 출제 가이드
 * ================================================================= */
/*  원칙
 *  - 학생 능력 추정 · 절대 난이도 · 예상 점수 분포는 쓰지 않아요.
 *  - 개념의 강약은 '상대 순위'로: 출제 범위 개념을 정답률(평활값 (정답+1)/(응답+2)) 순으로 줄 세워
 *    아래 1/3 = 약점, 위 1/3 = 강점, 나머지 = 보통 (응답이 없는 개념은 '자료 없음')
 *  - 오개념은 '선택 비율' = 고른 응답 / 그 오개념 선지가 있던 문항의 응답 (개념마다 문항 수가 달라도 비교할 수 있게)
 *  - 시험 목적별로 [개념 가중치 · 오개념 문항 비율 · 배점 가중치 · 전 개념 포함 여부]가 달라요.
 *  - 문항 수 · 배점은 최대 잔여법으로 정수(배점 단위) 배분. 배점은 권장 난이도가 먼저(어려울수록 높게), 같은 난이도 안에서 개념(시험 목적별 가중치)
 *  - 문항 순서는 쉬운 문항 → 어려운 문항, 같은 난이도 안에서는 난이도를 정한 근거(개념의 상대 위치 · 오개념)가 같은 문항끼리
 */
type Tag = '약점' | '보통' | '강점' | '자료 없음';
type Slot = {
  kind: 'concept' | 'mis'; tag: Tag | '오개념'; label: string; conceptIds: string[]; evidence: string;
  misKey?: string; weight: number; points: number; no?: number; conceptNames?: string[];
  /** 교사에게 권하는 난이도와 이유 (형성평가 상대 위치 + 시험 목적) */
  level?: '쉬움' | '보통' | '어려움'; levelWhy?: string;
  pick?: string; candidates?: { id: string; title: string; why: string; score: number }[];
};
type Purpose = {
  label: string; misShare: number; coverage: boolean; cw: Record<Tag, number>; pw: (s: Slot) => number;
  /** 추천 설계 설명 (데이터를 넣어 문장으로) */
  why: string[];
  /** 문항마다 권하는 난이도: 개념의 상대 위치(또는 오개념 문항)별 [난이도, 이유] */
  level: Record<Tag | '오개념', ['쉬움' | '보통' | '어려움', string]>;
};
const EXAM_PURPOSES: Record<string, Purpose> = {
  criterion: {
    label: '최소 성취기준 확인', misShare: 0.2, coverage: true,
    cw: { 약점: 2, 보통: 1.3, 강점: 1, '자료 없음': 1.3 }, pw: () => 1,
    why: [
      '범위의 모든 개념을 1문항 이상, 기본 수준으로 물어요.',
      '약한 개념은 한 번 더 묻고, 배점 차이는 난이도만큼만 둬요.',
    ],
    level: {
      약점: ['쉬움', '약한 개념은 기초 수준으로 물어 최소 기준에 도달했는지 확인하면 좋아요'],
      보통: ['보통', '교과서 수준으로 물어 기준 도달 여부를 확인하면 좋아요'],
      강점: ['보통', '이미 잘하는 개념이라 확인용으로 보통 수준이면 충분해요'],
      '자료 없음': ['보통', '형성평가 자료가 없어 보통 수준을 권해요'],
      오개념: ['쉬움', '개념 자체는 쉽게 묻고 그 오개념을 오답 선지로 넣으면, 오개념이 남아 있는지만 깔끔하게 보여요'],
    },
  },
  norm: {
    label: '상대평가 (변별 중심)', misShare: 0.3, coverage: false,
    cw: { 약점: 1.5, 보통: 1.4, 강점: 0.6, '자료 없음': 1 },
    pw: (s) => (s.kind === 'mis' ? 1.2 : s.tag === '약점' ? 1.3 : s.tag === '강점' ? 0.8 : 1),
    why: [
      '반이 잘하는 개념은 줄이고, 중간 · 약한 개념과 매력적 오답에 문항을 모아요.',
      '어려운 문항일수록 배점을 높여 학생 간 차이가 드러나게 해요.',
    ],
    level: {
      약점: ['보통', '약한 개념을 너무 어렵게 내면 대부분 틀려 변별이 안 되니 보통 수준을 권해요'],
      보통: ['보통', '보통 수준으로 내면 아는 학생과 모르는 학생이 갈리기 좋아요'],
      강점: ['어려움', '반이 이미 잘하는 개념이라 어렵게 내야 상위권을 가를 수 있어요'],
      '자료 없음': ['보통', '형성평가 자료가 없어 보통 수준을 권해요'],
      오개념: ['보통', '자주 고른 오개념을 매력적인 오답 선지로 두고 보통 수준으로 내면 변별이 잘 돼요'],
    },
  },
  diagnostic: {
    label: '학습 결손 진단', misShare: 0.4, coverage: false,
    cw: { 약점: 3, 보통: 1, 강점: 0.3, '자료 없음': 1 }, pw: () => 1,
    why: [
      '약한 개념과 자주 고른 오개념에 문항을 모아요.',
      '쉬운 문항부터 물어 어디서 막히는지 찾아요.',
    ],
    level: {
      약점: ['쉬움', '어디서 막히는지 보려면 기초부터 묻는 쉬운 문항이 좋아요'],
      보통: ['보통', '교과서 수준으로 물어 결손이 있는지 확인하면 좋아요'],
      강점: ['보통', '확인용이라 보통 수준이면 충분해요'],
      '자료 없음': ['보통', '형성평가 자료가 없어 보통 수준을 권해요'],
      오개념: ['쉬움', '개념은 쉽게 묻고 그 오개념을 오답 선지로 넣어, 오개념이 남아 있는지 정확히 진단하면 좋아요'],
    },
  },
};

type ExamOpt = Scope & { purpose?: string; n?: number; total?: number; step?: number; conceptIds?: string[] };

export async function recommendExam(ctx: Ctx, opt: ExamOpt) {
  const D = await loadScope(ctx, opt);
  return planExam(computeStats(D), D, opt || {});
}

const pct = (v: number | null | undefined) => (v == null ? '-' : Math.round(v * 100) + '%');

/** 값이 작을수록 약함. 아래 1/3 = 약점, 위 1/3 = 강점 (같은 값은 같은 꼬리표) */
function relativeTags<T extends { v: number }>(list: T[]) {
  const sorted = list.slice().sort((a, b) => a.v - b.v);
  const k = sorted.length, cut = Math.round(k / 3);
  const weakCut = cut ? sorted[cut - 1].v : -Infinity, strongCut = cut ? sorted[k - cut].v : Infinity;
  return new Map(list.map((x) => {
    const rank = sorted.findIndex((y) => y.v === x.v) + 1;   // 1 = 가장 약함 (동점은 같은 순위)
    const tag: Tag = k < 2 ? '보통' : x.v <= weakCut && x.v < strongCut ? '약점' : x.v >= strongCut && x.v > weakCut ? '강점' : '보통';
    return [x, { rank, k, tag }] as const;
  }));
}

function planExam(ST: Stats, D: Data, opt: ExamOpt) {
  const key = opt.purpose && EXAM_PURPOSES[opt.purpose] ? opt.purpose : 'criterion';
  const P = EXAM_PURPOSES[key];
  const N = Math.max(1, Math.min(100, Math.round(Number(opt.n) || 20)));
  const T = Math.max(1, Number(opt.total) || 100);
  const step = [1, 0.5, 0.1].includes(Number(opt.step)) ? Number(opt.step) : 1;

  // 출제 범위 개념 + 상대 순위
  const scopeIds = opt.conceptIds?.length ? opt.conceptIds.map(String) : ST.concepts.map((c) => c.id);
  const scope = new Set(scopeIds);
  const inScope = ST.concepts.filter((c) => scope.has(c.id));
  if (!inScope.length) throw new ApiError('출제 범위에 개념이 없어요. 개념 지도를 먼저 만들어 주세요.');
  const withData = inScope.filter((c) => c.n > 0).map((c) => ({ c, v: c.mastery }));
  const rel = relativeTags(withData);
  const relOf = new Map([...rel.entries()].map(([x, r]) => [x.c.id, r]));
  const cName = new Map(ST.concepts.map((c) => [c.id, c.name]));

  // 오개념: 출제 범위 개념의 오개념 중 노출된 것, 선택 비율 순위
  const misIn = ST.miscons.filter((m) => m.expoResp > 0 && (!m.concepts.length || m.concepts.some((c) => scope.has(c))));
  const misRel = relativeTags(misIn.map((m) => ({ m, v: -(m.rate ?? 0) })));   // 선택 비율이 높을수록 '약점'(자주 고름)
  const misRows = misIn.map((m) => {
    const r = [...misRel.entries()].find(([x]) => x.m === m)![1];
    return { m, rank: r.rank, k: r.k, frequent: (r.tag === '약점' || r.k < 3) && m.hits >= 2 && (m.rate ?? 0) > 0 };
  }).sort((a, b) => a.rank - b.rank || b.m.hits - a.m.hits);

  const C = inScope.map((c) => {
    const r = relOf.get(c.id);
    const tag: Tag = r ? r.tag : '자료 없음';
    return {
      id: c.id, name: c.name, unit: c.unit, n: c.n, rate: c.rate, m: c.mastery, rank: r?.rank ?? null, k: r?.k ?? withData.length, tag,
      misRate: c.misRate, misExpo: c.misExpo,
      topMis: c.mis.slice(0, 3).map((x) => {
        const mm = ST.miscons.find((y) => y.key === x.key);
        return { key: x.key, name: x.name, rate: mm?.rate ?? null };
      }),
      items: 0, points: 0,
    };
  });

  // 문항 수: 오개념 문항(선택 비율 상위 오개념, 오개념마다 1문항) + 개념 문항
  const misPool = misRows.filter((x) => x.frequent).concat(misRows.filter((x) => !x.frequent && x.m.hits > 0));
  let nMis = Math.min(Math.round(N * P.misShare), misPool.length);
  if (nMis >= N) nMis = Math.max(0, N - 1);
  const nCon = N - nMis;
  const cover = P.coverage && nCon >= C.length;
  const cnt = hamilton(C.map((c) => P.cw[c.tag]), nCon, cover ? C.map(() => 1) : null);

  const slots: Slot[] = [];
  C.forEach((c, i) => {
    for (let j = 0; j < cnt[i]; j++) {
      slots.push({
        kind: 'concept', tag: c.tag, label: c.name, conceptIds: [c.id], weight: P.cw[c.tag], points: 0,
        evidence: c.tag === '자료 없음' ? '형성평가 자료 없음'
          : `정답률 ${pct(c.rate)} · ${c.k}개 개념 중 약한 순 ${c.rank}위 → ${c.tag}` + (c.misRate != null ? ` · 오개념 선택 ${pct(c.misRate)}` : ''),
      });
    }
  });
  misPool.slice(0, nMis).forEach(({ m, rank, k }) => {
    slots.push({
      kind: 'mis', tag: '오개념', label: m.name, misKey: m.key, weight: 1, points: 0,
      conceptIds: m.concepts.filter((c) => scope.has(c)).slice(0, 2),
      evidence: `선택 비율 ${pct(m.rate)} (${m.hits}/${m.expoResp}회) · ${k}개 오개념 중 ${rank}위`,
    });
  });

  // 문항마다 권하는 난이도
  slots.forEach((s) => { const [lv, why] = P.level[s.tag]; s.level = lv; s.levelWhy = why; });

  // 배점: 권장 난이도가 먼저(어려울수록 높게), 같은 난이도 안에서는 개념(시험 목적별 가중치)으로 조금씩
  //   난이도 사이 간격(0.35~0.4)이 개념 조정 폭(±0.08)보다 커서, 더 어려운 문항이 더 낮은 배점을 받지 않아요
  const units = Math.round(T / step);
  const LV_W = { 쉬움: 1, 보통: 1.35, 어려움: 1.75 } as const;
  const ws = slots.map((s) => LV_W[s.level!] + 0.25 * (P.pw(s) - 1));
  const pu = hamilton(ws, units, units >= slots.length ? slots.map(() => 1) : null);
  // 반올림으로 순서가 뒤집히지 않게: 가중치가 큰 문항에 큰 배점이 가도록 다시 나눔 (합계는 그대로)
  const byW = slots.map((_, i) => i).sort((a, b) => ws[a] - ws[b]);
  const sortedPu = byW.map((i) => pu[i]).sort((a, b) => a - b);
  byW.forEach((i, k) => (slots[i].points = Math.round(sortedPu[k] * step * 100) / 100));

  // 문항 순서: 쉬운 문항 → 어려운 문항. 같은 난이도에서는 근거가 같은 문항끼리(약점 · 보통 · 강점 개념 → 오개념), 그 안에서는 개념 지도 순서
  const LV_ORDER = { 쉬움: 0, 보통: 1, 어려움: 2 } as const;
  const TAG_ORDER = ['약점', '보통', '강점', '자료 없음', '오개념'];
  const order = new Map(C.slice().sort((a, b) => (a.unit || '').localeCompare(b.unit || '', 'ko') || a.name.localeCompare(b.name, 'ko')).map((c, i) => [c.id, i]));
  const ordOf = (s: Slot) => Math.min(...s.conceptIds.map((id) => order.get(id) ?? 999), 999);
  slots.sort((a, b) => LV_ORDER[a.level!] - LV_ORDER[b.level!] || TAG_ORDER.indexOf(a.tag) - TAG_ORDER.indexOf(b.tag) || ordOf(a) - ordOf(b));
  slots.forEach((s, i) => { s.no = i + 1; s.conceptNames = s.conceptIds.map((id) => cName.get(id) ?? '?'); });

  bankCandidates(slots, D, ST);

  // 요약
  slots.forEach((s) => s.conceptIds.forEach((cid) => {
    const c = C.find((x) => x.id === cid);
    if (c) { c.items += 1 / s.conceptIds.length; c.points += s.points / s.conceptIds.length; }
  }));
  const byKind: Record<string, { label: string; items: number; points: number }> = {};
  slots.forEach((s) => {
    const k = s.kind === 'concept' ? s.tag + ' 개념' : '오개념 확인';
    (byKind[k] ??= { label: k, items: 0, points: 0 });
    byKind[k].items++; byKind[k].points += s.points;
  });
  const kindOrder = ['약점 개념', '보통 개념', '강점 개념', '자료 없음 개념', '오개념 확인'];
  const misSlots = slots.filter((s) => s.kind === 'mis');

  // 꼭 알아야 할 주의만 짧게 (구성 비율은 '권장 구성' 원그래프로 보여요)
  const facts: string[] = [];
  if (!misSlots.length && P.misShare > 0) facts.push('오개념이 연결된 선지의 응답이 없어 오개념 문항은 넣지 않았어요.');
  if (!withData.length) facts.push('형성평가 응답이 없어 개념을 같은 비중으로 나눴어요.');
  if (P.coverage && !cover) facts.push(`문항 수(${nCon})가 개념 수(${C.length})보다 적어 모든 개념을 담지 못해요.`);

  return {
    purpose: key, purposeLabel: P.label, n: N, total: T, step,
    design: { principles: P.why, facts },
    concepts: C.map((c) => ({ ...c, items: round(c.items), points: round(c.points) }))
      .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999)),
    miscons: misRows.map(({ m, rank, k, frequent }) => ({
      key: m.key, name: m.name, rate: m.rate, hits: m.hits, expoResp: m.expoResp, students: m.students, exposed: m.exposed,
      concepts: m.concepts.filter((c) => scope.has(c)).map((c) => cName.get(c) ?? '?'), rank, k, frequent,
      assigned: misSlots.some((s) => s.misKey === m.key),
    })),
    slots,
    summary: { byKind: Object.values(byKind).sort((a, b) => kindOrder.indexOf(a.label) - kindOrder.indexOf(b.label)) },
    stats: { students: ST.overview.students, responses: ST.overview.responses, items: ST.overview.items },
  };
}
const round = (v: number) => Math.round(v * 100) / 100;

/** 문제은행에서 각 칸에 맞는 문항 후보 (같은 문항은 한 칸에만 '추천') */
function bankCandidates(slots: Slot[], D: Data, ST: Stats) {
  const obs = new Map(ST.items.map((it) => [it.id, it]));
  const topMis = new Set(ST.miscons.filter((m) => m.hits >= 2).slice(0, 10).map((m) => m.key));
  const used = new Set<string>();
  slots.forEach((s) => {
    const scored: NonNullable<Slot['candidates']> = [];
    D.questions.forEach((q) => {
      const cs = qConcepts(q);
      const misKeys = new Set(q.type !== 'short' ? q.choices.flatMap((_, i) => choiceMis(q, i + 1)) : (qAnalysis(q)?.shortPatterns ?? []).flatMap((p) => p.misIds));
      let sc: number;
      const why: string[] = [];
      if (s.kind === 'mis') {
        if (!misKeys.has(s.misKey!)) return;
        sc = 3; why.push('이 오개념이 오답 선지에 있음');
        if (s.conceptIds.some((c) => cs.includes(c))) { sc += 0.3; why.push('관련 개념 일치'); }
      } else {
        if (!cs.includes(s.conceptIds[0])) return;
        sc = cs[0] === s.conceptIds[0] ? 2.2 : 2;
        why.push('개념 일치');
        // 약점 · 보통 개념이면 자주 고른 오개념을 선지에 담은 문항을 우선
        const hit = [...misKeys].filter((k) => topMis.has(k)).length;
        if (hit && s.tag !== '강점') { sc += Math.min(0.6, 0.3 * hit); why.push('자주 고른 오개념 선지 포함'); }
      }
      const o = obs.get(q.id);
      if (o && o.D != null && o.D < 0) { sc -= 0.5; why.push('형성평가에서 역변별'); }   // 문항 자체의 품질 문제
      scored.push({ id: q.id, title: q.title, why: why.join(' · '), score: Math.round(sc * 100) / 100 });
    });
    scored.sort((a, b) => b.score - a.score);
    const pick = scored.find((x) => !used.has(x.id));
    if (pick) used.add(pick.id);
    s.pick = pick ? pick.id : '';
    s.candidates = scored.slice(0, 5);
  });
}

/** 출제 포인트 (짧은 정성 코멘트) */
export async function examAdvice(ctx: Ctx, brief: unknown) {
  const sys = '너는 고등학교 과학 교사의 지필평가 출제를 돕는 평가 전문가야. ' +
    '형성평가에서 나온 개념의 상대적 강약(순위)과 오개념 선택 비율, 시험 목적, 문항 구성표를 보고 출제할 때 강조할 포인트를 짧게 정리해. ' +
    '학생 개인의 능력이나 문항의 절대 난이도, 예상 점수 분포는 언급하지 마. ' +
    '구체적인 개념·오개념 이름을 언급하고, 오개념은 어떤 오답 선지로 넣으면 좋을지 예를 들어. 반드시 JSON 하나로만 답해.\n' +
    '형식: {"points":["출제 포인트 3~5개, 각 1~2문장"],"cautions":["주의할 점 1~2개"]}';
  const r = await openaiJson<{ points?: unknown; cautions?: unknown }>(ctx, [
    { role: 'system', content: sys }, { role: 'user', content: JSON.stringify(brief ?? {}).slice(0, 14000) },
  ]);
  const arr = (v: unknown) => (Array.isArray(v) ? v : []).map(String).filter(Boolean).slice(0, 6);
  return { points: arr(r.points), cautions: arr(r.cautions) };
}
