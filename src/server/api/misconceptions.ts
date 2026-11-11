import 'server-only';
import type { TablesInsert } from '@/lib/database.types';
import { all, ApiError, must, str, strArr, uid, type Ctx } from '../core';
import * as M from '../mappers';

/* =================================================================
 *  오개념 목록 (과목별) — legacy Analysis.js 1장
 * ================================================================= */

export async function getMisconceptions({ sb }: Ctx, subject?: unknown) {
  let q = sb.from('misconceptions').select('*').order('name');
  if (str(subject)) q = q.eq('subject', str(subject));
  return must(await q).map(M.misconception);
}

/**
 * 오개념 이름을 바꾸거나 지웠을 때 문제의 선지별 오개념(저장된 이름 · id)을 오개념 목록에 맞춤.
 * 선지에는 id로 연결돼 있어 화면은 바로 바뀌지만, 학생 응답 기록에 남기는 이름도 새 이름이 되도록.
 */
async function syncQuestionMis(ctx: Ctx, subject: string) {
  const [l, q] = await Promise.all([
    ctx.sb.from('misconceptions').select('id, name').eq('subject', subject),
    all((a, b) => ctx.sb.from('questions').select('id, choices, choice_mis_ids, misconceptions').eq('subject', subject).order('id').range(a, b)),
  ]);
  const names = new Map(must(l).map((m) => [m.id, m.name]));
  for (const row of q) {
    const ids = row.choices.map((_, i) => M.splitIds(row.choice_mis_ids[i]).filter((id) => names.has(id)));
    const choice_mis_ids = ids.map(M.joinIds), misconceptions = ids.map((a) => M.joinNames(a.map((id) => names.get(id)!)));
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
    if (same(choice_mis_ids, row.choice_mis_ids.slice(0, row.choices.length)) && same(misconceptions, row.misconceptions.slice(0, row.choices.length))) continue;
    must(await ctx.sb.from('questions').update({ choice_mis_ids, misconceptions }).eq('id', row.id));
  }
}

export async function saveMisconception(ctx: Ctx, m: Partial<M.Misconception>) {
  const rec = {
    subject: str(m?.subject).trim(), name: str(m?.name).trim() || '이름 없는 오개념',
    description: str(m?.desc), concept_ids: strArr(m?.conceptIds),
  };
  if (!rec.subject) throw new ApiError('과목을 먼저 골라 주세요.');
  const before = m?.id ? must(await ctx.sb.from('misconceptions').select('name').eq('id', str(m.id)).maybeSingle()) : null;
  const updated = m?.id ? must(await ctx.sb.from('misconceptions').update(rec).eq('id', str(m.id)).select('id')) : [];
  if (!updated.length) must(await ctx.sb.from('misconceptions').insert({ ...rec, id: uid('m_') }));
  if (before && before.name !== rec.name) await syncQuestionMis(ctx, rec.subject);
  return getMisconceptions(ctx, rec.subject);
}

/** 오개념 삭제 — 이 오개념을 연결한 선지에서도 빠져요 */
export async function deleteMisconception(ctx: Ctx, id: unknown, subject: unknown) {
  const row = must(await ctx.sb.from('misconceptions').delete().eq('id', str(id)).select('subject')).at(0);
  if (row) await syncQuestionMis(ctx, row.subject);
  return getMisconceptions(ctx, subject);
}

/** 여러 줄 붙여넣기:  오개념 이름 | 설명 | 관련 개념1, 관련 개념2 */
export async function importMisconceptions(ctx: Ctx, subjectIn: unknown, text: unknown) {
  const subject = str(subjectIn).trim();
  if (!subject) throw new ApiError('과목을 먼저 골라 주세요.');
  const [n, e] = await Promise.all([
    ctx.sb.from('concepts').select('id, name').eq('subject', subject),
    ctx.sb.from('misconceptions').select('name').eq('subject', subject),
  ]);
  const nodes = must(n), names = new Set(must(e).map((x) => x.name));
  const add: TablesInsert<'misconceptions'>[] = [];
  str(text).split(/\r?\n/).forEach((line) => {
    const p = line.split('|').map((s) => s.trim());
    if (!p[0] || names.has(p[0])) return;
    names.add(p[0]);
    const cids = str(p[2]).split(/[,，]/).map((s) => s.trim()).filter(Boolean)
      .map((name) => nodes.find((c) => c.name === name)?.id ?? '').filter(Boolean);
    add.push({ id: uid('m_'), subject, name: p[0], description: p[1] || '', concept_ids: cids });
  });
  if (add.length) must(await ctx.sb.from('misconceptions').insert(add));
  return { list: await getMisconceptions(ctx, subject), added: add.length };
}
