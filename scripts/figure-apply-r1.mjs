#!/usr/bin/env node
/**
 * 고친 문항 그림(public/sample/*-r1.svg)을 교사 계정 문항에 적용
 *   node --env-file=.env.local scripts/figure-apply-r1.mjs --email 교사@이메일            # 한 계정
 *   node --env-file=.env.local scripts/figure-apply-r1.mjs --all                         # 모든 교사 계정
 *   ... --revert                                                                         # 원래 그림으로
 * questions.image_url · choice_images 에서 '-r1' 판이 있는 그림 주소만 바꿔요 (다른 내용 · 분석 기록은 그대로).
 * 새 계정은 seed/physics-items.json 이 이미 '-r1' 그림을 가리켜요.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const { values: opt } = parseArgs({ options: { email: { type: 'string' }, all: { type: 'boolean', default: false }, revert: { type: 'boolean', default: false } } });
if (!opt.email && !opt.all) { console.error('--email 또는 --all 을 지정해 주세요.'); process.exit(1); }
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const swap = (u) => {
  if (!u || !u.startsWith('/sample/')) return u;
  if (opt.revert) return u.replace(/-r1\.svg$/, '.svg');
  const r1 = u.replace(/(?<!-r1)\.svg$/, '-r1.svg');
  return r1 !== u && existsSync(path.join(DIR, r1)) ? r1 : u;
};

const { data: us, error: ue } = await a.auth.admin.listUsers({ perPage: 1000 });
if (ue) throw ue;
const users = opt.all ? us.users : us.users.filter((x) => (x.email || '').toLowerCase() === opt.email.toLowerCase());
if (!users.length) { console.error('계정이 없어요: ' + opt.email); process.exit(1); }
let total = 0;
for (const u of users) {
  const qs = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await a.from('questions').select('id, sample_key, image_url, choice_images').eq('owner_id', u.id).order('id').range(from, from + 999);
    if (error) throw error;
    qs.push(...data);
    if (data.length < 1000) break;
  }
  let n = 0;
  for (const q of qs) {
    const image_url = swap(q.image_url), choice_images = (q.choice_images || []).map(swap);
    if (image_url === q.image_url && JSON.stringify(choice_images) === JSON.stringify(q.choice_images || [])) continue;
    const r = await a.from('questions').update({ image_url, choice_images }).eq('id', q.id);
    if (r.error) throw r.error;
    n++;
  }
  total += n;
  const e = u.email || u.id;
  console.log(`${e.replace(/^(..)[^@]*/, '$1***')}: 문항 ${n}개 ${opt.revert ? '되돌림' : '적용'} (전체 문항 ${qs.length}개)`);
}
console.log(`합계 ${total}개`);
