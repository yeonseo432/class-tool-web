#!/usr/bin/env node
/**
 * 시연용: 한 교사 계정의 학생 명단 · 클래스 · 차시 · 형성평가 응답을 다른 교사 계정에 그대로 복사
 *   node --env-file=.env.local scripts/demo-copy-classes.mjs --from 원본@이메일 --to 대상@이메일 [--dry-run]
 *
 * - 문항은 대상 계정의 같은 문제(문제 글이 같은 것)에 연결해요. 대상 계정에 없는 문제는 차시 · 응답에서 빠져요.
 * - 학생은 이름 · 번호 · 학번만 복사하고, 처음 비밀번호(6자리)는 새로 만들어요. 학습코드는 DB가 새로 매겨요.
 * - 응답의 개념은 대상 계정 문제의 개념으로, 수업 기록(세션)은 복사하지 않아요(session_id 없음).
 * - 대상 계정에 같은 반(학년도 · 학교 · 학년 · 반 이름)이 이미 있으면 그 반은 건너뛰어요.
 */
import { createClient } from '@supabase/supabase-js';
import { randomInt, randomUUID } from 'node:crypto';

const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : undefined; };
const FROM = arg('from'), TO = arg('to'), DRY = process.argv.includes('--dry-run');
if (!FROM || !TO) { console.error('사용법: node --env-file=.env.local scripts/demo-copy-classes.mjs --from 원본@이메일 --to 대상@이메일 [--dry-run]'); process.exit(1); }
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const must = (r, what) => { if (r.error) throw new Error(what + ': ' + r.error.message); return r.data; };
const uid = (p) => p + randomUUID().replace(/-/g, '').slice(0, 10);
const pin = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
const write = async (what, fn) => { if (DRY) { console.log('  (dry-run) ' + what); return null; } return must(await fn(), what); };
const all = async (t, owner, cols = '*') => {
  const out = [];
  for (let i = 0; ; i += 1000) {
    const r = must(await admin.from(t).select(cols).eq('owner_id', owner).order('id').range(i, i + 999), t);
    out.push(...r);
    if (r.length < 1000) return out;
  }
};

try {
  const ids = {};
  for (let page = 1; ; page++) {
    const r = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (r.error) throw r.error;
    for (const u of r.data.users) ids[(u.email ?? '').toLowerCase()] = u.id;
    if (r.data.users.length < 1000) break;
  }
  const src = ids[FROM.toLowerCase()], dst = ids[TO.toLowerCase()];
  if (!src) throw new Error(`${FROM} 계정을 찾지 못했어요.`);
  if (!dst) throw new Error(`${TO} 계정을 찾지 못했어요.`);

  const [hrS, stS, clsS, lsS, semS, qS, rsS] = await Promise.all([
    all('homerooms', src), all('students', src, 'id, homeroom_id, number, name, student_no'), all('classes', src), all('lessons', src),
    all('semesters', src), all('questions', src, 'id, stem'), all('responses', src),
  ]);
  const [hrD, semD, qD] = await Promise.all([all('homerooms', dst), all('semesters', dst), all('questions', dst, 'id, stem, concept_ids')]);

  // 문항 · 학기 연결
  const qByStem = new Map(qD.map((q) => [q.stem, q]));
  const qMap = new Map(qS.flatMap((q) => (qByStem.has(q.stem) ? [[q.id, qByStem.get(q.stem)]] : [])));
  const semMap = new Map(semS.flatMap((s) => { const d = semD.find((x) => x.name === s.name); return d ? [[s.id, d.id]] : []; }));

  const hrMap = new Map(), stMap = new Map(), clsMap = new Map(), lsMap = new Map();
  for (const h of hrS) {
    if (hrD.some((x) => x.year === h.year && x.school === h.school && x.grade === h.grade && x.class_name === h.class_name)) {
      console.log(`건너뜀: ${h.school} ${h.grade}학년 ${h.class_name} (대상 계정에 이미 있어요)`);
      continue;
    }
    const nh = { id: uid('h_'), owner_id: dst, year: h.year, school: h.school, grade: h.grade, class_no: h.class_no, class_name: h.class_name };
    hrMap.set(h.id, nh.id);
    await write(`명단 ${h.school} ${h.grade}학년 ${h.class_name}`, () => admin.from('homerooms').insert(nh));
    const st = stS.filter((s) => s.homeroom_id === h.id).map((s) => {
      const ns = { id: uid('st_'), owner_id: dst, homeroom_id: nh.id, number: s.number, name: s.name, student_no: s.student_no, initial_pw: pin() };
      stMap.set(s.id, ns);
      return ns;
    });
    if (st.length) await write(`  학생 ${st.length}명`, () => admin.from('students').insert(st));
  }

  for (const c of clsS.filter((x) => hrMap.has(x.homeroom_id))) {
    const sem = semMap.get(c.semester_id);
    if (!sem) { console.log(`건너뜀: 클래스 '${c.name}' (대상 계정에 같은 이름의 학기가 없어요)`); continue; }
    const nc = { id: uid('k_'), owner_id: dst, semester_id: sem, name: c.name, subject: c.subject, schedule: c.schedule, intro: c.intro, homeroom_id: hrMap.get(c.homeroom_id) };
    clsMap.set(c.id, nc.id);
    await write(`클래스 '${c.name}'`, () => admin.from('classes').insert(nc));
    const ls = lsS.filter((l) => l.class_id === c.id).map((l) => {
      const nl = { id: uid('l_'), owner_id: dst, class_id: nc.id, no: l.no, date: l.date, day: l.day, time: l.time, title: l.title,
        question_ids: l.question_ids.filter((q) => qMap.has(q)).map((q) => qMap.get(q).id), done: l.done };
      lsMap.set(l.id, nl.id);
      return nl;
    });
    if (ls.length) await write(`  차시 ${ls.length}개`, () => admin.from('lessons').insert(ls));
  }

  const rows = rsS.filter((r) => lsMap.has(r.lesson_id) && stMap.has(r.student_key) && qMap.has(r.question_id)).map((r) => ({
    owner_id: dst, lesson_id: lsMap.get(r.lesson_id), session_id: null, question_id: qMap.get(r.question_id).id,
    student_key: stMap.get(r.student_key).id, student_name: stMap.get(r.student_key).name, answer: r.answer, correct: r.correct,
    misconception: r.misconception, concept_ids: qMap.get(r.question_id).concept_ids ?? [], created_at: r.created_at,
  }));
  const skipped = rsS.filter((r) => lsMap.has(r.lesson_id)).length - rows.length;
  console.log(`응답 ${rows.length}개 복사${skipped ? ` (연결할 문제 · 학생이 없어 ${skipped}개 뺌)` : ''}`);
  for (let i = 0; i < rows.length; i += 500) await write(`  응답 ${i + 1}~${Math.min(rows.length, i + 500)}`, () => admin.from('responses').insert(rows.slice(i, i + 500)));

  if (!DRY && hrMap.size) {
    const codes = must(await admin.from('homerooms').select('class_name, code').in('id', [...hrMap.values()]), '학습코드');
    console.log('✔ 끝났어요.', codes.map((c) => `${c.class_name} 학습코드 ${c.code}`).join(' · '));
  }
} catch (e) {
  console.error('✖', e.message);
  process.exit(1);
}
