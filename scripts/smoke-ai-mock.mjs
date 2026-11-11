#!/usr/bin/env node
/**
 * AI 기능 시험 — 가짜 OpenAI 서버로 (실제 키 · 비용 없이) 응답 처리 확인
 *   1) 이 스크립트가 가짜 OpenAI 서버를 127.0.0.1:3199 에 띄움
 *   2) 앱은 가짜 서버를 보도록 띄움:
 *        OPENAI_API_KEY=test OPENAI_BASE_URL=http://127.0.0.1:3199/v1 npx next start -p 3123
 *   3) npm run smoke:ai-mock -- http://localhost:3123
 * 다루는 것: 출제 챗봇(aiChat · 그림 요청) · 서식 정리(aiFormat) · 빈 선지 만들기(aiChoices) · 그림 만들기(aiImage · dall-e-3 대체)
 *           새 개념의 처음 연결(autoLinkConcepts) · 출제 포인트(examAdvice)
 *           AI가 제안한 선지별 오개념: 목록에 있으면 연결(choiceMis), 없으면 저장할 때 추가할 후보(pendingMis)
 */
import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const BASE = process.argv[2] || 'http://localhost:3123';
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const admin = createClient(URL_, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

/* ---------- 가짜 OpenAI ---------- */
const seen = [];
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const mock = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const j = JSON.parse(body);
  if (req.url.endsWith('/images/generations')) {
    seen.push({ model: j.model, kind: 'image', auth: req.headers.authorization });
    if (j.model === 'gpt-image-1' && j.prompt.includes('NOVERIFY')) {
      res.writeHead(403, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Your organization must be verified to use the model `gpt-image-1`.' } }));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ data: [{ b64_json: PNG }] }));
  }
  const sys = j.messages[0].content, user = j.messages.at(-1).content;
  seen.push({ model: j.model, format: j.response_format?.type, auth: req.headers.authorization, kind: sys.slice(0, 30) });
  const reply = (obj, raw) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: raw ?? JSON.stringify(obj) } }] }));
  };
  if (user.includes('FAIL500')) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: '가짜 서버 오류' } })); }
  if (sys.includes('개념 지도를 정리하는')) {
    const input = JSON.parse(user);
    return reply({ links: input.new.map((n) => ({ id: n.id, to: [input.existing[0].id, 'c_없는id'] })) });
  }
  if (sys.includes('출제를 돕는 조수') && user.includes('그림')) return reply({ reply: '그림을 만들어 넣을게요', image: true, question: null });
  if (sys.includes('출제를 돕는 조수')) {
    const q = { title: '운동 에너지 비교', type: 'mc', stem: '어느 것이 운동 에너지가 큰가?', choices: ['① 가', '② 나', '③ 다', '④ 라'],
      answer: '③', explanation: '½mv²', concepts: ['운동 에너지', '새개념X'], misconceptions: ['속력이 크면 질량도 크다', '오2', '오3(정답자리)', '오4'] };
    const obj = { reply: '문제를 만들었어요', question: user.includes('대화만') ? null : q };
    return reply(obj, user.includes('FENCE') ? '여기요\n```json\n' + JSON.stringify(obj) + '\n```' : undefined);
  }
  if (sys.includes('구조만 정리')) {
    return reply({ reply: 'AI가 정리했어요', question: { title: '벡터량', type: 'mc', stem: '다음 중 벡터량은?', choices: ['질량', '속력', '힘', '시간'], answer: '3, 4', explanation: '힘은 방향이 있다', concepts: ['힘'], misconceptions: ['m1', 'm2', '', 'm4'] } });
  }
  if (sys.includes('오답 선지를 만드는')) {
    const input = JSON.parse(user);
    return reply({ choices: input.targets.map((t) => ({ index: t.index, text: '② AI 선지 ' + t.index + ' (' + t.mis + ')' })).concat([{ index: 0, text: '정답 자리는 무시' }]) });
  }
  if (sys.includes('지필평가 출제')) return reply({ points: ['포인트1', '포인트2', ''], cautions: ['주의1'] });
  reply({});
});
await new Promise((r) => mock.listen(3199, '127.0.0.1', r));

let pass = 0, failN = 0, userId = null;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { failN++; console.log('  ✖ ' + m); } };
const errOf = async (p) => { try { await p; return null; } catch (e) { return e; } };

try {
  const email = `smoke-ai-${Date.now()}@class-tool.test`, password = 'Smoke-' + crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  const jar = new Map();
  const ssr = createServerClient(URL_, PUB, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach((c) => jar.set(c.name, c.value)) } });
  await ssr.auth.signInWithPassword({ email, password });
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const T = async (fn, ...args) => {
    const r = await fetch(BASE + '/api/teacher', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ fn, args }) });
    const j = await r.json(); if (!j.ok) { const e = new Error(j.error); e.status = r.status; throw e; } return j.data;
  };

  const b = await T('bootstrap');
  ok(b.settings.hasKey === true, '설정: 키 있음으로 표시');
  await T('saveSettings', { model: 'gpt-test-model' });
  let cm = await T('loadPreset', '물리', 'phys_mech');
  const ke = cm.nodes.find((n) => n.name === '운동 에너지');
  await T('importMisconceptions', '물리', '속력이 크면 질량도 크다 | | 운동 에너지');

  console.log('[출제 챗봇 aiChat]');
  const c1 = await T('aiChat', [{ role: 'user', content: '운동 에너지 문제 만들어줘' }], '물리');
  const q = c1.question;
  ok(c1.reply === '문제를 만들었어요' && q.type === 'mc', '답변 · 문제 받음');
  ok(q.choices.join() === '가,나,다,라' && q.answer === '3', '보기 앞 번호(①) 제거 · 정답 ③ → 3');
  const known = (await T('getMisconceptions', '물리')).find((m) => m.name === '속력이 크면 질량도 크다');
  ok(q.choiceMis[0].join() === known.id && q.pendingMis[0].length === 0, '목록에 있는 오개념은 바로 연결(choiceMis)');
  ok(q.pendingMis[1].join() === '오2' && q.pendingMis[2].length === 0 && q.choiceMis[2].length === 0, '목록에 없는 오개념은 후보(pendingMis) · 정답 보기는 비움');
  ok(q.conceptIds.includes(ke.id) && q.newConcepts.join() === '새개념X', '아는 개념은 id로, 모르는 개념은 새 개념 후보로');
  const last = seen.at(-1);
  ok(last.model === 'gpt-test-model' && last.format === 'json_object' && last.auth === 'Bearer test', '교사 설정 모델 · JSON 모드 · 키 사용');
  ok((await T('aiChat', [{ role: 'user', content: '대화만 하자' }], '물리')).question === null, '문제 요청이 아니면 question 없음');
  ok((await T('aiChat', [{ role: 'user', content: 'FENCE' }], '물리')).question?.answer === '3', '코드블록으로 감싼 응답도 읽음');
  const e5 = await errOf(T('aiChat', [{ role: 'user', content: 'FAIL500' }], '물리'));
  ok(e5?.status === 502 && e5.message.includes('OpenAI 오류(500)') && e5.message.includes('가짜 서버 오류'), 'OpenAI 오류를 교사에게 안내');

  const ci = await T('aiChat', [{ role: 'user', content: '그림도 만들어줘' }], '물리');
  ok(ci.image === true && ci.question === null, '그림 요청 → image: true');
  ok(c1.image === false, '문제 요청은 image: false');

  console.log('[AI 서식 정리 aiFormat]');
  const f = await T('aiFormat', '다음 중 벡터량은? 질량 속력 힘 시간', '물리');
  ok(f.note === 'AI가 정리했어요' && f.question.answer === '3|4' && f.question.pendingMis[2].length === 0 && f.question.pendingMis[3].length === 0, 'AI로 정리 (키 있을 때) · 정답 여러 개 · 정답 보기 오개념 비움');

  console.log('[저장 · 빈 선지 · 그림]');
  const sq = await T('saveQuestion', { ...q, subject: '물리', title: 'AI 문제' }, '');
  const saved = sq.question;
  ok(saved.choiceMis[0].join() === known.id && saved.choiceMis[1].length === 1 && sq.miscons.some((m) => m.name === '오2'), '저장하면 후보 오개념은 목록에 추가하고 연결');
  ok(saved.conceptIds.length === 2 && sq.concepts.some((c) => c.name === '새개념X'), '새 개념 후보는 개념 지도에 추가');
  const xId = sq.concepts.find((c) => c.name === '새개념X').id;
  let map2 = await T('getConceptMap', '물리');
  ok(map2.links.some((l) => l.to === xId || l.from === xId), '새 개념은 AI가 고른 기존 개념과 처음 연결');
  map2 = await T('saveNode', { subject: '물리', kind: 'concept', unit: '', name: '지도에서 만든 개념', x: 500, y: 500 });
  const nId = map2.nodes.find((n) => n.name === '지도에서 만든 개념').id;
  ok(map2.links.filter((l) => l.to === nId).length === 1, '개념 지도에서 새 개념 → 기존 개념과 연결 (없는 id 는 무시)');
  const filled = await T('aiChoices', { ...saved, choices: ['', saved.choices[1], saved.choices[2], ''] }, [{ index: 0, mis: '속력이 크면 질량도 크다' }, { index: 3, mis: '' }]);
  ok(filled.length === 2 && filled[0].text === 'AI 선지 0 (속력이 크면 질량도 크다)' && filled.every((c) => c.index !== 2), '빈 선지 만들기: 번호 떼고 요청한 자리만');
  const im = await T('aiImage', saved);
  ok(im.url.includes('/question-images/') && seen.some((x) => x.kind === 'image'), '그림 만들기 → 저장소에 올림');
  const im2 = await T('aiImage', { ...saved, stem: 'NOVERIFY ' + saved.stem }, '공 그림으로');
  ok(im2.url && im2.note?.includes('dall-e-3') && seen.at(-1).model === 'dall-e-3', 'gpt-image-1 을 못 쓰면 dall-e-3 로 대신 만듦');
  ok((await errOf(T('aiImage', { ...saved, stem: '' })))?.message.includes('발문'), '발문 없으면 그림 안 만듦');

  console.log('[통계]');
  const fs = await T('getFormativeStats', { subject: '물리' });
  ok(fs.overview && Array.isArray(fs.items), '형성평가 통계 동작');

  console.log('[출제 조언 examAdvice]');
  const plan = await T('recommendExam', { subject: '물리', purpose: 'diagnostic', n: 5 });
  const adv = await T('examAdvice', { purpose: plan.purposeLabel, designPrinciples: plan.design.principles, blueprint: plan.slots });
  ok(adv.points.join() === '포인트1,포인트2' && adv.cautions.join() === '주의1', '출제 포인트 · 주의할 점 (빈 항목 제거)');
} catch (e) {
  failN++;
  console.error('✖ 예외:', e.message);
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId);
  mock.close();
  console.log(`\n결과: ${pass}개 통과, ${failN}개 실패 (가짜 OpenAI 호출 ${seen.length}번, 시험 계정 정리함)`);
  process.exit(failN ? 1 : 0);
}
