import 'server-only';
import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { langOf } from '@/lib/langs';
import { ApiError } from './core';
import { hasOpenAI, openaiJson } from './openai';

/*
 * 학생 화면 문제 번역 (발문 · 선지 · 정답 글)
 *  - OpenAI (이미 있는 OPENAI_API_KEY) — 물리 용어 · 수식 · 단위를 지키라고 지시할 수 있고 새 키가 필요 없어서.
 *  - 같은 글은 translations 표(lang + 원문 sha256)에 저장해 두고 다시 번역하지 않아요.
 *  - 정답 판정은 원문 기준 — 여기 결과는 화면에 보여 주기만 해요.
 *  - 캐시 표를 못 읽거나(마이그레이션 전) 번역에 실패해도 수업은 그대로 — 원문을 돌려줘요.
 */

const MODEL = () => process.env.OPENAI_TRANSLATE_MODEL || 'gpt-6-luna';
/** 한 번에 보내는 글 수 (너무 길면 응답이 느려지고 순서가 어긋나기 쉬움) */
const CHUNK = 25;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
/** 글자(문자)가 없으면 번역할 게 없음 — 숫자 · 기호 · 수식만 */
const needs = (s: string) => /\p{L}/u.test(s);

/** 같은 순간 여러 학생이 같은 문제를 열 때 OpenAI 를 한 번만 부르게 (같은 서버 인스턴스 안에서) */
const pending = new Map<string, Promise<string>>();

/** texts 를 lang 으로 번역 → { 원문: 번역 } (번역이 필요 없거나 실패한 글은 원문 그대로) */
export async function translateTexts(langCode: string, texts: string[]): Promise<Record<string, string>> {
  const lang = langOf(langCode);
  if (!lang) throw new ApiError('지원하지 않는 언어예요.');
  const uniq = [...new Set(texts.map((t) => String(t ?? '')).filter((t) => t.trim()))];
  const out: Record<string, string> = {};
  uniq.forEach((t) => (out[t] = t));
  if (lang.code === 'ko') return out;
  const todo = uniq.filter(needs);
  if (!todo.length) return out;

  const sb = createAdminClient();
  const byHash = new Map(todo.map((t) => [hash(t), t]));
  try {
    const { data, error } = await sb.from('translations').select('src_hash, out').eq('lang', lang.code).in('src_hash', [...byHash.keys()]);
    if (error) throw error;
    for (const r of data ?? []) {
      const src = byHash.get(r.src_hash);
      if (src != null) { out[src] = r.out; byHash.delete(r.src_hash); }
    }
  } catch (e) {
    console.error('[translate] cache read failed', e);
  }
  const miss = [...byHash.values()];
  if (!miss.length || !hasOpenAI()) return out;

  // 이미 다른 요청이 번역 중인 글은 그 결과를 기다리고, 나머지만 새로 번역
  const mine = miss.filter((t) => !pending.has(lang.code + '|' + t));
  for (let i = 0; i < mine.length; i += CHUNK) {
    const part = mine.slice(i, i + CHUNK);
    const job = callOpenAI(lang.en, part).then(async (res) => {
      const rows = part.map((src, k) => ({ lang: lang.code, src_hash: hash(src), src, out: res[k] })).filter((r) => r.out && r.out !== r.src);
      if (rows.length) {
        const { error } = await sb.from('translations').upsert(rows, { onConflict: 'lang,src_hash', ignoreDuplicates: true });
        if (error) console.error('[translate] cache write failed', error);
      }
      return res;
    }).catch((e) => { console.error('[translate] openai failed', e); return part; });
    part.forEach((t, k) => {
      const key = lang.code + '|' + t;
      const p = job.then((res) => res[k] || t).finally(() => pending.delete(key));
      pending.set(key, p);
    });
  }
  const got = await Promise.all(miss.map((t) => pending.get(lang.code + '|' + t) ?? Promise.resolve(t)));
  miss.forEach((t, k) => (out[t] = got[k]));
  return out;
}

async function callOpenAI(langName: string, items: string[]): Promise<string[]> {
  const sys = [
    `You translate Korean secondary-school science (mostly physics) quiz text into ${langName} for a student who is still learning Korean.`,
    'Rules:',
    '- Translate each item independently and faithfully. Use the standard school-level science terms of the target language.',
    '- Keep numbers, units (m/s, N, kg, J …), variables, formulas, chemical symbols, LaTeX, HTML tags, markers like ①②㉠㉡(가)(나) and line breaks exactly as they are.',
    '- Do not solve, explain, add hints or indicate which choice is correct. Do not add quotation marks.',
    '- If an item is a proper noun or has no meaning to translate, return it unchanged.',
    `Return JSON {"t": [...]} with exactly ${items.length} strings in the same order as the input.`,
  ].join('\n');
  const r = await openaiJson<{ t?: unknown }>(null, [
    { role: 'system', content: sys },
    { role: 'user', content: JSON.stringify({ items }) },
  ], 60_000, MODEL());
  const t = Array.isArray(r.t) ? r.t.map((x) => (typeof x === 'string' ? x : '')) : [];
  if (t.length !== items.length) throw new Error(`translation count mismatch ${t.length}/${items.length}`);
  return t;
}
