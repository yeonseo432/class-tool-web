/*********************************************************************
 * 형성평가 분석 · 오개념 통계 · 지필고사 출제 추천
 * ------------------------------------------------------------------
 *  1) 문항 사전 분석 : 문제를 저장하면 OpenAI가 [개념 지도 + 오개념 목록]을
 *     바탕으로 다루는 개념 / 개념 간 연결 / 선지별 오개념을 미리 태깅
 *  2) 형성평가 통계 : 학생 응답을 사전 태깅에 맞춰 집계 (AI 호출 없음)
 *  3) 출제 추천     : 시험 목적 + 문항 수 → 문항 구성표 · 배점 · 후보 문항
 *********************************************************************/

/* =================================================================
 *  0. 공통
 * ================================================================= */
const LEVELS = {
  easy:  { key: 'easy',  label: '쉬움',       p: 0.8 },
  mid:   { key: 'mid',   label: '보통',       p: 0.6 },
  hard:  { key: 'hard',  label: '어려움',     p: 0.4 },
  xhard: { key: 'xhard', label: '매우 어려움', p: 0.25 }
};
const MASTERY_CUT = 0.7;   // 학생이 개념을 '숙달'했다고 보는 정답률

/** 새 시트(Misconceptions)·새 열(Questions.analysis)의 머리글을 맞춤 (버전당 1회) */
function syncHeaders_() {
  const ver = 'a1';
  if (PROPS.getProperty('HDR_VER') === ver) return;
  Object.keys(SHEETS).forEach(function (name) {
    const sh = sheet_(name), h = SHEETS[name];
    const cur = sh.getRange(1, 1, 1, h.length).getValues()[0];
    if (cur.join('\u0001') !== h.join('\u0001')) {
      sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#e8eefc');
    }
  });
  PROPS.setProperty('HDR_VER', ver);
}

function sig_(x) { return 1 / (1 + Math.exp(-x)); }
function logit_(p) { p = Math.min(0.97, Math.max(0.03, p)); return Math.log(p / (1 - p)); }
function mean_(a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : null; }
function sd_(a) {
  if (a.length < 2) return null;
  const m = mean_(a);
  return Math.sqrt(a.reduce(function (s, v) { return s + (v - m) * (v - m); }, 0) / (a.length - 1));
}
function pearson_(x, y) {
  const n = x.length, mx = mean_(x), my = mean_(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) * (x[i] - mx); syy += (y[i] - my) * (y[i] - my); }
  return (sxx && syy) ? sxy / Math.sqrt(sxx * syy) : null;
}
/** 비율의 95% 신뢰구간 (Wilson) */
function wilson_(x, n) {
  if (!n) return null;
  const z = 1.96, p = x / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}
function normCdf_(x) {   // Abramowitz-Stegun 근사
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
/** 최대 잔여법(Hamilton): 정수 total을 가중치에 비례해 나눔. mins = 항목별 최소값 */
function hamilton_(weights, total, mins) {
  const n = weights.length, out = [];
  for (let i = 0; i < n; i++) out.push(mins ? mins[i] : 0);
  if (!n) return out;
  const rest = total - out.reduce(function (s, v) { return s + v; }, 0);
  if (rest <= 0) return out;
  const sum = weights.reduce(function (s, v) { return s + Math.max(0, v); }, 0);
  const raw = weights.map(function (w) { return (sum > 0 ? Math.max(0, w) / sum : 1 / n) * rest; });
  raw.forEach(function (r, i) { out[i] += Math.floor(r); });
  let left = total - out.reduce(function (s, v) { return s + v; }, 0);
  const order = raw.map(function (r, i) { return i; })
    .sort(function (a, b) { return (raw[b] - Math.floor(raw[b])) - (raw[a] - Math.floor(raw[a])) || weights[b] - weights[a]; });
  for (let k = 0; left > 0; k++, left--) out[order[k % n]]++;
  return out;
}
function uniqIds_(arr, ok) {
  return (Array.isArray(arr) ? arr : []).map(String)
    .filter(function (v, i, a) { return ok[v] && a.indexOf(v) === i; });
}

/* ---------- 문항의 사전 분석 정보 읽기 ---------- */
function qAnalysis_(q) {
  const a = q && q.analysis;
  return (a && typeof a === 'object' && !Array.isArray(a)) ? a : null;
}
/** 교사가 지정한 개념 + AI가 찾은 개념 */
function qConcepts_(q) {
  const a = qAnalysis_(q);
  return (q.conceptIds || []).concat(a ? a.conceptIds || [] : [])
    .filter(function (v, i, arr) { return v && arr.indexOf(v) === i; });
}
/** 선지 번호(1부터)를 고르면 드러나는 오개념 키 목록.
 *  사전 분석이 없으면 교사가 적은 선지별 오개념 문장('t:문장')을 대신 사용 */
function choiceMis_(q, no) {
  const a = qAnalysis_(q);
  const c = a && a.choices && a.choices[no - 1];
  if (c && c.misIds && c.misIds.length) return c.misIds.slice();
  const t = String((q.misconceptions || [])[no - 1] || '').trim();
  return t ? ['t:' + t] : [];
}
function normAns_(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase(); }
function shortMis_(q, ans) {
  const a = qAnalysis_(q);
  const n = normAns_(ans);
  const hit = ((a && a.shortPatterns) || []).filter(function (s) { return normAns_(s.pattern) === n; })[0];
  return hit ? (hit.misIds || []).slice() : [];
}

/* =================================================================
 *  1. 오개념 목록 (과목별)
 * ================================================================= */
function getMisconceptions_(subject) {
  return cleanAll_(rows_('Misconceptions').filter(function (m) { return !subject || m.subject === subject; }));
}
function saveMisconception_(m) {
  m = m || {};
  const rec = {
    subject: String(m.subject || '').trim(),
    name: String(m.name || '').trim() || '이름 없는 오개념',
    desc: String(m.desc || ''),
    conceptIds: (m.conceptIds || []).map(String)
  };
  if (!rec.subject) throw new Error('과목을 먼저 골라 주세요.');
  if (m.id && getById_('Misconceptions', m.id)) update_('Misconceptions', m.id, rec);
  else { rec.id = uid_('m_'); insert_('Misconceptions', rec); }
  return getMisconceptions_(rec.subject);
}
function deleteMisconception_(id, subject) {
  writeAll_('Misconceptions', rows_('Misconceptions').filter(function (m) { return m.id !== id; }));
  return getMisconceptions_(subject);
}
/** 여러 줄 붙여넣기:  오개념 이름 | 설명 | 관련 개념1, 관련 개념2 */
function importMisconceptions_(subject, text) {
  subject = String(subject || '').trim();
  if (!subject) throw new Error('과목을 먼저 골라 주세요.');
  const nodes = rows_('Concepts').filter(function (c) { return c.subject === subject; });
  const exist = rows_('Misconceptions').filter(function (m) { return m.subject === subject; });
  const add = [];
  String(text || '').split(/\r?\n/).forEach(function (line) {
    const p = line.split('|').map(function (s) { return s.trim(); });
    if (!p[0] || exist.some(function (m) { return m.name === p[0]; })) return;
    const cids = String(p[2] || '').split(/[,，]/).map(function (s) { return s.trim(); }).filter(String)
      .map(function (n) { const hit = nodes.filter(function (c) { return c.name === n; })[0]; return hit ? hit.id : ''; })
      .filter(String);
    add.push({ id: uid_('m_'), subject: subject, name: p[0], desc: p[1] || '', conceptIds: cids });
  });
  insertMany_('Misconceptions', add);
  return { list: getMisconceptions_(subject), added: add.length };
}

/* =================================================================
 *  2. 문항 사전 분석 (OpenAI)  — 프롬프트는 나중에 튜닝
 * ================================================================= */
const ANALYZE_PROMPT = [
  '너는 과학 교과 형성평가 문항을 분석하는 교육평가 전문가야.',
  '입력으로 개념 지도(concepts, links), 오개념 목록(misconceptions), 문항(question)이 JSON으로 주어져.',
  '반드시 입력 목록에 있는 id만 사용하고 새 id를 만들지 마. 해당하는 것이 없으면 빈 배열로 둬.',
  '분석할 것:',
  '1) conceptIds: 이 문항을 풀 때 필요한 개념 (핵심 개념 먼저, 최대 4개)',
  '2) linkIds: 이 문항이 확인하는 개념 간 연결 (두 개념을 관련지어야만 풀 수 있을 때만)',
  '3) choices: 객관식이면 모든 선지마다 {"no":선지번호,"misIds":[이 선지를 고르게 만드는 오개념 id],"note":"이 선지를 고른 학생의 생각 한 문장"}. 정답 선지는 misIds를 비워.',
  '4) shortPatterns: 단답형이면 학생이 쓸 법한 대표 오답과 그 오개념 [{"pattern":"오답","misIds":[]}] (최대 5개)',
  '5) level: 인지 수준 (기억/이해/적용/분석/평가 중 하나)',
  '6) difficulty: 고등학생 기준 예상 정답률 (0~1 소수)',
  '7) summary: 이 문항이 무엇을 확인하는지 한 문장',
  '8) suggestions: 목록에 없지만 추가하면 좋을 개념/오개념 이름 (최대 3개, 없으면 빈 배열)',
  '형식: {"conceptIds":[],"linkIds":[],"choices":[],"shortPatterns":[],"level":"","difficulty":0.6,"summary":"","suggestions":[]}',
  '반드시 JSON 객체 하나로만 답해.'
].join('\n');

function analyzeQuestion_(id) {
  const q = getById_('Questions', id);
  if (!q) throw new Error('문제를 찾을 수 없어요.');
  const subject = String(q.subject || '');
  const nodes = rows_('Concepts').filter(function (c) { return c.subject === subject; });
  const nodeById = {};
  nodes.forEach(function (n) { nodeById[n.id] = n; });
  const links = rows_('Links').filter(function (l) { return l.subject === subject && nodeById[l.from] && nodeById[l.to]; });
  const mis = rows_('Misconceptions').filter(function (m) { return m.subject === subject; });
  const isMc = q.type !== 'short';
  const ctx = {
    subject: subject,
    concepts: nodes.map(function (n) { return { id: n.id, name: n.name, desc: n.desc || '' }; }),
    links: links.map(function (l) { return { id: l.id, from: nodeById[l.from].name, to: nodeById[l.to].name }; }),
    misconceptions: mis.map(function (m) {
      return { id: m.id, name: m.name, desc: m.desc || '',
        concepts: (m.conceptIds || []).map(function (c) { return nodeById[c] ? nodeById[c].name : ''; }).filter(String) };
    }),
    question: {
      type: isMc ? '객관식' : '단답형', stem: q.stem,
      choices: isMc ? (q.choices || []).map(function (c, i) { return (i + 1) + ') ' + c; }) : [],
      answer: q.answer, explanation: q.explanation || '',
      teacherNotes: isMc ? (q.misconceptions || []) : []
    }
  };
  const r = openai_([{ role: 'system', content: ANALYZE_PROMPT }, { role: 'user', content: JSON.stringify(ctx) }]);
  const a = normalizeAnalysis_(r, q, nodeById, links, mis);
  return clean_(update_('Questions', id, { analysis: a }));
}
function normalizeAnalysis_(r, q, nodeById, links, mis) {
  r = r || {};
  const linkOk = {}, misOk = {};
  links.forEach(function (l) { linkOk[l.id] = 1; });
  mis.forEach(function (m) { misOk[m.id] = 1; });
  const isMc = q.type !== 'short';
  const ans = Number(q.answer);
  const rc = Array.isArray(r.choices) ? r.choices : [];
  const choices = isMc ? (q.choices || []).map(function (_, i) {
    const c = rc.filter(function (x) { return x && Number(x.no) === i + 1; })[0] || rc[i] || {};
    const right = i + 1 === ans;
    return { misIds: right ? [] : uniqIds_(c.misIds, misOk), note: right ? '' : String(c.note || '').slice(0, 200) };
  }) : [];
  let d = Number(r.difficulty);
  d = (d >= 0 && d <= 1) ? Math.min(0.95, Math.max(0.05, d)) : null;
  const levels = ['기억', '이해', '적용', '분석', '평가'];
  return {
    conceptIds: uniqIds_(r.conceptIds, nodeById),
    linkIds: uniqIds_(r.linkIds, linkOk),
    choices: choices,
    shortPatterns: isMc ? [] : (Array.isArray(r.shortPatterns) ? r.shortPatterns : []).slice(0, 5)
      .map(function (s) { return { pattern: String((s && s.pattern) || '').slice(0, 60), misIds: uniqIds_(s && s.misIds, misOk) }; })
      .filter(function (s) { return s.pattern; }),
    level: levels.indexOf(String(r.level)) >= 0 ? String(r.level) : '',
    difficulty: d,
    summary: String(r.summary || '').slice(0, 200),
    suggestions: (Array.isArray(r.suggestions) ? r.suggestions : []).slice(0, 3).map(String),
    at: Date.now()
  };
}
/** 과목 문항들의 분석 상태: none(미분석) / stale(분석 후 수정됨) / ok */
function analysisStatus_(subject) {
  return rows_('Questions').filter(function (q) { return !subject || q.subject === subject; }).map(function (q) {
    const a = qAnalysis_(q);
    return { id: q.id, title: q.title, subject: q.subject, type: q.type,
      state: !a ? 'none' : (Number(q.updatedAt) > Number(a.at) ? 'stale' : 'ok'),
      analysis: a, conceptIds: q.conceptIds || [] };
  });
}
/** 여러 문항 일괄 분석 (실행 시간 제한 때문에 약 4분마다 끊어서 남은 목록을 돌려줌) */
function analyzeMany_(ids) {
  if (!PROPS.getProperty('OPENAI_KEY')) throw new Error('OpenAI API 키가 없어요. [설정]에서 키를 입력해 주세요.');
  const t0 = Date.now(), done = [], failed = [];
  ids = (ids || []).slice();
  while (ids.length && Date.now() - t0 < 240000) {
    const id = ids.shift();
    try { analyzeQuestion_(id); done.push(id); }
    catch (e) { failed.push({ id: id, error: String((e && e.message) || e) }); }
  }
  return { done: done, failed: failed, remaining: ids };
}

/* =================================================================
 *  3. 형성평가 통계  (AI 없이 사전 태깅으로 집계)
 * ================================================================= */
/** opt = {subject, classId, from, to} 범위의 원자료 */
function loadScope_(opt) {
  opt = opt || {};
  const subject = String(opt.subject || '');
  const classes = classesMeta_().filter(function (c) { return c.subject === subject && (!opt.classId || c.id === opt.classId); });
  const cls = {};
  classes.forEach(function (c) { cls[c.id] = c; });
  const les = {};
  rows_('Lessons').forEach(function (l) {
    if (cls[l.classId] && (!opt.from || l.date >= opt.from) && (!opt.to || l.date <= opt.to)) les[l.id] = l;
  });
  const responses = [], used = {};
  rows_('Responses').forEach(function (r) {
    const l = les[r.lessonId];
    if (!l) return;
    used[r.questionId] = 1;
    responses.push({
      lessonId: r.lessonId, questionId: String(r.questionId),
      student: l.classId + '|' + String(r.studentKey || r.studentName), name: String(r.studentName || r.studentKey),
      cls: cls[l.classId].name, answer: String(r.answer), correct: Number(r.correct) === 1, t: Number(r.timestamp) || 0
    });
  });
  return {
    subject: subject,
    classes: classes.map(function (c) { return { id: c.id, name: c.name }; }),
    lessons: Object.keys(les).length,
    concepts: rows_('Concepts').filter(function (c) { return c.subject === subject; }),
    links: rows_('Links').filter(function (l) { return l.subject === subject; }),
    miscons: rows_('Misconceptions').filter(function (m) { return m.subject === subject; }),
    questions: rows_('Questions').filter(function (q) { return q.subject === subject || used[q.id]; }),
    responses: responses
  };
}
function getFormativeStats_(opt) {
  const D = loadScope_(opt);
  const st = computeStats_(D);
  st.classes = D.classes; st.lessons = D.lessons;
  return st;
}

function computeStats_(D) {
  const qById = {}, cById = {}, mById = {};
  D.questions.forEach(function (q) { qById[q.id] = q; });
  D.concepts.forEach(function (c) { cById[c.id] = c; });
  D.miscons.forEach(function (m) { mById[m.id] = m; });

  // (1) 같은 학생·차시·문항은 마지막 응답만
  const last = {};
  D.responses.forEach(function (r) {
    if (!qById[r.questionId]) return;
    const k = r.student + '#' + r.lessonId + '#' + r.questionId;
    if (!last[k] || last[k].t <= r.t) last[k] = r;
  });
  const R = Object.keys(last).map(function (k) { return last[k]; });

  // (2) 학생별 정답률
  const stu = {};
  R.forEach(function (r) {
    const s = stu[r.student] = stu[r.student] || { key: r.student, name: r.name, cls: r.cls, n: 0, c: 0, con: {}, mis: {} };
    s.n++; if (r.correct) s.c++;
  });

  // (3) 문항 분석: 난이도(p), 변별도(상·하위 27% 차이 D, 점이연 상관 r_pb), 선지(오답) 분석
  const byItem = {};
  R.forEach(function (r) { (byItem[r.questionId] = byItem[r.questionId] || []).push(r); });
  const items = Object.keys(byItem).map(function (qid) {
    const q = qById[qid], rs = byItem[qid], a = qAnalysis_(q);
    const n = rs.length, c = rs.filter(function (r) { return r.correct; }).length;
    const ranked = rs.map(function (r) {
      const s = stu[r.student];
      return { r: r, rest: s.n > 1 ? (s.c - (r.correct ? 1 : 0)) / (s.n - 1) : null };
    }).filter(function (x) { return x.rest !== null; })
      .sort(function (x, y) { return y.rest - x.rest; });
    const g = ranked.length >= 4 ? Math.max(1, Math.round(ranked.length * 0.27)) : 0;
    const upper = ranked.slice(0, g), lower = g ? ranked.slice(-g) : [];
    const pOf = function (arr) { return arr.length ? arr.filter(function (x) { return x.r.correct; }).length / arr.length : null; };
    const pU = pOf(upper), pL = pOf(lower);
    const out = {
      id: qid, title: q.title, type: q.type, stem: String(q.stem || '').slice(0, 140),
      n: n, c: c, p: n ? c / n : null,
      D: (pU !== null && pL !== null) ? pU - pL : null,
      rpb: ranked.length >= 5 ? pearson_(ranked.map(function (x) { return x.r.correct ? 1 : 0; }), ranked.map(function (x) { return x.rest; })) : null,
      concepts: qConcepts_(q), links: a ? a.linkIds || [] : [], level: a ? a.level : '', predicted: a ? a.difficulty : null,
      analyzed: !!a, choices: [], shorts: []
    };
    if (q.type !== 'short') {
      const ans = Number(q.answer), wrong = n - c;
      out.choices = (q.choices || []).map(function (txt, i) {
        const no = i + 1;
        const cnt = rs.filter(function (r) { return Number(r.answer) === no; }).length;
        const up = upper.filter(function (x) { return Number(x.r.answer) === no; }).length;
        const lo = lower.filter(function (x) { return Number(x.r.answer) === no; }).length;
        const ch = { no: no, text: String(txt).slice(0, 80), correct: no === ans, count: cnt, rate: n ? cnt / n : 0,
          upRate: g ? up / g : null, loRate: g ? lo / g : null, mis: choiceMis_(q, no),
          note: (a && a.choices && a.choices[i] && a.choices[i].note) || '', flags: [] };
        if (!ch.correct) {
          if (cnt >= 2 && (ch.rate >= 0.15 || (wrong && cnt / wrong >= 0.5))) ch.flags.push('매력적 오답');
          if (g && up > lo) ch.flags.push('상위권 유인');
          if (cnt === 0 && n >= 5) ch.flags.push('기능 안 함');
        }
        return ch;
      });
    } else {
      const m = {};
      rs.filter(function (r) { return !r.correct; }).forEach(function (r) {
        const t = String(r.answer).trim();
        m[t] = m[t] || { text: t, count: 0, mis: shortMis_(q, t) };
        m[t].count++;
      });
      out.shorts = Object.keys(m).map(function (k) { return m[k]; })
        .sort(function (x, y) { return y.count - x.count; }).slice(0, 8);
    }
    return out;
  });

  // (4) 개념별 숙달도
  const con = {};
  D.concepts.forEach(function (c) { con[c.id] = { n: 0, c: 0, stu: {}, mis: {} }; });
  R.forEach(function (r) {
    const s = stu[r.student];
    qConcepts_(qById[r.questionId]).forEach(function (cid) {
      const x = con[cid];
      if (!x) return;
      x.n++; if (r.correct) x.c++;
      const sx = x.stu[r.student] = x.stu[r.student] || { n: 0, c: 0 };
      sx.n++; if (r.correct) sx.c++;
      const sc = s.con[cid] = s.con[cid] || { n: 0, c: 0 };
      sc.n++; if (r.correct) sc.c++;
    });
  });

  // (5) 오개념: 노출(그 오개념을 유도하는 선지를 본 횟수) 대비 선택, 우연 대비 z검정
  const mis = {};
  const M = function (key) {
    return mis[key] = mis[key] || { hits: 0, wrongN: 0, expected: 0, variance: 0, expo: {}, hitStu: {}, items: {}, concepts: {} };
  };
  R.forEach(function (r) {
    const q = qById[r.questionId], isMc = q.type !== 'short';
    const offered = {};
    if (isMc) (q.choices || []).forEach(function (_, i) { choiceMis_(q, i + 1).forEach(function (k) { offered[k] = (offered[k] || 0) + 1; }); });
    else { const a = qAnalysis_(q); ((a && a.shortPatterns) || []).forEach(function (s) { s.misIds.forEach(function (k) { offered[k] = (offered[k] || 0) + 1; }); }); }
    const k1 = Math.max(1, (q.choices || []).length - 1);
    Object.keys(offered).forEach(function (key) {
      const m = M(key);
      m.expo[r.student] = 1; m.items[q.id] = 1;
      if (!r.correct) {
        m.wrongN++;
        if (isMc) { const p0 = Math.min(1, offered[key] / k1); m.expected += p0; m.variance += p0 * (1 - p0); }
      }
    });
    const picked = r.correct ? [] : (isMc ? choiceMis_(q, Number(r.answer)) : shortMis_(q, r.answer));
    picked.forEach(function (key) {
      const m = M(key);
      m.hits++; m.items[q.id] = 1;
      m.hitStu[r.student] = (m.hitStu[r.student] || 0) + 1;
      stu[r.student].mis[key] = (stu[r.student].mis[key] || 0) + 1;
      qConcepts_(q).forEach(function (cid) {
        m.concepts[cid] = (m.concepts[cid] || 0) + 1;
        if (con[cid]) con[cid].mis[key] = (con[cid].mis[key] || 0) + 1;
      });
    });
  });
  D.miscons.forEach(function (m) { M(m.id); });   // 아직 다루지 않은 오개념도 목록에 표시
  const misName = function (key) { return mById[key] ? mById[key].name : String(key).replace(/^t:/, ''); };
  const miscons = Object.keys(mis).map(function (key) {
    const m = mis[key], def = mById[key];
    const expoN = Object.keys(m.expo).length, hitN = Object.keys(m.hitStu).length;
    const z = m.variance > 0 ? (m.hits - m.expected) / Math.sqrt(m.variance) : null;
    const cons = (def && def.conceptIds && def.conceptIds.length) ? def.conceptIds.slice()
      : Object.keys(m.concepts).sort(function (x, y) { return m.concepts[y] - m.concepts[x]; });
    return {
      key: key, name: misName(key), desc: def ? def.desc || '' : '', listed: !!def,
      hits: m.hits, wrongN: m.wrongN,
      share: m.wrongN ? m.hits / m.wrongN : null, expectedShare: m.wrongN ? m.expected / m.wrongN : null,
      z: z, significant: z !== null && z >= 1.96 && m.hits >= 3,
      exposed: expoN, students: hitN, prevalence: expoN ? hitN / expoN : null, ci: wilson_(hitN, expoN),
      persistent: Object.keys(m.hitStu).filter(function (k) { return m.hitStu[k] >= 2; }).length,
      items: Object.keys(m.items).length, concepts: cons.slice(0, 4)
    };
  }).sort(function (x, y) { return y.hits - x.hits || (y.z || 0) - (x.z || 0) || y.exposed - x.exposed; });

  const concepts = D.concepts.map(function (c) {
    const x = con[c.id];
    const rates = Object.keys(x.stu).map(function (k) { return x.stu[k].c / x.stu[k].n; });
    return {
      id: c.id, name: c.name, x: Number(c.x) || 0, y: Number(c.y) || 0,
      n: x.n, c: x.c, rate: x.n ? x.c / x.n : null, mastery: (x.c + 1) / (x.n + 2),
      students: rates.length, sd: sd_(rates),
      mastered: rates.length ? rates.filter(function (v) { return v >= MASTERY_CUT; }).length / rates.length : null,
      mis: Object.keys(x.mis).map(function (k) { return { key: k, name: misName(k), count: x.mis[k] }; })
        .sort(function (p, q) { return q.count - p.count; }).slice(0, 5)
    };
  });

  // (6) 개념 간 연결: 연결 문항 정답률 + '앞 개념은 숙달했는데 뒤 개념은 미숙달'인 비율(연결 단절률)
  const linkItems = {};
  R.forEach(function (r) {
    const a = qAnalysis_(qById[r.questionId]);
    ((a && a.linkIds) || []).forEach(function (lid) {
      const x = linkItems[lid] = linkItems[lid] || { n: 0, c: 0 };
      x.n++; if (r.correct) x.c++;
    });
  });
  const links = D.links.map(function (l) {
    const A = con[l.from], B = con[l.to];
    let base = 0, brk = 0;
    if (A && B) Object.keys(A.stu).forEach(function (k) {
      const a = A.stu[k], b = B.stu[k];
      if (!b) return;
      if (a.c / a.n >= MASTERY_CUT) { base++; if (b.c / b.n < MASTERY_CUT) brk++; }
    });
    const li = linkItems[l.id];
    const itemRate = li && li.n ? li.c / li.n : null, breakRate = base ? brk / base : null;
    return {
      id: l.id, from: l.from, to: l.to,
      fromName: cById[l.from] ? cById[l.from].name : '?', toName: cById[l.to] ? cById[l.to].name : '?',
      itemN: li ? li.n : 0, itemRate: itemRate, base: base, breakN: brk, breakRate: breakRate,
      difficulty: itemRate !== null ? 1 - itemRate : breakRate
    };
  });

  // (7) 학생·전체 요약
  const students = Object.keys(stu).map(function (k) {
    const s = stu[k];
    return {
      key: k, name: s.name, cls: s.cls, n: s.n, c: s.c, rate: s.c / s.n, con: s.con,
      weak: Object.keys(s.con).filter(function (cid) { const x = s.con[cid]; return (x.c + 1) / (x.n + 2) < 0.5; }),
      mis: Object.keys(s.mis).sort(function (x, y) { return s.mis[y] - s.mis[x]; }).slice(0, 3)
        .map(function (key) { return { key: key, name: misName(key), count: s.mis[key] }; })
    };
  }).sort(function (x, y) { return x.rate - y.rate; });
  const rates = students.map(function (s) { return s.rate; });
  const hist = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  rates.forEach(function (v) { hist[Math.min(9, Math.floor(v * 10))]++; });
  return {
    overview: {
      students: students.length, responses: R.length, items: items.length,
      analyzedItems: items.filter(function (i) { return i.analyzed; }).length,
      mean: mean_(rates), sd: sd_(rates), hist: hist,
      meanSmoothed: mean_(students.map(function (s) { return (s.c + 1) / (s.n + 2); })) || 0.6
    },
    concepts: concepts, links: links, miscons: miscons, items: items, students: students
  };
}

/* =================================================================
 *  4. 지필고사 출제 추천
 * ================================================================= */
/*  알고리즘 요약
 *  - 개념 숙달도 m = (정답+1)/(응답+2)  (라플라스 평활, 데이터가 적어도 극단값 방지)
 *  - 시험 목적별로 [개념 가중치 · 난이도 구성 · 오개념/연결 문항 비율 · 배점 가중치]가 다름
 *      criterion  : 최소 성취기준 확인 → 모든 개념 1문항 이상(범위 포괄), 약점 가중, 쉬움·보통, 균등 배점
 *      norm       : 정규분포형 → 숙달도가 중간(m(1-m) 최대)·학생 간 편차가 큰 개념 가중, 난이도 고르게, 어려운 문항 배점↑
 *      grouping   : 집단 분류 → 집단 경계(상위 누적비율)에서 정답률이 그 비율인 문항이 가장 잘 가름(문항정보 최대)
 *      diagnostic : 학습 결손 진단 → 약점·오개념 비중↑
 *  - 문항 수와 배점은 최대 잔여법으로 정수(배점 단위) 배분
 *  - 약한 영역일수록 쉬운 수준을 배정 (기초 확인), 강한 영역일수록 어려운 수준 (변별)
 *  - 예상 점수 분포: 학생의 개념별 숙달도와 반 평균의 차이를 목표 정답률에 더하는 Rasch형 근사
 */
const EXAM_PURPOSES = {
  criterion: {
    label: '최소 성취기준 확인', misShare: 0.2, linkShare: 0.1, coverage: true,
    mix: [['easy', 0.55], ['mid', 0.45]],
    cw: function (c) { return 1 + 1.5 * c.weak; },
    pw: function () { return 1; }
  },
  norm: {
    label: '정규분포형 (상대평가)', misShare: 0.2, linkShare: 0.15, coverage: false,
    mix: [['easy', 0.2], ['mid', 0.4], ['hard', 0.3], ['xhard', 0.1]],
    cw: function (c) { return 0.5 + 4 * c.m * (1 - c.m) + 2 * c.sd; },
    pw: function (s) { return 1 + 0.8 * (1 - s.p); }
  },
  grouping: {
    label: '집단 분류', misShare: 0.15, linkShare: 0.15, coverage: false, mix: null,
    cw: function (c) { return 0.5 + 3 * c.sd + 2 * c.m * (1 - c.m); },
    pw: function (s) { return 1 + 0.5 * (1 - s.p); }
  },
  diagnostic: {
    label: '학습 결손 진단', misShare: 0.35, linkShare: 0.2, coverage: false,
    mix: [['easy', 0.3], ['mid', 0.5], ['hard', 0.2]],
    cw: function (c) { return 0.3 + 2.5 * c.weak; },
    pw: function (s) { return 1 + 0.5 * (s.weak || 0); }
  }
};

function recommendExam_(opt) {
  const D = loadScope_(opt);
  const ST = computeStats_(D);
  return planExam_(ST, D, opt);
}

function pct_(v) { return v == null ? '-' : Math.round(v * 100) + '%'; }

function planExam_(ST, D, opt) {
  opt = opt || {};
  const key = EXAM_PURPOSES[opt.purpose] ? opt.purpose : 'criterion';
  const P = EXAM_PURPOSES[key];
  const N = Math.max(1, Math.min(100, Math.round(Number(opt.n) || 20)));
  const T = Math.max(1, Number(opt.total) || 100);
  const step = [1, 0.5, 0.1].indexOf(Number(opt.step)) >= 0 ? Number(opt.step) : 1;

  // 난이도 구성
  let levels;
  let cuts = [];
  if (key === 'grouping') {
    const groups = (opt.groups && opt.groups.length >= 2) ? opt.groups : [{ name: 'A', ratio: 30 }, { name: 'B', ratio: 40 }, { name: 'C', ratio: 30 }];
    const sum = groups.reduce(function (s, g) { return s + (Number(g.ratio) || 0); }, 0) || 1;
    let cum = 0;
    for (let i = 0; i < groups.length - 1; i++) {
      cum += (Number(groups[i].ratio) || 0) / sum;
      cuts.push({ label: groups[i].name + '/' + groups[i + 1].name + ' 경계', top: cum });
    }
    levels = cuts.map(function (c, i) {
      return { key: 'cut' + i, label: c.label, p: Math.min(0.9, Math.max(0.1, c.top)), share: 0.85 / cuts.length };
    }).concat([{ key: 'mid', label: '보통', p: 0.6, share: 0.15 }]);
  } else {
    levels = P.mix.map(function (x) { const L = LEVELS[x[0]]; return { key: L.key, label: L.label, p: L.p, share: x[1] }; });
  }

  // 출제 범위 개념
  const scopeIds = (opt.conceptIds && opt.conceptIds.length) ? opt.conceptIds : ST.concepts.map(function (c) { return c.id; });
  const scope = {};
  scopeIds.forEach(function (id) { scope[id] = 1; });
  const C = ST.concepts.filter(function (c) { return scope[c.id]; }).map(function (c) {
    const noData = !c.n, m = noData ? 0.6 : c.mastery;
    return { id: c.id, name: c.name, m: m, weak: 1 - m, sd: c.sd != null ? c.sd : 0.15, noData: noData, rate: c.rate, n: c.n,
      tag: noData ? '데이터 없음' : m < 0.6 ? '약점' : m >= 0.8 ? '강점' : '보통' };
  });
  if (!C.length) throw new Error('출제 범위에 개념이 없어요. 개념 지도를 먼저 만들어 주세요.');
  const cName = {};
  ST.concepts.forEach(function (c) { cName[c.id] = c.name; });

  // 오개념 · 연결 후보
  const misC = ST.miscons.filter(function (m) {
    return m.hits > 0 && (!m.concepts.length || m.concepts.some(function (c) { return scope[c]; }));
  }).map(function (m) { return { m: m, score: (m.prevalence || 0) * (1 + Math.max(0, m.z || 0) / 2) + (m.significant ? 0.5 : 0) }; })
    .sort(function (a, b) { return b.score - a.score; }).map(function (x) { return x.m; });
  const linkC = ST.links.filter(function (l) { return scope[l.from] && scope[l.to] && l.difficulty !== null && l.difficulty >= 0.3; })
    .sort(function (a, b) { return b.difficulty - a.difficulty; });
  let nMis = Math.min(Math.round(N * P.misShare), misC.length);
  let nLink = Math.min(Math.round(N * P.linkShare), linkC.length);
  while (nMis + nLink > N - 1 && (nMis || nLink)) { if (nLink >= nMis && nLink) nLink--; else nMis--; }
  const nCon = N - nMis - nLink;

  // 개념별 문항 수
  const cnt = hamilton_(C.map(P.cw), nCon, (P.coverage && nCon >= C.length) ? C.map(function () { return 1; }) : null);
  const slots = [];
  C.forEach(function (c, i) {
    for (let j = 0; j < cnt[i]; j++) {
      slots.push({ kind: 'concept', tag: c.tag, label: c.name, conceptIds: [c.id], m: c.m, weak: c.weak,
        evidence: c.noData ? '형성평가 자료 없음 (기본값으로 배정)' : '형성평가 정답률 ' + pct_(c.rate) + ' (응답 ' + c.n + '개) → ' + c.tag });
    }
  });
  misC.slice(0, nMis).forEach(function (m) {
    slots.push({ kind: 'mis', tag: '오개념', label: m.name, misKey: m.key,
      conceptIds: m.concepts.filter(function (c) { return scope[c]; }).slice(0, 2),
      m: 1 - (m.prevalence || 0.3), weak: m.prevalence || 0.3,
      evidence: '학생 ' + pct_(m.prevalence) + '(' + m.students + '/' + m.exposed + '명)이 이 오개념 선지 선택, 총 ' + m.hits + '회' +
        (m.significant ? ' · 우연보다 유의하게 많음(z=' + m.z.toFixed(1) + ')' : '') });
  });
  linkC.slice(0, nLink).forEach(function (l) {
    slots.push({ kind: 'link', tag: '개념 연결', label: l.fromName + ' → ' + l.toName, linkId: l.id,
      conceptIds: [l.from, l.to], m: 1 - l.difficulty, weak: l.difficulty,
      evidence: (l.itemRate !== null ? '연결 문항 정답률 ' + pct_(l.itemRate) : '') +
        (l.breakRate !== null ? (l.itemRate !== null ? ' · ' : '') + '앞 개념 숙달 학생 중 ' + pct_(l.breakRate) + '가 뒤 개념 미숙달' : '') });
  });

  // 난이도 배정: 약한 영역 → 쉬운 수준, 강한 영역 → 어려운 수준
  const lvCnt = hamilton_(levels.map(function (l) { return l.share; }), N);
  const lvList = [];
  levels.map(function (l, i) { return { l: l, n: lvCnt[i] }; })
    .sort(function (a, b) { return b.l.p - a.l.p; })
    .forEach(function (x) { for (let j = 0; j < x.n; j++) lvList.push(x.l); });
  slots.sort(function (a, b) { return a.m - b.m; });
  slots.forEach(function (s, i) { const L = lvList[i]; s.level = L.label; s.levelKey = L.key; s.p = L.p; });

  // 배점
  const units = Math.round(T / step);
  const pu = hamilton_(slots.map(P.pw), units, units >= N ? slots.map(function () { return 1; }) : null);
  slots.forEach(function (s, i) { s.points = Math.round(pu[i] * step * 100) / 100; });

  // 문항 순서: 쉬운 문항부터
  const kindOrder = { concept: 0, link: 1, mis: 2 };
  slots.sort(function (a, b) { return b.p - a.p || kindOrder[a.kind] - kindOrder[b.kind]; });
  slots.forEach(function (s, i) { s.no = i + 1; s.conceptNames = s.conceptIds.map(function (id) { return cName[id] || '?'; }); });

  bankCandidates_(slots, D, ST);

  // 요약표
  const byKind = {}, byLevel = {}, byConcept = {};
  slots.forEach(function (s) {
    const k = s.kind === 'concept' ? s.tag + ' 개념' : s.tag;
    byKind[k] = byKind[k] || { label: k, items: 0, points: 0 };
    byKind[k].items++; byKind[k].points += s.points;
    byLevel[s.level] = byLevel[s.level] || { label: s.level, p: s.p, items: 0, points: 0 };
    byLevel[s.level].items++; byLevel[s.level].points += s.points;
    s.conceptIds.forEach(function (cid) {
      byConcept[cid] = byConcept[cid] || { id: cid, name: cName[cid] || '?', items: 0, points: 0 };
      byConcept[cid].items++; byConcept[cid].points += s.points / s.conceptIds.length;
    });
  });
  const vals = function (o) { return Object.keys(o).map(function (k) { return o[k]; }); };
  const expP = slots.reduce(function (s, x) { return s + x.points * x.p; }, 0);

  return {
    purpose: key, purposeLabel: P.label, n: N, total: T, step: step, cuts: cuts,
    concepts: C, slots: slots,
    summary: {
      byKind: vals(byKind), byConcept: vals(byConcept).sort(function (a, b) { return b.points - a.points; }),
      byLevel: vals(byLevel).sort(function (a, b) { return b.p - a.p; }),
      targetMean: expP
    },
    distribution: simulateExam_(slots, ST, T, key, cuts, Number(opt.cut) || 40),
    stats: { students: ST.overview.students, responses: ST.overview.responses, items: ST.overview.items }
  };
}

/** 문제은행에서 각 칸에 맞는 문항 후보 (같은 문항은 한 칸에만 '추천') */
function bankCandidates_(slots, D, ST) {
  const obs = {};
  ST.items.forEach(function (it) { obs[it.id] = it; });
  const used = {};
  slots.forEach(function (s) {
    const scored = [];
    D.questions.forEach(function (q) {
      const a = qAnalysis_(q), cs = qConcepts_(q);
      let sc;
      if (s.kind === 'mis') {
        const has = q.type !== 'short'
          ? (q.choices || []).some(function (_, i) { return choiceMis_(q, i + 1).indexOf(s.misKey) >= 0; })
          : ((a && a.shortPatterns) || []).some(function (p) { return p.misIds.indexOf(s.misKey) >= 0; });
        if (!has) return;
        sc = 3;
      } else if (s.kind === 'link') {
        if (a && (a.linkIds || []).indexOf(s.linkId) >= 0) sc = 3;
        else if (s.conceptIds.every(function (c) { return cs.indexOf(c) >= 0; })) sc = 2;
        else return;
      } else {
        if (cs.indexOf(s.conceptIds[0]) < 0) return;
        sc = cs[0] === s.conceptIds[0] ? 2.2 : 2;
      }
      const o = obs[q.id];
      const est = (o && o.n >= 5) ? o.p : (a && a.difficulty != null ? a.difficulty : null);
      if (est != null) sc -= Math.abs(est - s.p) * 2;
      if (o && o.D != null && o.D < 0) sc -= 0.5;   // 역변별 문항은 감점
      scored.push({ id: q.id, title: q.title, est: est, observedN: o ? o.n : 0, observedP: o ? o.p : null, score: Math.round(sc * 100) / 100 });
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    const pick = scored.filter(function (x) { return !used[x.id]; })[0];
    if (pick) used[pick.id] = 1;
    s.pick = pick ? pick.id : '';
    s.candidates = scored.slice(0, 4);
  });
}

/** 예상 점수 분포 (학생별 기대점수 ± 문항 응답의 우연 변동) */
function simulateExam_(slots, ST, T, key, cuts, cutPct) {
  const ss = ST.students.filter(function (s) { return s.n >= 3; });
  if (!ss.length) return null;
  const cm = {};
  ST.concepts.forEach(function (c) { cm[c.id] = c; });
  const base = logit_(ST.overview.meanSmoothed);
  const per = ss.map(function (s) {
    const overall = logit_((s.c + 1) / (s.n + 2));
    let e = 0, v = 0;
    slots.forEach(function (sl) {
      let d = 0, k = 0;
      sl.conceptIds.forEach(function (cid) {
        const x = s.con[cid], c = cm[cid];
        if (x && c && c.n) { d += logit_((x.c + 1) / (x.n + 2)) - logit_(c.mastery); k++; }
      });
      d = k ? d / k : overall - base;
      const p = sig_(logit_(sl.p) + d);
      e += sl.points * p; v += sl.points * sl.points * p * (1 - p);
    });
    return { e: e, v: v };
  });
  const E = per.map(function (x) { return x.e; });
  const mean = mean_(E);
  const varTot = (E.length > 1 ? Math.pow(sd_(E), 2) : 0) + mean_(per.map(function (x) { return x.v; }));
  const sdTot = Math.sqrt(varTot);
  // 10구간 히스토그램 (학생별 정규분포의 혼합)
  const bins = [];
  for (let b = 0; b < 10; b++) {
    const lo = T * b / 10, hi = T * (b + 1) / 10;
    let pr = 0;
    per.forEach(function (x) {
      const s = Math.sqrt(x.v) || 1e-6;
      pr += normCdf_(((b === 9 ? Infinity : hi) - x.e) / s) - normCdf_(((b === 0 ? -Infinity : lo) - x.e) / s);
    });
    bins.push(pr / per.length);
  }
  let skew = 0;
  if (E.length > 2 && sdTot > 0) {
    // 혼합분포의 왜도는 기대점수 분포로 근사
    const sE = sd_(E) || sdTot;
    skew = mean_(E.map(function (x) { return Math.pow((x - mean) / sE, 3); }));
  }
  const out = { students: ss.length, mean: mean, sd: sdTot, bins: bins, skew: skew };
  const sorted = E.slice().sort(function (a, b) { return b - a; });
  if (key === 'grouping') {
    out.cutScores = cuts.map(function (c) {
      const i = Math.min(sorted.length - 1, Math.max(0, Math.round(c.top * sorted.length) - 1));
      return { label: c.label, score: sorted[i] };
    });
  }
  if (key === 'criterion') {
    const cut = T * cutPct / 100;
    out.cut = cut;
    out.passRate = mean_(per.map(function (x) { return 1 - normCdf_((cut - x.e) / (Math.sqrt(x.v) || 1e-6)); }));
  }
  return out;
}

/** 출제 포인트 (OpenAI, 짧은 정성 코멘트) — 프롬프트는 나중에 튜닝 */
function examAdvice_(brief) {
  const sys = '너는 고등학교 과학 교사의 지필평가 출제를 돕는 평가 전문가야. ' +
    '형성평가 통계와 문항 구성표 요약을 보고 출제할 때 강조할 포인트를 짧게 정리해. ' +
    '구체적인 개념·오개념 이름을 언급하고, 시험 목적에 맞게 조언해. 반드시 JSON 하나로만 답해.\n' +
    '형식: {"points":["출제 포인트 3~5개, 각 1~2문장"],"cautions":["주의할 점 1~2개"]}';
  const r = openai_([{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify(brief).slice(0, 14000) }]);
  const arr = function (v) { return (Array.isArray(v) ? v : []).map(String).filter(String).slice(0, 6); };
  return { points: arr(r.points), cautions: arr(r.cautions) };
}
