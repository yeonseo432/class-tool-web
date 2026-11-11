import 'server-only';
import type { TablesInsert } from '@/lib/database.types';
import { all, allIn, ApiError, must, str, uid, type Ctx } from '../core';
import * as M from '../mappers';
import { hasOpenAI, openaiJson } from '../openai';
import { classesMeta } from './classes';

/* =================================================================
 *  통계 · 개념지도 — legacy Code.js
 * ================================================================= */

type Stat = { n: number; c: number; mis: Record<string, number>; qs: Record<string, { n: number; c: number }> };

export async function getConceptMap(ctx: Ctx, subjectIn: unknown, classIdIn?: unknown) {
  const { sb } = ctx;
  const subject = str(subjectIn), classId = str(classIdIn);
  const [n, l, qs, cls] = await Promise.all([
    sb.from('concepts').select('*').eq('subject', subject),
    sb.from('links').select('*').eq('subject', subject),
    all((a, b) => sb.from('questions').select('id, title, concept_ids').order('id').range(a, b)),
    classesMeta(ctx),
  ]);
  const nodes = must(n).map(M.concept);
  // 이 과목 개념이 붙은 응답만 (반을 고르면 그 반 차시의 응답만) DB에서 가져옴
  const nodeIds = nodes.map((x) => x.id);
  const cols = 'lesson_id, question_id, correct, misconception, concept_ids';
  let resp: { lesson_id: string; question_id: string; correct: boolean; misconception: string; concept_ids: string[] }[] = [];
  // 개념이 아주 많으면(주소 길이 제한) 개념 거르기는 서버에서
  const ov = nodeIds.length <= 200 ? nodeIds : null;
  const base = () => { const q = sb.from('responses').select(cols); return ov ? q.overlaps('concept_ids', ov) : q; };
  if (nodeIds.length && classId) {
    const lids = must(await sb.from('lessons').select('id').eq('class_id', classId)).map((x) => x.id);
    resp = await allIn(lids, (ids, a, b) => base().in('lesson_id', ids).order('id').range(a, b));
  } else if (nodeIds.length) {
    resp = await all((a, b) => base().order('id').range(a, b));
  }

  const st: Record<string, Stat> = {};
  nodes.forEach((x) => (st[x.id] = { n: 0, c: 0, mis: {}, qs: {} }));
  qs.forEach((x) => x.concept_ids.forEach((cid) => { if (st[cid]) st[cid].qs[x.id] ??= { n: 0, c: 0 }; }));
  resp.forEach((r) => {
    r.concept_ids.forEach((cid) => {
      const s = st[cid];
      if (!s) return;
      s.n++;
      if (r.correct) s.c++;
      else M.splitNames(r.misconception).forEach((t) => (s.mis[t] = (s.mis[t] || 0) + 1));
      const x = (s.qs[r.question_id] ??= { n: 0, c: 0 });
      x.n++;
      if (r.correct) x.c++;
    });
  });
  const titles = new Map(qs.map((x) => [x.id, x.title]));
  return {
    subject,
    classes: cls.filter((c) => c.subject === subject).map((c) => ({ id: c.id, name: c.name, semesterName: c.semesterName })),
    links: must(l).map(M.link),
    nodes: nodes.map((x) => {
      const s = st[x.id];
      return {
        ...x,
        stat: {
          n: s.n, c: s.c, rate: s.n ? s.c / s.n : null,
          mis: Object.entries(s.mis).map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count).slice(0, 8),
          qs: Object.entries(s.qs).map(([id, v]) => ({ id, title: titles.get(id) ?? '(삭제된 문제)', n: v.n, rate: v.n ? v.c / v.n : null })),
        },
      };
    }),
  };
}

export async function saveNode(ctx: Ctx, node: Partial<M.Concept> & { classId?: string }) {
  const rec = {
    subject: str(node?.subject), kind: node?.kind === 'unit' ? 'unit' : 'concept', unit: str(node?.unit).trim(), name: str(node?.name).trim() || '새 개념',
    x: Math.round(Number(node?.x) || 200), y: Math.round(Number(node?.y) || 200), description: str(node?.desc),
  };
  const updated = node?.id ? must(await ctx.sb.from('concepts').update(rec).eq('id', str(node.id)).select('id')) : [];
  if (!updated.length) {
    const id = uid('c_');
    must(await ctx.sb.from('concepts').insert({ ...rec, id }));
    if (rec.kind === 'concept') await autoLinkConcepts(ctx, rec.subject, [id]);   // 새 개념: 관련 있는 기존 개념과 처음 연결
  }
  return getConceptMap(ctx, rec.subject, node?.classId ?? '');
}

/**
 * 새로 만든 개념을 개념 지도의 기존 개념과 처음 연결 (개념 지도에서 추가 · 문제 저장 때 새 개념).
 *  - 단원이 정해져 있고 그 이름의 단원 노드가 있으면 단원 → 개념
 *  - OpenAI 키가 있으면 같은 과목의 기존 개념 중 직접 관련된 개념(선수 · 상위 · 함께 쓰이는 개념) 1~3개와 연결
 * 연결에 실패해도 개념 저장은 그대로 (교사가 개념 지도에서 직접 이을 수 있어요).
 */
export async function autoLinkConcepts(ctx: Ctx, subject: string, newIds: string[]) {
  if (!subject || !newIds.length) return;
  const nodes = must(await ctx.sb.from('concepts').select('id, name, kind, unit').eq('subject', subject));
  const fresh = nodes.filter((n) => newIds.includes(n.id) && n.kind !== 'unit');
  if (!fresh.length) return;
  const pairs: [string, string][] = [];
  for (const n of fresh) {
    const u = n.unit && nodes.find((x) => x.kind === 'unit' && x.name === n.unit);
    if (u) pairs.push([u.id, n.id]);
  }
  const old = nodes.filter((n) => !newIds.includes(n.id) && n.kind !== 'unit');
  if (hasOpenAI() && old.length) {
    try {
      const r = await openaiJson<{ links?: { id?: unknown; to?: unknown }[] }>(ctx, [
        { role: 'system', content: '너는 과학 교사의 개념 지도를 정리하는 도우미야. 새 개념(new)마다 기존 개념(existing) 중에서 ' +
          '학습 순서나 내용상 직접 관련된 개념(선수 개념 · 상위 개념 · 같은 현상을 설명하는 개념) 1~3개를 골라. 관련 있는 것이 없으면 빈 배열. ' +
          '반드시 기존 개념의 id 만 써. JSON 하나로만 답해. 형식: {"links":[{"id":"새 개념 id","to":["기존 개념 id"]}]}' },
        { role: 'user', content: JSON.stringify({
          subject,
          new: fresh.map((n) => ({ id: n.id, name: n.name, unit: n.unit })),
          existing: old.slice(0, 400).map((n) => ({ id: n.id, name: n.name, unit: n.unit })),
        }) },
      ], 30_000);
      const ok = new Set(old.map((n) => n.id));
      for (const l of Array.isArray(r.links) ? r.links : []) {
        const id = str(l?.id);
        if (!fresh.some((n) => n.id === id)) continue;
        (Array.isArray(l?.to) ? l.to : []).map(str).filter((t) => ok.has(t)).slice(0, 3).forEach((t) => pairs.push([t, id]));
      }
    } catch (e) {
      console.warn('[autoLinkConcepts] AI 연결 실패', e instanceof Error ? e.message : e);
    }
  }
  if (!pairs.length) return;
  const exist = must(await ctx.sb.from('links').select('from_id, to_id').eq('subject', subject));
  const has = (a: string, b: string) => [...exist, ...add].some((l) => (l.from_id === a && l.to_id === b) || (l.from_id === b && l.to_id === a));
  const add: TablesInsert<'links'>[] = [];
  for (const [a, b] of pairs) if (a !== b && !has(a, b)) add.push({ id: uid('e_'), subject, from_id: a, to_id: b });
  if (add.length) must(await ctx.sb.from('links').insert(add));
}

/** 개념 삭제 — 연결선은 on delete cascade */
export async function deleteNode(ctx: Ctx, id: unknown, subject: unknown) {
  must(await ctx.sb.from('concepts').delete().eq('id', str(id)));
  return getConceptMap(ctx, subject, '');
}

export async function savePositions(ctx: Ctx, list: { id: string; x: number; y: number }[]) {
  const pos = new Map((Array.isArray(list) ? list : []).map((p) => [str(p.id), p]));
  if (!pos.size) return true;
  const rows = must(await ctx.sb.from('concepts').select('*').in('id', [...pos.keys()]));
  const upd = rows.map((r) => ({ ...r, x: Math.round(Number(pos.get(r.id)!.x) || r.x), y: Math.round(Number(pos.get(r.id)!.y) || r.y) }));
  if (upd.length) must(await ctx.sb.from('concepts').upsert(upd));
  return true;
}

const subjectLinks = async ({ sb }: Ctx, subject: string) =>
  ({ links: must(await sb.from('links').select('*').eq('subject', subject)).map(M.link) });

export async function addLink(ctx: Ctx, subjectIn: unknown, fromIn: unknown, toIn: unknown) {
  const subject = str(subjectIn), from = str(fromIn), to = str(toIn);
  // .or() 필터 문자열에 그대로 들어가므로 id 형식을 먼저 확인
  if (![from, to].every((x) => /^[\w-]+$/.test(x))) throw new ApiError('개념을 다시 선택해 주세요.');
  if (from !== to) {
    const dup = must(await ctx.sb.from('links').select('id')
      .or(`and(from_id.eq.${from},to_id.eq.${to}),and(from_id.eq.${to},to_id.eq.${from})`));
    if (!dup.length) must(await ctx.sb.from('links').insert({ id: uid('e_'), subject, from_id: from, to_id: to }));
  }
  return subjectLinks(ctx, subject);
}

export async function deleteLink(ctx: Ctx, id: unknown, subject: unknown) {
  must(await ctx.sb.from('links').delete().eq('id', str(id)));
  return subjectLinks(ctx, str(subject));
}

/**
 * AI로 개념 잇기: 과목의 모든 개념을 보고, 서로 관련 있는 개념끼리 관련 정도(0~1)와 함께 이어요.
 * - 개념을 몇 개씩 나눠, 개념마다 "가장 관련 깊은 개념"을 따로 물어요 → 모든 개념이 최소 1개는 이어짐
 * - 단원 이름이 같다는 이유만으로 잇지 않고, 내용상 직접 관련된(선수 · 같은 현상 · 함께 쓰는) 개념만
 * - 단원이 정해진 개념과 단원이 없는 개념(예전에 다른 과목 예시로 들어온 노드 등)은 서로 잇지 않음
 * - 판단이 중요해서 교사 설정의 글 모델 대신 OPENAI_LINK_MODEL(기본 gpt-4o)로, 쓸 수 없으면 교사 설정 모델로
 * - 예전에 AI가 이은 선(weight 있음)은 지우고 새로 이어요. 교사가 직접 이은 선(weight 없음)과 단원 → 개념 선은 그대로
 */
export async function aiLinkConcepts(ctx: Ctx, subjectIn: unknown) {
  const subject = str(subjectIn);
  if (!hasOpenAI()) throw new ApiError('OpenAI API 키가 없어요. Vercel 환경변수 OPENAI_API_KEY 를 설정해 주세요.');
  const nodes = must(await ctx.sb.from('concepts').select('id, name, kind, unit, description').eq('subject', subject));
  const cons = nodes.filter((n) => n.kind !== 'unit');
  if (cons.length < 2) throw new ApiError('이을 개념이 2개 이상 있어야 해요.');
  if (cons.length > 250) throw new ApiError('개념이 너무 많아요 (250개 이하). 필요 없는 개념을 정리한 뒤 다시 해 주세요.');
  const unitNames = new Set(nodes.filter((n) => n.kind === 'unit').map((n) => n.name));
  const hasUnit = (n: (typeof cons)[number]) => !!n.unit && (unitNames.has(n.unit) || !unitNames.size);
  // 단원이 있는 개념끼리 · 없는 개념끼리 따로 (한 무리가 1개뿐이면 이을 상대가 없으니 건너뜀)
  const pools = [cons.filter(hasUnit), cons.filter((n) => !hasUnit(n))].filter((x) => x.length >= 2);
  const pairs = new Map<string, { a: string; b: string; w: number }>();
  const add1 = (a: string, b: string, w: number) => {
    if (!a || !b || a === b || !(w > 0)) return;
    const k = a < b ? a + '|' + b : b + '|' + a;
    if (!pairs.has(k) || pairs.get(k)!.w < w) pairs.set(k, { a, b, w });
  };
  const sys = '너는 과학 교육과정 전문가야. 개념 목록(concepts)과 이번에 볼 개념 번호(targets)가 주어져. ' +
    'targets 의 개념마다, 목록 전체에서 내용상 가장 직접 관련된 개념을 2~4개 골라 관련 정도 w(0~1)와 함께 알려 줘. 관련 있는 개념이 하나뿐이면 1개도 괜찮지만, 최소 1개는 꼭 골라. ' +
    'w 기준: 0.85~1 = 한 개념을 알아야 다른 개념을 이해할 수 있음(선수 관계) 또는 같은 법칙 · 현상을 다룸, 0.6~0.8 = 함께 자주 쓰이거나 서로 비교 · 연결해 배움, 0.3~0.5 = 약하게 관련됨. ' +
    '단원이 같다는 이유만으로 고르지 말고, 단원이 달라도 관련 있으면 골라. 이름이 비슷해도 실제 내용이 관련 없으면 고르지 마. ' +
    '번호(n)만 써. JSON 하나로만 답해. 형식: {"links":[{"from":1,"to":5,"w":0.8}]}';
  const linkModel = process.env.OPENAI_LINK_MODEL || 'gpt-4o';
  let model: string | undefined = linkModel;
  const ask = async (pool: typeof cons, targets: number[]) => {
    const body: { role: 'system' | 'user'; content: string }[] = [
      { role: 'system', content: sys },
      { role: 'user', content: JSON.stringify({ subject, concepts: pool.map((n, i) => ({ n: i + 1, name: n.name, unit: n.unit, desc: (n.description || '').slice(0, 80) })), targets }) },
    ];
    try {
      return await openaiJson<{ links?: { from?: unknown; to?: unknown; w?: unknown }[] }>(ctx, body, 90_000, model);
    } catch (e) {
      if (!model || !(e instanceof ApiError) || !/\((400|403|404)\)/.test(e.message)) throw e;
      model = undefined;   // 이 모델을 쓸 수 없는 키 → 교사 설정 모델로
      return await openaiJson<{ links?: { from?: unknown; to?: unknown; w?: unknown }[] }>(ctx, body, 90_000);
    }
  };
  for (const pool of pools) {
    const nums = pool.map((_, i) => i + 1);
    const chunks: number[][] = [];
    for (let i = 0; i < nums.length; i += 12) chunks.push(nums.slice(i, i + 12));
    // 한 번에 4묶음씩 동시에
    for (let i = 0; i < chunks.length; i += 4) {
      const rs = await Promise.all(chunks.slice(i, i + 4).map((c) => ask(pool, c)));
      for (const r of rs) for (const l of Array.isArray(r.links) ? r.links : []) {
        const a = pool[Number(l?.from) - 1], b = pool[Number(l?.to) - 1];
        if (a && b) add1(a.id, b.id, Math.round(Math.min(1, Math.max(0, Number(l?.w) || 0)) * 100) / 100);
      }
    }
  }
  const rows = must(await ctx.sb.from('links').select('id, from_id, to_id, weight').eq('subject', subject));
  // 한 번 더: 아직 아무 개념과도 이어지지 않은 개념만 다시 물음 (AI가 가끔 몇 개를 빠뜨려요)
  const linked = (id: string) => [...pairs.values()].some((p) => p.a === id || p.b === id) ||
    rows.some((l) => l.weight == null && cons.some((c) => c.id === (l.from_id === id ? l.to_id : l.to_id === id ? l.from_id : '')));
  for (const pool of pools) {
    const miss = pool.map((n, i) => (linked(n.id) ? 0 : i + 1)).filter(Boolean);
    if (!miss.length) continue;
    const r = await ask(pool, miss);
    for (const l of Array.isArray(r.links) ? r.links : []) {
      const a = pool[Number(l?.from) - 1], b = pool[Number(l?.to) - 1];
      if (a && b) add1(a.id, b.id, Math.round(Math.min(1, Math.max(0.3, Number(l?.w) || 0.3)) * 100) / 100);
    }
  }
  if (!pairs.size) throw new ApiError('AI가 연결할 개념 쌍을 찾지 못했어요. 잠시 후 다시 해 주세요.');
  const ids = new Set(cons.map((n) => n.id));
  const oldAi = rows.filter((l) => l.weight != null && ids.has(l.from_id) && ids.has(l.to_id)).map((l) => l.id);
  if (oldAi.length) must(await ctx.sb.from('links').delete().in('id', oldAi));
  const keep = rows.filter((l) => !oldAi.includes(l.id));
  const add: TablesInsert<'links'>[] = [];
  for (const p of pairs.values()) {   // 교사가 이미 이은 쌍은 그대로 둠 (다음에 AI로 다시 이어도 지워지지 않게)
    const manual = keep.find((l) => (l.from_id === p.a && l.to_id === p.b) || (l.from_id === p.b && l.to_id === p.a));
    if (!manual) add.push({ id: uid('e_'), subject, from_id: p.a, to_id: p.b, weight: p.w });
  }
  if (add.length) must(await ctx.sb.from('links').insert(add));
  return { ...(await subjectLinks(ctx, subject)), added: add.length, removed: oldAi.length };
}
