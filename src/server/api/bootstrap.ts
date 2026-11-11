import 'server-only';
import { must, today, uid, type Ctx } from '../core';
import * as M from '../mappers';
import { bank } from './bank';
import { classesMeta } from './classes';
import { getMisconceptions } from './misconceptions';
import { hasOpenAI } from '../openai';
import { homerooms } from './roster';
import { SAMPLE_PROVISIONAL, SAMPLE_VERSION, seedSample } from './sample';

/* =================================================================
 *  처음 접속한 교사의 기본 데이터 (legacy ensure_)
 * ================================================================= */
const HOLIDAYS_2026: [string, string][] = [
  ['2026-01-01', '신정'], ['2026-02-16', '설날 연휴'], ['2026-02-17', '설날'], ['2026-02-18', '설날 연휴'],
  ['2026-03-01', '삼일절'], ['2026-03-02', '대체공휴일'], ['2026-05-05', '어린이날'], ['2026-05-24', '부처님오신날'],
  ['2026-05-25', '대체공휴일'], ['2026-06-03', '지방선거'], ['2026-06-06', '현충일'], ['2026-08-15', '광복절'],
  ['2026-08-17', '대체공휴일'], ['2026-09-24', '추석 연휴'], ['2026-09-25', '추석'], ['2026-09-26', '추석 연휴'],
  ['2026-10-03', '개천절'], ['2026-10-05', '대체공휴일'], ['2026-10-09', '한글날'], ['2026-12-25', '성탄절'],
];

/**
 * teacher_settings 행이 처음 생길 때 한 번만 기본 학기·공휴일을 넣음 (문항 세트는 ensureSample).
 * (insert … on conflict do nothing 으로 동시에 여러 번 불려도 한 번만 실행)
 */
async function ensureSeed({ sb, uid: owner }: Ctx) {
  const created = must(await sb.from('teacher_settings')
    .upsert({ owner_id: owner }, { onConflict: 'owner_id', ignoreDuplicates: true }).select());
  if (!created.length) return;
  const [sem, hol] = await Promise.all([
    sb.from('semesters').select('id', { count: 'exact', head: true }),
    sb.from('holidays').select('date', { count: 'exact', head: true }),
  ]);
  if (!sem.count) {
    must(await sb.from('semesters').insert([
      { id: uid('s_'), name: '2026년 1학기', start_date: '2026-03-02', end_date: '2026-07-17' },
      { id: uid('s_'), name: '2026년 2학기', start_date: '2026-08-18', end_date: '2026-12-31' },
    ]));
  }
  if (!hol.count) must(await sb.from('holidays').insert(HOLIDAYS_2026.map(([date, name]) => ({ date, name }))));
}

/**
 * 기본 문항 세트를 교사마다 맞춤 (새 계정 · 예전 세트를 받은 계정). sample_version 을 먼저 올려
 * 동시에 두 번 들어가지 않게 하고, 실패하면 되돌려 다음 접속 때 다시 해요.
 * 임시 세트(최종 계정에서 아직 내보내기 전)일 때는 새 계정에만 넣고, 이미 세트가 있는 계정은 건드리지 않아요.
 */
async function ensureSample(ctx: Ctx) {
  const row = must(await ctx.sb.from('teacher_settings').select('sample_version, sample_seeded').eq('owner_id', ctx.uid).maybeSingle());
  const was = row?.sample_version ?? 0, seeded = !!row?.sample_seeded;
  if (!row || was >= SAMPLE_VERSION || (SAMPLE_PROVISIONAL && seeded)) return;
  const claimed = must(await ctx.sb.from('teacher_settings').update({ sample_version: SAMPLE_VERSION, sample_seeded: true })
    .eq('owner_id', ctx.uid).eq('sample_version', was).select('owner_id'));
  if (!claimed.length) return;
  try {
    await seedSample(ctx);
  } catch (e) {
    await ctx.sb.from('teacher_settings').update({ sample_version: was, sample_seeded: seeded }).eq('owner_id', ctx.uid);
    throw e;
  }
}

export async function settings({ sb }: Ctx) {
  const row = must(await sb.from('teacher_settings').select('openai_model, image_model').maybeSingle());
  return { hasKey: hasOpenAI(), model: row?.openai_model || 'gpt-4o-mini', imageModel: row?.image_model || 'gpt-image-1.5' };
}

export async function conceptsLite({ sb }: Ctx) {
  return must(await sb.from('concepts').select('id, subject, kind, unit, name').order('name'));
}

/** 교사 화면을 처음 열 때 필요한 데이터 전부 */
export async function bootstrap(ctx: Ctx) {
  await ensureSeed(ctx);
  await ensureSample(ctx);
  const [b, classes, sems, hols, concepts, st, miscons, hrs] = await Promise.all([
    bank(ctx), classesMeta(ctx),
    ctx.sb.from('semesters').select('*').order('start_date'),
    ctx.sb.from('holidays').select('*').order('date'),
    conceptsLite(ctx), settings(ctx), getMisconceptions(ctx), homerooms(ctx),
  ]);
  return {
    folders: b.folders, questions: b.questions, classes, miscons, homerooms: hrs,
    semesters: must(sems).map(M.semester), holidays: must(hols).map(M.holiday),
    concepts, settings: st, today: today(), appUrl: ctx.origin,
  };
}
