import 'server-only';
import { ApiError, must, type Ctx } from './core';

/*
 * OpenAI 호출 (legacy Code.js openai_)
 * - 키: Vercel 환경변수 OPENAI_API_KEY (기존: 설정 화면 → Script Properties)
 * - 모델: 교사 설정(teacher_settings.openai_model), 기본 gpt-6-luna
 * - 응답은 JSON 모드로 받아 객체로 돌려줌
 * - OPENAI_BASE_URL 로 다른 주소(시험용 가짜 서버 등)를 쓸 수 있음
 */
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/** 환경변수 키: 앞뒤 공백과, 붙여넣을 때 같이 들어간 글자 그대로의 "
" 을 떼어냄 */
const apiKey = () => String(process.env.OPENAI_API_KEY || '').trim().replace(/(\\[nr])+$/, '').trim();

export const hasOpenAI = () => !!apiKey();

/** 그림 모델 우선순위: 설정한 모델을 못 쓰면 이 키로 쓸 수 있는 모델 중 앞의 것부터 */
const IMAGE_PREFS = ['gpt-image-2.5-sunburst', 'gpt-image-1.5', 'gpt-image-2', 'gpt-image-1', 'gpt-image-1-mini', 'chatgpt-image-latest', 'dall-e-3'];

async function modelOf({ sb }: Ctx) {
  const row = must(await sb.from('teacher_settings').select('openai_model').maybeSingle());
  return row?.openai_model || 'gpt-6-luna';
}

/**
 * 그림 만들기 (OpenAI Images) → 그림 바이트.
 * 모델은 교사 설정(teacher_settings.image_model) → 환경변수 OPENAI_IMAGE_MODEL → 기본 gpt-image-2.5-sunburst.
 * 그 모델을 못 쓰면(없는 모델 · 권한 없음) 이 키의 모델 목록에서 쓸 수 있는 그림 모델을 찾아 한 번 더 시도해요.
 */
export async function openaiImage(prompt: string, model?: string, timeoutMs = 150_000): Promise<{ bytes: Buffer; type: 'image/png'; note?: string }> {
  const key = apiKey();
  if (!key) throw new ApiError('OpenAI API 키가 없어요. Vercel 프로젝트 환경변수 OPENAI_API_KEY 를 설정해 주세요.');
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const first = model || process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-sunburst';
  const started = Date.now();
  const once = async (model: string) => {
    // dall-e 는 quality 값이 다르고 프롬프트 길이 제한이 있음. response_format 은 보내지 않음(지원하지 않는 계정이 있음) → b64_json 이나 url 둘 다 받음
    const body = model.startsWith('dall-e')
      ? { model, prompt: prompt.slice(0, 3800), size: '1024x1024', n: 1 }
      : { model, prompt, size: '1024x1024', quality: 'medium', n: 1 };
    let res: Response;
    try {
      res = await fetch(base + '/images/generations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.max(20_000, timeoutMs - (Date.now() - started))),
      });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new ApiError(timeout ? '그림을 만드는 데 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.' : 'AI 서버에 연결하지 못했어요.', 502);
    }
    const raw = await res.text();
    let data: { error?: { message?: string; code?: string }; data?: { b64_json?: string; url?: string }[] } = {};
    try { data = JSON.parse(raw); } catch { /* 아래에서 처리 */ }
    if (!res.ok) return { ok: false as const, status: res.status, msg: data.error?.message || raw.slice(0, 200) };
    const img = data.data?.[0];
    if (img?.b64_json) return { ok: true as const, bytes: Buffer.from(img.b64_json, 'base64') };
    if (img?.url) return { ok: true as const, bytes: Buffer.from(await (await fetch(img.url)).arrayBuffer()) };
    throw new ApiError('AI가 그림을 돌려주지 않았어요.', 502);
  };
  let r = await once(first);
  let note: string | undefined;
  // 모델을 쓸 권한이 없거나(403 · 조직 인증) 없는 모델(404) · 지원하지 않는 값(400)이면 이 키로 쓸 수 있는 다른 그림 모델로
  if (!r.ok && [400, 403, 404].includes(r.status)) {
    const why = r.msg;
    const next = (await imageModels(base, key)).find((m) => m !== first);
    if (next) {
      r = await once(next);
      if (r.ok) note = `${first} 를 쓸 수 없어 ${next} 로 만들었어요. 설정에서 그림 모델을 ${next} 로 바꾸면 더 빨라요.`;
      else r = { ...r, msg: `${first}: ${why} / ${next}: ${r.msg}` };
    }
  }
  if (!r.ok) throw new ApiError(`OpenAI 이미지 오류(${r.status}): ${r.msg}`, 502);
  return { bytes: r.bytes, type: 'image/png', note };
}

/** 이 키로 쓸 수 있는 그림 모델 (IMAGE_PREFS 순서). 목록을 못 받으면 빈 배열 */
async function imageModels(base: string, key: string): Promise<string[]> {
  try {
    const res = await fetch(base + '/models', { headers: { authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const ids = new Set(((await res.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? []);
    return IMAGE_PREFS.filter((m) => ids.has(m));
  } catch {
    return [];
  }
}

/** model 을 주면 교사 설정 대신 그 모델로 (예: 개념 잇기처럼 판단이 중요한 일) */
export async function openaiJson<T = Record<string, unknown>>(ctx: Ctx, messages: ChatMessage[], timeoutMs = 90_000, model?: string): Promise<T> {
  const key = apiKey();
  if (!key) throw new ApiError('OpenAI API 키가 없어요. Vercel 프로젝트 환경변수 OPENAI_API_KEY 를 설정해 주세요.');
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  let res: Response;
  try {
    res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: model || await modelOf(ctx), messages, response_format: { type: 'json_object' } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new ApiError(timeout ? 'AI 응답이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.' : 'AI 서버에 연결하지 못했어요.', 502);
  }
  const raw = await res.text();
  let data: { error?: { message?: string }; choices?: { message?: { content?: string } }[] } = {};
  try { data = JSON.parse(raw); } catch { /* 아래에서 처리 */ }
  if (!res.ok) throw new ApiError(`OpenAI 오류(${res.status}): ${data.error?.message || raw.slice(0, 200)}`, 502);
  const txt = data.choices?.[0]?.message?.content ?? '';
  try {
    return JSON.parse(txt) as T;
  } catch {
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]) as T; } catch { /* 아래 */ } }
    return { reply: txt, question: null } as T;
  }
}
