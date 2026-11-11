#!/usr/bin/env node
/**
 * 기본 문항 세트 내보내기 — 한 교사 계정(예: 최종 수정한 계정)의 '물리 오개념 문항' 폴더를 기본 세트 형식으로 저장
 *   npm run sample:export   (기준 교사 이메일은 .env.local 의 SAMPLE_EMAIL, 또는 -- --email 교사@이메일)
 *   (선택) --folder "물리 오개념 문항"   내보낼 최상위 폴더 이름
 *   (선택) --out data/sample-export.json
 *
 * .env.local 의 운영 Supabase 를 읽기만 해요 (아무것도 바꾸지 않아요). 결과 파일은 이름 기준이라 계정 id 가 들어가지 않아요.
 * 이 파일을 바탕으로 src/server/seed/physics-items.json (모든 교사에게 들어가는 기본 세트)을 만들어요.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const EMAIL = arg('email', process.env.SAMPLE_EMAIL), FOLDER = arg('folder', '물리 오개념 문항'), OUT = arg('out', 'data/sample-export.json');
if (!EMAIL) { console.error('.env.local 에 SAMPLE_EMAIL=기준 교사 이메일 을 넣거나, npm run sample:export -- --email 교사@이메일 로 실행해 주세요.'); process.exit(1); }
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
if (!URL_ || !KEY) { console.error('.env.local 에 NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SECRET_KEY 가 필요해요.'); process.exit(1); }
const admin = createClient(URL_, KEY, { auth: { persistSession: false } });
const must = (r, what) => { if (r.error) throw new Error(what + ': ' + r.error.message); return r.data; };
async function all(make) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = must(await make().range(from, from + 999), 'list');
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

try {
  // 1. 계정 찾기
  let uid = null;
  for (let page = 1; !uid; page++) {
    const r = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (r.error) throw r.error;
    uid = r.data.users.find((u) => (u.email ?? '').toLowerCase() === EMAIL.toLowerCase())?.id ?? null;
    if (r.data.users.length < 1000) break;
  }
  if (!uid) throw new Error(`${EMAIL} 계정을 찾지 못했어요.`);

  // 2. 폴더 트리
  const folders = await all(() => admin.from('folders').select('id, name, parent_id').eq('owner_id', uid).order('id'));
  const root = folders.find((f) => f.name === FOLDER && !f.parent_id);
  if (!root) throw new Error(`'${FOLDER}' 최상위 폴더가 없어요. 있는 최상위 폴더: ${folders.filter((f) => !f.parent_id).map((f) => f.name).join(', ')}`);
  const pathOf = new Map([[root.id, [root.name]]]);
  for (let changed = true; changed;) {
    changed = false;
    for (const f of folders) if (!pathOf.has(f.id) && pathOf.has(f.parent_id)) { pathOf.set(f.id, [...pathOf.get(f.parent_id), f.name]); changed = true; }
  }

  // 3. 문항
  const qs = (await all(() => admin.from('questions').select('*').eq('owner_id', uid).order('id'))).filter((q) => pathOf.has(q.folder_id));
  if (!qs.length) throw new Error(`'${FOLDER}' 폴더에 문항이 없어요.`);
  const subjects = [...new Set(qs.map((q) => q.subject))];
  const [concepts, links, mis] = await Promise.all([
    all(() => admin.from('concepts').select('*').eq('owner_id', uid).in('subject', subjects).order('id')),
    all(() => admin.from('links').select('*').eq('owner_id', uid).in('subject', subjects).order('id')),
    all(() => admin.from('misconceptions').select('*').eq('owner_id', uid).in('subject', subjects).order('id')),
  ]);
  const cName = new Map(concepts.map((c) => [c.id, c.name])), mName = new Map(mis.map((m) => [m.id, m.name]));
  const split = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

  const out = {
    _about: `기준 교사 계정의 '${FOLDER}' 폴더에서 ${new Date().toISOString()} 에 내보낸 기본 문항 세트 (이름 기준)`,
    subjects,
    folders: [...pathOf.values()].sort((a, b) => a.length - b.length || a.join('/').localeCompare(b.join('/'), 'ko')),
    concepts: concepts.map((c) => ({ subject: c.subject, name: c.name, kind: c.kind, unit: c.unit, x: c.x, y: c.y, desc: c.description })),
    links: links.map((l) => ({ subject: l.subject, from: cName.get(l.from_id), to: cName.get(l.to_id) })).filter((l) => l.from && l.to),
    misconceptions: mis.map((m) => ({ subject: m.subject, name: m.name, desc: m.description, concepts: m.concept_ids.map((id) => cName.get(id)).filter(Boolean) })),
    questions: qs
      .sort((a, b) => (a.code || a.title).localeCompare(b.code || b.title, 'ko', { numeric: true }))
      .map((q) => ({
        folder: pathOf.get(q.folder_id), code: q.code, title: q.title, subject: q.subject, type: q.type, stem: q.stem,
        figure: q.figure, image: q.image_url, choices: q.choices, choiceImages: q.choice_images ?? [], answer: q.answer, explanation: q.explanation,
        concepts: q.concept_ids.map((id) => cName.get(id)).filter(Boolean),
        choiceMis: q.choices.map((_, i) => split(q.choice_mis_ids?.[i]).map((id) => mName.get(id)).filter(Boolean)),
        questionMis: (q.mis_ids ?? []).map((id) => mName.get(id)).filter(Boolean),
      })),
  };
  const file = path.resolve(OUT);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 2));
  const linked = out.questions.filter((q) => q.choiceMis.some((a) => a.length)).length;
  console.log(`✔ ${file}\n  문항 ${out.questions.length}개 (선지에 오개념 연결 ${linked}개) · 오개념 ${out.misconceptions.length}개 · 개념 ${out.concepts.length}개 · 폴더 ${out.folders.length}개`);
} catch (e) {
  console.error('✖', e.message);
  process.exit(1);
}
