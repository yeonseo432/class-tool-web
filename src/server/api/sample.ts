import 'server-only';
import type { TablesInsert } from '@/lib/database.types';
import { all, allIn, must, uid, type Ctx } from '../core';
import * as M from '../mappers';
import DATA from '../seed/physics-items.json';

/* =================================================================
 *  기본 문항 세트 (seed/physics-items.json — scripts/sample-build.mjs 로 만듦)
 *  최종 수정한 교사 계정에서 내보낸 문항 · 선지별 오개념 · 오개념 목록 · 개념 지도 + 그림(public/sample/*.svg)
 *
 *  교사마다 teacher_settings.sample_version < 세트 version 이면 한 번 맞춰요 (새 계정은 처음 접속할 때).
 *   - 기본 문항(sample_key 있음)은 같은 번호면 그 자리에서 내용만 바꿔요 (문항 id 가 그대로라 차시 · 응답 기록 연결 유지).
 *     세트에서 빠진 번호는 지우고, 새 번호는 추가. (예전 형식) 기본 폴더 안의 예전 문항 번호는 지우고 새로 넣어요.
 *   - 교사가 직접 만들었거나 고친 문항(sample_key 없음)은 그대로 — 기본 문항을 고치면 그때부터 교사 문항이 돼요
 *   - 개념 · 오개념은 이름으로 맞춰요 (있으면 내용을 세트에 맞추고, 없으면 만들고,
 *     예전 세트에만 있던 것은 교사 문항이 쓰지 않을 때만 지움)
 *  그 뒤로는 각 계정에서 자유롭게 고치고, 교사가 추가한 문항은 그 계정에만 있어요.
 * ================================================================= */
type SeedQ = (typeof DATA.questions)[number];
export const SAMPLE_VERSION: number = DATA.version;
/** 임시 세트 (sample:build --provisional): 이미 세트가 있는 계정은 건드리지 않음 — 최종 계정의 문항을 내보내기 전에 지우지 않도록 */
export const SAMPLE_PROVISIONAL: boolean = !!(DATA as { provisional?: boolean }).provisional;

const key = (subject: string, name: string) => subject + '\u0000' + name;
const pathKey = (p: string[]) => p.join('\u0000');

export async function seedSample(ctx: Ctx) {
  const { sb } = ctx;
  const subjects = DATA.subjects;
  const prev = DATA.previous;
  const seedCodes = new Set(DATA.questions.map((q) => q.code));
  const oldCodes = new Set([...prev.codes, ...seedCodes]);

  /* 1. 폴더 트리 (기본 폴더 아래) */
  const folders = must(await sb.from('folders').select('id, name, parent_id'));
  const rootIds = folders.filter((f) => !f.parent_id && f.name === DATA.rootFolder).map((f) => f.id);
  const inRoot = new Set<string>(rootIds);
  for (let grew = true; grew;) {
    grew = false;
    for (const f of folders) if (f.parent_id && inRoot.has(f.parent_id) && !inRoot.has(f.id)) { inRoot.add(f.id); grew = true; }
  }

  /* 2. 예전 기본 문항 정리: 같은 번호의 기본 문항은 남겨 두었다가 8단계에서 내용만 바꿈 */
  const qs = await all((a, b) => sb.from('questions').select('id, folder_id, code, sample_key, subject, concept_ids, choice_mis_ids').order('id').range(a, b));
  const isOldSample = (q: (typeof qs)[number]) => !!q.sample_key || (!!q.folder_id && inRoot.has(q.folder_id) && !!q.code && oldCodes.has(q.code));
  const reuse = new Map<string, (typeof qs)[number]>();   // 번호 → 그대로 둘 기본 문항 (번호마다 하나)
  for (const q of qs) if (q.sample_key && seedCodes.has(q.sample_key) && !reuse.has(q.sample_key)) reuse.set(q.sample_key, q);
  const reused = new Set([...reuse.values()].map((q) => q.id));
  const drop = qs.filter((q) => isOldSample(q) && !reused.has(q.id)).map((q) => q.id);
  for (let i = 0; i < drop.length; i += 150) must(await sb.from('questions').delete().in('id', drop.slice(i, i + 150)));
  const kept = qs.filter((q) => !isOldSample(q));

  /* 3. 개념 (이름으로 맞춤) */
  const [cRows, mRows, lRows] = await Promise.all([
    all((a, b) => sb.from('concepts').select('*').in('subject', subjects).order('id').range(a, b)),
    all((a, b) => sb.from('misconceptions').select('*').in('subject', subjects).order('id').range(a, b)),
    all((a, b) => sb.from('links').select('*').in('subject', subjects).order('id').range(a, b)),
  ]);
  const cByName = new Map(cRows.map((c) => [key(c.subject, c.name), c.id]));
  const cAdd: TablesInsert<'concepts'>[] = [];
  for (const c of DATA.concepts) {
    const rec = { subject: c.subject, name: c.name, kind: c.kind, unit: c.unit ?? '', x: c.x, y: c.y, description: c.desc ?? '' };
    const id = cByName.get(key(c.subject, c.name));
    if (id) must(await sb.from('concepts').update(rec).eq('id', id));
    else { const nid = uid('c_'); cByName.set(key(c.subject, c.name), nid); cAdd.push({ ...rec, id: nid }); }
  }
  if (cAdd.length) must(await sb.from('concepts').insert(cAdd));
  const cid = (subject: string, name: string) => cByName.get(key(subject, name));

  /* 4. 연결선: 세트 개념끼리의 연결은 세트대로 */
  const setConcepts = new Set([...DATA.concepts.map((c) => key(c.subject, c.name)), ...subjects.flatMap((s) => prev.concepts.map((n) => key(s, n)))]);
  const setIds = new Set([...setConcepts].map((k) => cByName.get(k)).filter(Boolean));
  const want = new Set(DATA.links.map((l) => `${cid(l.subject, l.from)}>${cid(l.subject, l.to)}`));
  const have = new Set<string>();
  const lDrop: string[] = [];
  for (const l of lRows) {
    const k = `${l.from_id}>${l.to_id}`;
    if (setIds.has(l.from_id) && setIds.has(l.to_id) && !want.has(k)) lDrop.push(l.id); else have.add(k);
  }
  if (lDrop.length) must(await sb.from('links').delete().in('id', lDrop));
  const lAdd = DATA.links.filter((l) => cid(l.subject, l.from) && cid(l.subject, l.to) && !have.has(`${cid(l.subject, l.from)}>${cid(l.subject, l.to)}`))
    .map((l) => ({ id: uid('e_'), subject: l.subject, from_id: cid(l.subject, l.from)!, to_id: cid(l.subject, l.to)! }));
  if (lAdd.length) must(await sb.from('links').insert(lAdd));

  /* 5. 오개념 (이름으로 맞춤) */
  const mByName = new Map(mRows.map((m) => [key(m.subject, m.name), m.id]));
  const mAdd: TablesInsert<'misconceptions'>[] = [];
  for (const m of DATA.misconceptions) {
    const rec = { subject: m.subject, name: m.name, description: m.desc ?? '', concept_ids: m.concepts.map((n) => cid(m.subject, n)).filter((x): x is string => !!x) };
    const id = mByName.get(key(m.subject, m.name));
    if (id) must(await sb.from('misconceptions').update(rec).eq('id', id));
    else { const nid = uid('m_'); mByName.set(key(m.subject, m.name), nid); mAdd.push({ ...rec, id: nid }); }
  }
  if (mAdd.length) must(await sb.from('misconceptions').insert(mAdd));
  const mid = (subject: string, name: string) => mByName.get(key(subject, name));
  const mName = new Map([...mByName].map(([k, id]) => [id, k.split('\u0000')[1]]));

  /* 6. 예전 세트에만 있던 오개념 · 개념 정리 (교사 문항이 쓰는 것은 남김) */
  const usedM = new Set(kept.flatMap((q) => q.choice_mis_ids.flatMap(M.splitIds)));
  const nowM = new Set(DATA.misconceptions.map((m) => key(m.subject, m.name)));
  const mDrop = mRows.filter((m) => prev.misconceptions.includes(m.name) && !nowM.has(key(m.subject, m.name)) && !usedM.has(m.id)).map((m) => m.id);
  if (mDrop.length) must(await sb.from('misconceptions').delete().in('id', mDrop));
  const usedC = new Set([
    ...kept.flatMap((q) => q.concept_ids),
    ...mRows.filter((m) => !mDrop.includes(m.id) && !nowM.has(key(m.subject, m.name))).flatMap((m) => m.concept_ids),
  ]);
  const nowC = new Set(DATA.concepts.map((c) => key(c.subject, c.name)));
  const cDrop = cRows.filter((c) => prev.concepts.includes(c.name) && !nowC.has(key(c.subject, c.name)) && !usedC.has(c.id)).map((c) => c.id);
  if (cDrop.length) must(await sb.from('concepts').delete().in('id', cDrop));   // 연결선은 함께 지워져요

  /* 7. 폴더 만들기 (경로 기준) */
  const fId = new Map<string, string>();
  const live = folders.slice();
  for (const p of DATA.folders) {
    let parent: string | null = null;
    for (let i = 0; i < p.length; i++) {
      const k = pathKey(p.slice(0, i + 1));
      let id = fId.get(k);
      if (!id) {
        id = live.find((f) => f.name === p[i] && (f.parent_id ?? null) === parent)?.id;
        if (!id) {
          id = uid('f_');
          must(await sb.from('folders').insert({ id, name: p[i], parent_id: parent }));
          live.push({ id, name: p[i], parent_id: parent });
        }
        fId.set(k, id);
      }
      parent = id;
    }
  }

  /* 8. 기본 문항: 같은 번호는 내용만 바꾸고(폴더는 교사가 옮긴 자리 그대로), 없는 번호는 새로 넣음 */
  const rows = DATA.questions.map((q: SeedQ) => {
    const ids = q.choiceMis.map((names) => names.map((n) => mid(q.subject, n)).filter((x): x is string => !!x));
    return {
      id: uid('q_'), folder_id: fId.get(pathKey(q.folder)) ?? null, title: q.title, subject: q.subject, type: q.type,
      stem: q.stem, choices: q.choices, answer: q.answer, explanation: q.explanation, code: q.code, figure: '',
      image_url: q.image, choice_images: q.choiceImages,
      concept_ids: q.concepts.map((n) => cid(q.subject, n)).filter((x): x is string => !!x),
      choice_mis_ids: ids.map(M.joinIds), misconceptions: ids.map((a) => M.joinNames(a.map((id) => mName.get(id)!))), mis_ids: [],
      sample_key: q.code,
    } satisfies TablesInsert<'questions'>;
  });
  const add: typeof rows = [];
  for (const r of rows) {
    const old = reuse.get(r.code);
    if (!old) { add.push(r); continue; }
    const { id: _id, folder_id, ...rest } = r;
    void _id;
    must(await sb.from('questions').update({ ...rest, folder_id: old.folder_id ?? folder_id, analysis: null }).eq('id', old.id));
  }
  for (let i = 0; i < add.length; i += 100) must(await sb.from('questions').insert(add.slice(i, i + 100)));

  /* 9. 기본 폴더 안에서 비게 된 예전 폴더 정리 (세트에 없는 이름 · 문항도 하위 폴더도 없을 때) */
  const setPaths = new Set(fId.values());
  const used = new Set((await allIn([...inRoot], (chunk, a, b) => sb.from('questions').select('folder_id').in('folder_id', chunk).order('id').range(a, b))).map((q) => q.folder_id));
  for (let removed = true; removed;) {
    removed = false;
    for (const f of live) {
      if (!inRoot.has(f.id) || setPaths.has(f.id) || used.has(f.id) || live.some((c) => c.parent_id === f.id)) continue;
      must(await sb.from('folders').delete().eq('id', f.id));
      live.splice(live.indexOf(f), 1);
      removed = true;
      break;
    }
  }
}
