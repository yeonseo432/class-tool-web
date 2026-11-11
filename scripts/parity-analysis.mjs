#!/usr/bin/env node
/**
 * 통계 검증
 *  1) 형성평가 통계(getFormativeStats): 원본 legacy/gas/Analysis.js 와 '같은 지표'의 값이 같은지 비교
 *     (새로 더한 값 — 오개념 선택 비율 · 명단 정보 · 복수 정답 표시 등 — 과 정렬 순서는 비교에서 빼요)
 *  2) 정기고사 출제 가이드(recommendExam): 원본과 방식이 달라졌으므로(상대 순위 · 오개념 선택 비율, 점수 분포 없음)
 *     원본 비교 대신 규칙을 지키는지 확인
 *   npm run build && npx next start -p 3123   (다른 터미널)
 *   npm run parity:analysis -- http://localhost:3123
 * 임시 교사 계정에 가상 데이터(학생 25명 · 문제 12개 · 개념 8개 · 오개념 3개)를 넣고, 끝나면 지워요.
 */
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const BASE = process.argv[2] || 'http://localhost:3123';
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const admin = createClient(URL_, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

/* ---------- 원본 Analysis.js 를 그대로 불러옴 (계산 함수만 사용) ---------- */
const legacySrc = await readFile(new URL('../legacy/gas/Analysis.js', import.meta.url), 'utf8');
const sandbox = { Math, JSON, Date, Number, String, Array, Object, isNaN, Infinity };
vm.createContext(sandbox);
vm.runInContext(legacySrc + '\n;this.computeStats_ = computeStats_;', sandbox);

/* ---------- 결정적 난수로 가상 데이터 ---------- */
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const SUBJ = '물리';
const C = Array.from({ length: 8 }, (_, i) => ({ id: `c_p${i}`, subject: SUBJ, name: `개념${i}`, x: 100 + i * 50, y: 200, desc: '' }));
const L = [[0, 1], [1, 2], [2, 3], [3, 4], [1, 5], [5, 6]].map(([a, b], i) => ({ id: `e_p${i}`, subject: SUBJ, from: C[a].id, to: C[b].id }));
const MIS = [0, 1, 2].map((i) => ({ id: `m_p${i}`, subject: SUBJ, name: `오개념${i}`, desc: '', conceptIds: i === 2 ? [] : [C[i].id] }));
const Q = Array.from({ length: 12 }, (_, i) => {
  const short = i % 4 === 3;
  const cids = [C[i % 8].id, ...(i % 3 === 0 ? [C[(i + 1) % 8].id] : [])];
  const analysis = i % 2 === 0 ? {
    conceptIds: [C[(i + 2) % 8].id], linkIds: i % 4 === 0 ? [L[i % 6].id] : [],
    choices: short ? [] : [0, 1, 2, 3].map((k) => ({ misIds: k === 1 ? [MIS[i % 3].id] : [], note: '' })),
    shortPatterns: short ? [{ pattern: '오답', misIds: [MIS[0].id] }] : [],
    level: '이해', difficulty: 0.3 + (i % 5) * 0.1, summary: '', suggestions: [], at: 1,
  } : null;
  return {
    id: `q_p${String(i).padStart(2, '0')}`, folderId: '', title: `문제${i}`, subject: SUBJ, type: short ? 'short' : 'mc',
    stem: `문제 ${i} 본문`, choices: short ? [] : ['가', '나', '다', '라'], answer: short ? '정답' : String((i % 4) + 1),
    explanation: '', imageUrl: '', conceptIds: cids,
    misconceptions: short ? [] : ['', '선지 오개념 A', '', '선지 오개념 B'].map((t, k) => (k + 1 === (i % 4) + 1 ? '' : t)),
    analysis,
  };
});
const STUDENTS = Array.from({ length: 25 }, (_, i) => `${String(i + 1).padStart(2, '0')} 학생${i}`);
const ability = STUDENTS.map(() => 0.3 + rnd() * 0.6);

/* ---------- 원본에도 있는 지표만 뽑아 id 순으로 (정렬 · 새 값은 비교에서 제외) ---------- */
const pickKeys = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const byId = (arr, id, keys) => Object.fromEntries(arr.map((x) => [x[id], keys ? pickKeys(x, keys) : x]));
function core(S, keysFrom) {
  const K = (name) => Object.keys(keysFrom[name][0] ?? {});
  return {
    overview: pickKeys(S.overview, ['students', 'responses', 'items', 'analyzedItems', 'mean', 'sd', 'hist']),
    concepts: byId(S.concepts, 'id', ['n', 'c', 'rate', 'mastery', 'students', 'sd', 'mastered', 'mis']),
    links: byId(S.links, 'id', K('links')),
    miscons: byId(S.miscons, 'key', ['hits', 'wrongN', 'share', 'expectedShare', 'z', 'significant', 'exposed', 'students', 'prevalence', 'ci', 'persistent', 'items', 'concepts']),
    items: byId(S.items.map((it) => ({ ...it, choices: it.choices.map((c) => pickKeys(c, ['no', 'correct', 'count', 'rate', 'upRate', 'loRate', 'mis', 'flags'])) })),
      'id', ['n', 'c', 'p', 'D', 'rpb', 'concepts', 'links', 'analyzed', 'choices', 'shorts']),
    students: byId(S.students, 'key', ['n', 'c', 'rate', 'weak', 'mis']),
  };
}

let userId = null;
const close = (a, b, path = '') => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9 || (console.log('  차이', path, a, b), false);
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b || (console.log('  차이', path, a, b), false);
  if (Array.isArray(a) !== Array.isArray(b)) return console.log('  차이(배열?)', path), false;
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join() !== kb.join()) return console.log('  키 차이', path, ka.filter((k) => !kb.includes(k)), kb.filter((k) => !ka.includes(k))), false;
  return ka.every((k) => close(a[k], b[k], path + '.' + k));
};

try {
  const email = `smoke-parity-${Date.now()}@class-tool.test`, password = 'Smoke-' + crypto.randomUUID();
  const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = u.user.id;
  const own = (o) => ({ ...o, owner_id: userId });

  // DB에 같은 데이터 저장
  const sem = { id: 's_p', name: '학기', start_date: '2026-03-02', end_date: '2026-07-17' };
  const cls = { id: 'k_p', semester_id: 's_p', name: '1반', subject: SUBJ, schedule: [] };
  const lessons = Array.from({ length: 6 }, (_, i) => ({ id: `l_p${i}`, class_id: 'k_p', no: i + 1, date: `2026-04-0${i + 1}`, day: '', time: '' }));
  const ins = async (t, rows) => { const r = await admin.from(t).insert(rows.map(own)); if (r.error) throw new Error(t + ': ' + r.error.message); };
  await ins('semesters', [sem]);
  await ins('classes', [cls]);
  await ins('lessons', lessons);
  await ins('concepts', C.map((c) => ({ id: c.id, subject: c.subject, name: c.name, x: c.x, y: c.y, description: '' })));
  await ins('links', L.map((l) => ({ id: l.id, subject: l.subject, from_id: l.from, to_id: l.to })));
  await ins('misconceptions', MIS.map((m) => ({ id: m.id, subject: m.subject, name: m.name, description: m.desc, concept_ids: m.conceptIds })));
  await ins('questions', Q.map((q) => ({ id: q.id, subject: q.subject, title: q.title, type: q.type, stem: q.stem, choices: q.choices, answer: q.answer,
    concept_ids: q.conceptIds, misconceptions: q.misconceptions, analysis: q.analysis })));
  const responses = [];
  let t = Date.parse('2026-04-01T00:00:00Z');
  lessons.forEach((l, li) => {
    Q.slice(li * 2, li * 2 + 4).forEach((q) => {
      STUDENTS.forEach((name, si) => {
        if (rnd() < 0.1) return;   // 결석
        const right = rnd() < ability[si];
        const answer = q.type === 'short' ? (right ? '정답' : pick(['오답', '모름', '오 답'])) : right ? q.answer : String(pick([1, 2, 3, 4].filter((n) => String(n) !== q.answer)));
        responses.push({ lesson_id: l.id, question_id: q.id, student_key: name, student_name: name, answer, correct: right,
          misconception: '', concept_ids: q.conceptIds, created_at: new Date((t += 1000)).toISOString() });
      });
    });
  });
  await ins('responses', responses);

  // 원본 계산
  const Dlegacy = {
    subject: SUBJ, classes: [{ id: 'k_p', name: '1반' }], lessons: lessons.length,
    concepts: C, links: L, miscons: MIS,
    questions: Q.map((q) => ({ ...q, analysis: q.analysis ?? [] })),   // 원본은 빈 칸을 [] 로 읽음
    responses: responses.map((r) => ({ lessonId: r.lesson_id, questionId: r.question_id, student: 'k_p|' + r.student_key, name: r.student_name,
      cls: '1반', answer: r.answer, correct: r.correct, t: Date.parse(r.created_at) })),
  };
  const legacyStats = JSON.parse(JSON.stringify(sandbox.computeStats_(Dlegacy)));
  legacyStats.classes = Dlegacy.classes; legacyStats.lessons = Dlegacy.lessons;

  // 새 서버 계산
  const jar = new Map();
  const ssr = createServerClient(URL_, PUB, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach((c) => jar.set(c.name, c.value)) } });
  await ssr.auth.signInWithPassword({ email, password });
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const T = async (fn, ...args) => {
    const r = await fetch(BASE + '/api/teacher', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ fn, args }) });
    const j = await r.json(); if (!j.ok) throw new Error(fn + ': ' + j.error); return j.data;
  };

  let pass = 0, fail = 0;
  const check = (name, a, b) => { if (close(a, b)) { pass++; console.log('  ✔ ' + name); } else { fail++; console.log('  ✖ ' + name); } };
  console.log(`[형성평가 통계] 응답 ${responses.length}개`);
  const newStats = await T('getFormativeStats', { subject: SUBJ, classId: '', from: '', to: '' });
  check('getFormativeStats: 원본과 같은 지표의 값이 모두 같음', core(newStats, legacyStats), core(legacyStats, legacyStats));
  ok2(newStats.overview.students === 25 && newStats.miscons.some((m) => m.hits > 0), '통계에 학생 · 오개념 집계가 실제로 있음');
  ok2(newStats.miscons.every((m) => m.rate == null || (m.expoResp > 0 && Math.abs(m.rate - m.hits / m.expoResp) < 1e-12)), '오개념 선택 비율 = 고른 응답 ÷ 노출 응답');
  const half = await T('getFormativeStats', { subject: SUBJ, from: '2026-04-01', to: '2026-04-03' });
  const DlegHalf = { ...Dlegacy, lessons: 3, responses: Dlegacy.responses.filter((r) => ['l_p0', 'l_p1', 'l_p2'].includes(r.lessonId)) };
  const legHalf = JSON.parse(JSON.stringify(sandbox.computeStats_(DlegHalf)));
  check('기간 필터(4/1~4/3): 원본과 같음', core(half, legHalf), core(legHalf, legHalf));

  console.log('[정기고사 출제 가이드 — 규칙 확인]');
  const cases = [
    { purpose: 'criterion', n: 20, total: 100, step: 1 },
    { purpose: 'norm', n: 25, total: 100, step: 0.5 },
    { purpose: 'diagnostic', n: 15, total: 60, step: 0.1, conceptIds: [C[0].id, C[1].id, C[2].id, C[5].id] },
  ];
  const plans = {};
  for (const opt of cases) {
    const P = await T('recommendExam', { subject: SUBJ, ...opt });
    plans[opt.purpose] = P;
    const sum = P.slots.reduce((a, s) => a + s.points, 0);
    ok2(P.slots.length === opt.n && Math.abs(sum - opt.total) < 1e-6, `${opt.purpose}: ${opt.n}문항 · 배점 합 ${opt.total}`);
    ok2(P.slots.every((s) => Math.abs(Math.round(s.points / opt.step) * opt.step - s.points) < 1e-6), `${opt.purpose}: 배점이 ${opt.step}점 단위`);
    ok2(!('distribution' in P) && P.slots.every((s) => !('level' in s) && !('p' in s)), `${opt.purpose}: 점수 분포 · 절대 난이도 없음`);
    const k = P.concepts.filter((c) => c.tag !== '자료 없음').length, third = Math.round(k / 3);
    const weak = P.concepts.filter((c) => c.tag === '약점'), strong = P.concepts.filter((c) => c.tag === '강점');
    const rateOf = (c) => newStats.concepts.find((x) => x.id === c.id).mastery;
    ok2(weak.length >= third && strong.length >= third && Math.max(...weak.map(rateOf)) < Math.min(...strong.map(rateOf)),
      `${opt.purpose}: 상대 순위 꼬리표 (약점 ${weak.length} · 강점 ${strong.length} / ${k}개, 약점은 모두 강점보다 정답률 낮음)`);
    const misSlots = P.slots.filter((s) => s.kind === 'mis');
    ok2(misSlots.every((s) => P.miscons.find((m) => m.key === s.misKey)?.assigned), `${opt.purpose}: 오개념 문항은 선택 비율 순위에서`);
    if (opt.conceptIds) ok2(P.concepts.every((c) => opt.conceptIds.includes(c.id)), `${opt.purpose}: 출제 범위 개념만`);
  }
  const weakShare = (P) => P.slots.filter((s) => s.tag === '약점').length / P.slots.length;
  ok2(plans.criterion.concepts.every((c) => c.items >= 1), 'criterion: 범위의 모든 개념 1문항 이상');
  ok2(weakShare(plans.diagnostic) > weakShare(plans.criterion), `진단은 약점 개념 비중이 더 큼 (${weakShare(plans.diagnostic).toFixed(2)} > ${weakShare(plans.criterion).toFixed(2)})`);
  ok2(plans.norm.slots.filter((s) => s.tag === '강점').length / 25 < plans.criterion.slots.filter((s) => s.tag === '강점').length / 20 + 1e-9, '상대평가는 강점 개념 비중이 더 작음');
  ok2((await T('recommendExam', { subject: SUBJ, purpose: 'grouping', n: 10 })).purpose === 'criterion', '없앤 목적(집단 분류)은 기본값으로');
  function ok2(c, m) { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✖ ' + m); } }
  console.log(`\n결과: ${pass}개 통과, ${fail}개 실패`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error('✖ 예외:', e.message);
  process.exitCode = 1;
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId);
  console.log('(시험 계정 정리함)');
}
