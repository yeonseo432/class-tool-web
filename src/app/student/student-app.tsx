'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import QuestionImage from '@/components/question-image';
import { ManateeMark } from '@/components/manatee';
import { CIRC, DONT_KNOW, DONT_KNOW_LABEL } from '@/lib/live';
import { RpcError, studentApi } from '@/lib/rpc';
import { useLiveChannel } from '@/lib/use-live-channel';
import { I18nProvider, LangPicker, useI18n } from './i18n';
import s from './student.module.css';

/*
 * 학생 태블릿 화면
 *  1) 로그인: 학습코드(선생님이 알려 준 반 코드 4자리) · 학번 + 비밀번호 — 선생님 학생 명단에 있어야 들어올 수 있어요
 *     처음에는 선생님이 나눠 준 6자리 비밀번호 → 그 자리에서 자기 비밀번호를 정해야 들어가요
 *     다른 기기에서 같은 학생으로 로그인하면 이 기기는 로그아웃되고 안내가 떠요
 *  2) 평소: 빈 화면 (왼쪽 아래 설정 버튼만)
 *  3) 선생님이 [문제 출제하기] → 문제 → 제출하면 '제출했어요' + 문제 원문과 내가 고른 답 (정답은 아직 안 보여요)
 *     객관식에는 항상 '모르겠어요' 선지가 붙어요 (고르면 다른 선지는 못 골라요)
 *  4) 선생님이 [정답 공개] → 정답 여부 · 정답 (해설 없음) + 문제 원문 / [수업 종료] → '수업이 끝났어요'
 *  5) 빈 화면의 [틀린 문제 다시 보기]: 끝난 수업에서 틀린 문제 · 내 답 · 정답 (진행 중인 수업 문제는 빠짐)
 *  6) 언어: 로그인 화면 · 설정에서 고름 (이 기기에 기억). 화면 글자는 t('한국어'), 문제는 studentTranslate 로 번역해
 *     원문 자리에 보여 줘요 ([원문 보기]로 한국어 확인). 제출 · 정답 판정은 언제나 원문 기준 (선지 번호 · 원문 답).
 */

type Profile = { name: string; studentNo: string; grade: number; className: string };
type Login = ({ needNewPassword: true }) | ({ needNewPassword: false } & Profile);
type View = {
  view: 'idle' | 'question' | 'result';
  status?: 'none' | 'waiting' | 'closed';
  channel: string | null;
  question: null | { id: string; no: number; type: 'mc' | 'short'; stem: string; choices: string[]; imageUrl: string; choiceImages?: string[]; need: number };
  result: null | { answer: string | null; correct: boolean | null; correctAnswer: string | null; revealed: boolean };
};
type ReviewItem = {
  id: string; date: string; lesson: string; type: 'mc' | 'short'; stem: string; choices: string[]; imageUrl: string; choiceImages: string[];
  answer: string; correctAnswer: string; wrongCount: number;
};

/** 빈 화면 문구 (수업 상태별) */
const IDLE_TEXT = {
  loading: ['선생님께서 아직 문제를 올리지 않으셨어요', '수업 정보를 불러오는 중이에요…'],
  waiting: ['선생님께서 아직 문제를 올리지 않으셨어요', '문제가 올라오면 이 화면에 바로 나타나요. 잠시만 기다려 주세요.'],
  closed: ['제출이 마감됐어요', '선생님 설명을 들어 주세요. 다음 문제가 올라오면 이 화면에 바로 나타나요.'],
  ended: ['수업이 끝났어요', '수고했어요! 다음 수업 때 다시 만나요.'],
} as const;

const store = {
  get: (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 사생활 보호 모드 등 */ } },
};
const isAuth = (e: unknown) => e instanceof RpcError && e.status === 401;
const nos = (a: string) => String(a).split('|').map((x) => x.trim()).filter(Boolean);
const circ = (a: string, dunno = DONT_KNOW_LABEL) => (a.trim() === DONT_KNOW ? dunno : nos(a).map((x) => CIRC[Number(x) - 1] ?? x).join(' '));
/** 문제 글 번역 { 원문: 번역 } → 보여 줄 글 (원문 보기면 원문) */
type Tr = (ko: string) => string;
const same: Tr = (x) => x;

export default function StudentApp() {
  return <I18nProvider><Student /></I18nProvider>;
}

function Student() {
  const { rtl } = useI18n();
  const [me, setMe] = useState<Profile | null | undefined>(undefined);   // undefined: 확인 중
  const [notice, setNotice] = useState('');
  /** 로그아웃 (이유가 있으면 로그인 화면에 안내) */
  const out = useCallback((why?: string) => { setNotice(why ?? ''); setMe(null); }, []);

  useEffect(() => {
    studentApi<Profile | null>('studentMe').then(setMe).catch((e) => out(isAuth(e) ? (e as Error).message : ''));
  }, [out]);

  if (me === undefined) return <div className={s.page} />;
  return (
    <div dir={rtl ? 'rtl' : undefined} className={s.dirBox}>
      {!me ? <LoginView notice={notice} onLogin={(p) => { setNotice(''); setMe(p); }} /> : <MainView me={me} out={out} />}
    </div>
  );
}

/* ---------------- 로그인 ---------------- */
function LoginView({ notice, onLogin }: { notice: string; onLogin: (p: Profile) => void }) {
  const { t } = useI18n();
  const [f, setF] = useState(() => ({
    code: store.get('st_code'), studentNo: store.get('st_sno'), pw: '',
  }));
  const [step, setStep] = useState<'login' | 'newpw'>('login');
  const [np, setNp] = useState({ a: '', b: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: k === 'pw' ? e.target.value : e.target.value.replace(/\D/g, '') });

  async function login(e: React.FormEvent) {
    e.preventDefault();
    if (f.code.length !== 4) return setErr(t('학습코드 4자리를 입력해 주세요.'));
    if (f.studentNo.length < 4) return setErr(t('학번을 입력해 주세요. (예: 30301)'));
    if (!f.pw) return setErr(t('비밀번호를 입력해 주세요.'));
    if (step === 'newpw') {
      if (np.a.length < 4) return setErr(t('새 비밀번호를 4자 이상으로 정해 주세요.'));
      if (np.a !== np.b) return setErr(t('새 비밀번호 두 칸이 서로 달라요.'));
    }
    setBusy(true);
    setErr('');
    try {
      const r = await studentApi<Login>('studentLogin', f.code, f.studentNo, f.pw, step === 'newpw' ? np.a : undefined);
      store.set('st_code', f.code); store.set('st_sno', f.studentNo);
      if (r.needNewPassword) { setStep('newpw'); setBusy(false); return; }
      onLogin(r);
    } catch (e) {
      setErr(t((e as Error).message));
      setBusy(false);
    }
  }

  if (step === 'newpw') {
    return (
      <div className={s.page}>
        <div className={s.wrap}>
          <form className={`${s.card} ${s.join}`} onSubmit={login}>
            <LangPicker className={s.lang} />
            <h1>{t('내 비밀번호 정하기')}</h1>
            <p>{t('학번 {no} · 처음 로그인이에요.', { no: f.studentNo })}<br />
              {t('앞으로 쓸 비밀번호를 정해 주세요. 친구가 알 수 있는 생일 · 번호 같은 건 피해 주세요.')}</p>
            <input className={s.inp} type="password" placeholder={t('새 비밀번호 (4자 이상)')} value={np.a} maxLength={30} autoFocus
              onChange={(e) => setNp({ ...np, a: e.target.value })} autoComplete="new-password" />
            <input className={s.inp} type="password" placeholder={t('새 비밀번호 한 번 더')} value={np.b} maxLength={30}
              onChange={(e) => setNp({ ...np, b: e.target.value })} autoComplete="new-password" />
            <button className={s.btn} disabled={busy}>{busy ? t('저장하는 중…') : t('정하고 들어가기')}</button>
            <div className={s.err} role="alert">{err}</div>
            <button type="button" className={s.linkBtn} onClick={() => { setStep('login'); setErr(''); setNp({ a: '', b: '' }); }}>‹ {t('처음으로')}</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className={s.page}>
      <div className={s.wrap}>
        <form className={`${s.card} ${s.join}`} onSubmit={login}>
          <LangPicker className={s.lang} />
          <h1>{t('수업 참여하기')}</h1>
          <p>{t('선생님이 알려 준 학습코드와 학번, 비밀번호를 입력하세요.')}</p>
          {notice && <div className={s.warn} role="status" style={{ marginBottom: 12 }}>{t(notice)}</div>}
          <input className={`${s.inp} ${s.codeInp}`} inputMode="numeric" maxLength={4} placeholder={t('학습코드 4자리')} value={f.code} onChange={set('code')} aria-label={t('학습코드')} autoComplete="off" />
          <input className={s.inp} inputMode="numeric" maxLength={8} placeholder={t('학번 (예: 30301)')} value={f.studentNo} onChange={set('studentNo')} aria-label={t('학번')} autoComplete="username" />
          <input className={s.inp} type="password" placeholder={t('비밀번호 (처음엔 선생님이 준 6자리)')} value={f.pw} maxLength={30} onChange={set('pw')} autoComplete="current-password" />
          <button className={s.btn} disabled={busy}>{busy ? t('확인하는 중…') : t('들어가기')}</button>
          <div className={s.err} role="alert">{err}</div>
        </form>
      </div>
    </div>
  );
}

/* ---------------- 문제 번역 ---------------- */
/**
 * 문제 글 번역 (studentTranslate). key 가 바뀔 때(문제 · 정답 공개 · 언어) 다시 받아요.
 * 받기 전 · 실패하면 원문 그대로. [원문 보기]를 누르면 한국어 원문.
 */
function useQuestionTr(target: 'current' | 'review', key: string, onAuth: (why?: string) => void) {
  const { lang } = useI18n();
  const [map, setMap] = useState<Record<string, string>>({});
  const [done, setDone] = useState('');
  const [orig, setOrig] = useState(false);
  const want = lang === 'ko' || !key ? '' : `${lang}|${key}`;
  useEffect(() => {
    if (!want) return;
    let alive = true;
    studentApi<Record<string, string>>('studentTranslate', lang, target)
      .then((m) => { if (alive) setMap((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(m).map(([k, v]) => [`${lang}|${k}`, v])) })); })
      .catch((e) => { if (isAuth(e)) onAuth((e as Error).message); })
      .finally(() => { if (alive) setDone(want); });
    return () => { alive = false; };
  }, [want, lang, target, onAuth]);
  const tr: Tr = lang === 'ko' || orig ? same : (x) => map[`${lang}|${x}`] ?? x;
  return { tr, busy: !!want && done !== want, orig, setOrig };
}

/** 번역 중 · AI 번역 표시 + [원문 보기] (한국어를 고르면 안 보여요) */
function TrBar({ busy, orig, setOrig }: { busy: boolean; orig: boolean; setOrig: (v: boolean) => void }) {
  const { t, lang } = useI18n();
  if (lang === 'ko') return null;
  return (
    <div className={s.trBar}>
      <span>{busy ? t('문제를 번역하는 중…') : orig ? t('한국어 원문') : t('AI 번역이에요. 뜻이 이상하면 원문을 확인하세요.')}</span>
      <button type="button" className={s.trBtn} onClick={() => setOrig(!orig)}>{orig ? t('번역 보기') : t('원문(한국어) 보기')}</button>
    </div>
  );
}

/** '…{n}…' 의 {n} 자리에 굵은 글씨 */
const rich = (str: string, node: React.ReactNode) => {
  const [a, b] = str.split('{n}');
  return b === undefined ? str : <>{a}<b>{node}</b>{b}</>;
};

/* ---------------- 수업 화면 (평소엔 빈 화면) ---------------- */
function MainView({ me, out }: { me: Profile; out: (why?: string) => void }) {
  const { t } = useI18n();
  const [v, setV] = useState<View | null>(null);
  const [online, setOnline] = useState(true);
  const inflight = useRef(false), again = useRef(false);
  // 수업 중이던 채널이 사라지면(=교사가 수업 종료) '수업이 끝났어요'
  const lastChannel = useRef<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [review, setReview] = useState(false);

  const refresh = useCallback(async () => {
    if (inflight.current) { again.current = true; return; }
    inflight.current = true;
    try {
      do {
        again.current = false;
        try {
          const next = await studentApi<View>('studentState');
          if (next.channel) { lastChannel.current = next.channel; setEnded(false); }
          else if (lastChannel.current) { lastChannel.current = null; setEnded(true); }
          setV(next);
          setOnline(true);
        } catch (e) {
          if (isAuth(e)) return out((e as Error).message);
          setOnline(false);   // 잠깐 끊김 — 다음 신호·폴링 때 다시
        }
      } while (again.current);
    } finally {
      inflight.current = false;
    }
  }, [out]);

  useEffect(() => { refresh(); }, [refresh]);
  // 진행 중인 수업이 있으면 그 채널 신호로, 없으면 4초마다 수업이 시작됐는지 확인
  const channel = v?.channel ?? null;
  useLiveChannel(channel, (c) => { if (!c || c.kind === 'phase') refresh(); });
  useEffect(() => {
    if (channel) return;
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [channel, refresh]);

  const showQ = v?.view === 'question' && !!v.question;
  const showR = v?.view === 'result' && !!v.result;
  // 문제 번역: 문제가 바뀌거나 정답이 공개되면(단답형 정답 글) 다시
  const qtr = useQuestionTr('current', showQ || showR ? `${v?.question?.id ?? ''}|${v?.result?.revealed ? 1 : 0}` : '', out);

  const idleText = !v ? IDLE_TEXT.loading : ended && !v.channel ? IDLE_TEXT.ended : v.status === 'closed' ? IDLE_TEXT.closed : IDLE_TEXT.waiting;
  const busy = showQ || showR;
  // 문제가 올라오면 다시 보기 화면은 닫고 문제부터
  if (review && busy) setReview(false);
  if (review) return <div className={`${s.page} ${s.blank}`}><ReviewList onClose={() => setReview(false)} onAuth={out} /><Settings me={me} online={online} onLogout={out} /></div>;
  const bar = <TrBar busy={qtr.busy} orig={qtr.orig} setOrig={qtr.setOrig} />;
  return (
    <div className={`${s.page} ${s.blank}`}>
      {showQ && v?.question && (
        <div className={s.wrap}><QuestionView key={v.question.id} q={v.question} tr={qtr.tr} bar={bar} onSubmitted={refresh} onAuth={out} /></div>
      )}
      {showR && v?.result && <div className={s.wrap}><ResultView r={v.result} q={v.question} tr={qtr.tr} bar={bar} /></div>}
      {!showQ && !showR && (
        <div className={s.idleWrap}>
          <div className={s.idle} role="status">
            <ManateeMark size={72} />
            <h2>{t(idleText[0])}</h2>
            <p>{t(idleText[1])}</p>
            {v && <button type="button" className={s.reviewBtn} onClick={() => setReview(true)}>{t('틀린 문제 다시 보기')}</button>}
          </div>
        </div>
      )}
      <Settings me={me} online={online} onLogout={out} />
    </div>
  );
}

/** 한 문제. need = 골라야 하는 답의 개수 (정답이 여러 개면 모두 골라야 정답). 제출은 언제나 선지 번호 · 입력한 글 그대로 */
function QuestionView({ q, tr, bar, onSubmitted, onAuth }: {
  q: NonNullable<View['question']>; tr: Tr; bar: React.ReactNode; onSubmitted: () => Promise<void>; onAuth: (why?: string) => void;
}) {
  const { t, lang } = useI18n();
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [sending, setSending] = useState(false);
  const mc = q.type === 'mc';
  const unsure = picked.includes(DONT_KNOW);
  const ready = mc ? unsure || picked.length === q.need : !!text.trim();

  function toggle(v: string) {
    setErr('');
    if (v === DONT_KNOW) return setPicked(picked.includes(DONT_KNOW) ? [] : [DONT_KNOW]);
    if (picked.includes(DONT_KNOW)) return setPicked([v]);
    if (q.need === 1) return setPicked([v]);
    if (picked.includes(v)) return setPicked(picked.filter((x) => x !== v));
    if (picked.length >= q.need) return setErr(t('답은 {n}개까지 고를 수 있어요. 바꾸려면 고른 답을 한 번 더 눌러 빼 주세요.', { n: q.need }));
    setPicked([...picked, v]);
  }

  async function submit() {
    if (!ready) return setErr(mc ? t('답을 {n}개 골라 주세요.', { n: q.need }) : t('답을 입력해 주세요.'));
    setSending(true);
    setErr('');
    try {
      await studentApi('studentSubmit', q.id, mc ? (unsure ? DONT_KNOW : picked.map(Number).sort((a, b) => a - b).join('|')) : text.trim());
      await onSubmitted();
    } catch (e) {
      if (isAuth(e)) return onAuth((e as Error).message);
      setErr(t((e as Error).message));
      setSending(false);
    }
  }

  return (
    <div className={s.card}>
      {bar}
      <div className={s.qno}>{t('{n}번 문제', { n: q.no })}</div>
      <div className={s.stem}>{tr(q.stem)}</div>
      <QuestionImage className={s.qimg} src={q.imageUrl} />
      {mc ? (
        <>
          <div className={s.need}>
            <span>{q.need > 1 ? rich(t('정답 {n}개를 모두 고르세요'), q.need) : rich(t('정답 {n}개를 고르세요'), 1)}</span>
            {q.need > 1 && <span className={s.needCount}>{picked.length} / {q.need}</span>}
          </div>
          {/* 그림 선지는 개수만큼 한 줄로 (선지 5개여도 두 줄로 넘어가 스크롤이 생기지 않게) */}
          <div className={`${s.choices} ${q.choiceImages?.some(Boolean) ? s.picChoices : ''}`}
            style={q.choiceImages?.some(Boolean) ? { gridTemplateColumns: `repeat(${q.choices.length}, minmax(0, 1fr))` } : undefined}>
            {q.choices.map((c, i) => {
              const v = String(i + 1), img = q.choiceImages?.[i] ?? '';
              return (
                <button key={v} type="button" className={`${s.ch} ${picked.includes(v) ? s.sel : ''}`} onClick={() => toggle(v)} aria-pressed={picked.includes(v)}>
                  <span className={s.n}>{CIRC[i]}</span>
                  {img && <QuestionImage className={s.chImg} src={img} alt={t('{n}번 보기 그림', { n: i + 1 })} />}
                  {c && <span>{tr(c)}</span>}
                </button>
              );
            })}
          </div>
          <button type="button" className={`${s.ch} ${s.dunno} ${unsure ? s.sel : ''}`} onClick={() => toggle(DONT_KNOW)} aria-pressed={unsure}>
            <span className={s.n}>?</span><span>{t(DONT_KNOW_LABEL)}</span>
          </button>
        </>
      ) : (
        <>
          <input className={s.inp} style={{ marginTop: 16 }} placeholder={t('답을 입력하세요')} maxLength={200}
            value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && submit()} />
          {/* 단답형은 원문(한국어) 정답과 비교해요 */}
          {lang !== 'ko' && <div className={s.trHint}>{t('답은 한국어나 숫자로 입력하세요. 정답은 한국어 원문과 비교해요.')}</div>}
        </>
      )}
      <button className={`${s.btn} ${s.submit}`} disabled={sending || !ready} onClick={submit}>
        {sending ? t('제출하는 중…') : mc && !ready ? t('답을 {n}개 고르면 제출할 수 있어요', { n: q.need }) : unsure ? t('모르겠어요로 제출하기') : t('제출하기')}
      </button>
      <div className={s.err} role="alert">{err}</div>
    </div>
  );
}

/**
 * 제출 후 · 정답 공개 (해설 없음)
 *  - 공개 전: '제출했어요' + 내가 고른 답
 *  - 공개 후: 정답 여부 + 내 답 · 정답 (안 낸 학생은 정답만)
 */
function ResultView({ r, q, tr, bar }: { r: NonNullable<View['result']>; q: View['question']; tr: Tr; bar: React.ReactNode }) {
  const { t } = useI18n();
  const mc = q ? q.type === 'mc' : /^\d+(\|\d+)*$/.test(r.answer ?? r.correctAnswer ?? '');
  const show = (x: string) => (mc ? circ(x, t(DONT_KNOW_LABEL)) : x);
  const mine = new Set(r.answer == null ? [] : nos(r.answer));
  const right = new Set(r.revealed && r.correctAnswer != null ? nos(r.correctAnswer) : []);
  const head = !r.revealed
    ? <div className={`${s.result} ${s.sent}`}>{t('제출했어요')}</div>
    : r.answer == null
      ? <div className={`${s.result} ${s.sent}`}>{t('이번 문제는 제출하지 않았어요')}</div>
      : <div className={`${s.result} ${r.correct ? s.o : s.x}`}>{r.correct ? t('정답이에요!') : t('오답이에요')}</div>;
  return (
    <div className={`${s.card} ${s.resultCard}`}>
      {head}
      <div className={s.cmp}>
        {r.answer != null && <div style={!r.revealed ? { gridColumn: '1 / -1' } : undefined}><span>{t('내가 고른 답')}</span><b>{show(r.answer)}</b></div>}
        {r.revealed && r.correctAnswer != null && (
          <div style={r.answer == null ? { gridColumn: '1 / -1' } : undefined}><span>{t('정답')}</span><b className={s.right}>{mc ? circ(r.correctAnswer, t(DONT_KNOW_LABEL)) : tr(nos(r.correctAnswer)[0] ?? '')}</b></div>
        )}
      </div>
      {/* 문제 원문 (제출한 뒤에도 다시 볼 수 있게) — 내가 고른 선지 · 공개 뒤에는 정답 선지 표시 */}
      {q && (
        <div className={s.review}>
          {bar}
          <div className={s.qno}>{t('{n}번 문제', { n: q.no })}</div>
          <div className={s.stem}>{tr(q.stem)}</div>
          <QuestionImage className={s.qimg} src={q.imageUrl} />
          {mc && (
            <div className={`${s.choices} ${q.choiceImages?.some(Boolean) ? s.picChoices : ''}`}
              style={q.choiceImages?.some(Boolean) ? { gridTemplateColumns: `repeat(${q.choices.length}, minmax(0, 1fr))` } : undefined}>
              {q.choices.map((c, i) => {
                const v = String(i + 1), img = q.choiceImages?.[i] ?? '';
                const cls = right.has(v) ? s.ans : mine.has(v) ? (r.revealed ? s.wrong : s.sel) : '';
                return (
                  <div key={v} className={`${s.ch} ${s.ro} ${cls}`}>
                    <span className={s.n}>{CIRC[i]}</span>
                    {img && <QuestionImage className={s.chImg} src={img} alt={t('{n}번 보기 그림', { n: i + 1 })} />}
                    {c && <span>{tr(c)}</span>}
                    {mine.has(v) && <em className={s.mineTag}>{t('내 답')}</em>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      <div className={s.doneSub}>{r.revealed ? t('다음 문제가 올라오면 이 화면에 바로 나타나요') : t('선생님이 정답을 공개하면 결과가 여기에 나타나요')}</div>
    </div>
  );
}

/* ---------------- 틀린 문제 다시 보기 ---------------- */
function ReviewList({ onClose, onAuth }: { onClose: () => void; onAuth: (why?: string) => void }) {
  const { t } = useI18n();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    studentApi<ReviewItem[]>('studentReview').then((r) => { setItems(r); setOpen(r[0]?.id ?? null); })
      .catch((e) => (isAuth(e) ? onAuth((e as Error).message) : setErr((e as Error).message)));
  }, [onAuth]);
  const qtr = useQuestionTr('review', items?.length ? 'review' : '', onAuth);
  const tr = qtr.tr;
  const day = (d: string) => { const [, m, dd] = d.split('-').map(Number); return m && dd ? `${m}/${dd}` : d; };
  return (
    <div className={s.wrap}>
      <div className={s.rvHead}>
        <button type="button" className={s.linkBtn} style={{ margin: 0 }} onClick={onClose}>‹ {t('돌아가기')}</button>
        <h1>{t('틀린 문제 다시 보기')}</h1>
        {items && <span className={s.rvCount}>{t('{n}문제', { n: items.length })}</span>}
      </div>
      {!!items?.length && <TrBar busy={qtr.busy} orig={qtr.orig} setOrig={qtr.setOrig} />}
      {err && <div className={s.err} role="alert">{t(err)}</div>}
      {!items && !err && <div className={s.rvEmpty}>{t('불러오는 중이에요…')}</div>}
      {items && !items.length && <div className={s.rvEmpty}>{t('끝난 수업에서 틀린 문제가 없어요. 잘했어요!')}</div>}
      {items?.map((it) => {
        const mc = it.type === 'mc', isOpen = open === it.id;
        const mine = new Set(nos(it.answer)), right = new Set(nos(it.correctAnswer));
        return (
          <div key={it.id} className={`${s.card} ${s.rvItem}`}>
            <button type="button" className={s.rvTop} onClick={() => setOpen(isOpen ? null : it.id)} aria-expanded={isOpen}>
              <span className={s.rvMeta}>{day(it.date)}{it.lesson ? ` · ${it.lesson}` : ''}{it.wrongCount > 1 ? <em>{t('{n}번 틀림', { n: it.wrongCount })}</em> : null}</span>
              <span className={s.rvStem}>{tr(it.stem)}</span>
              <span className={s.rvArr}>{isOpen ? `${t('접기')} ▲` : `${t('보기')} ▼`}</span>
            </button>
            {isOpen && (
              <div className={s.rvBody}>
                <div className={s.cmp}>
                  <div><span>{t('내가 고른 답')}</span><b className={s.rvMine}>{mc ? circ(it.answer, t(DONT_KNOW_LABEL)) : it.answer}</b></div>
                  <div><span>{t('정답')}</span><b className={s.right}>{mc ? circ(it.correctAnswer, t(DONT_KNOW_LABEL)) : tr(nos(it.correctAnswer)[0] ?? '')}</b></div>
                </div>
                <QuestionImage className={s.qimg} src={it.imageUrl} />
                {mc && (
                  <div className={`${s.choices} ${it.choiceImages.some(Boolean) ? s.picChoices : ''}`}
                    style={it.choiceImages.some(Boolean) ? { gridTemplateColumns: `repeat(${it.choices.length}, minmax(0, 1fr))` } : undefined}>
                    {it.choices.map((c, i) => {
                      const v = String(i + 1), img = it.choiceImages[i] ?? '';
                      return (
                        <div key={v} className={`${s.ch} ${s.ro} ${right.has(v) ? s.ans : mine.has(v) ? s.wrong : ''}`}>
                          <span className={s.n}>{CIRC[i]}</span>
                          {img && <QuestionImage className={s.chImg} src={img} alt={t('{n}번 보기 그림', { n: i + 1 })} />}
                          {c && <span>{tr(c)}</span>}
                          {mine.has(v) && <em className={s.mineTag}>{t('내 답')}</em>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- 설정 (왼쪽 아래) ---------------- */
function Settings({ me, online, onLogout }: { me: Profile; online: boolean; onLogout: (why?: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ t: string; ok?: boolean } | null>(null);

  async function changePw(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await studentApi('studentPassword', cur, next);
      setCur(''); setNext('');
      setMsg({ t: '비밀번호를 바꿨어요.', ok: true });
    } catch (e) {
      if (isAuth(e)) return onLogout((e as Error).message);
      setMsg({ t: (e as Error).message });
    }
  }
  async function logout() {
    try { await studentApi('studentLogout'); } catch { /* 쿠키는 다음 요청 때 정리 */ }
    onLogout();
  }

  return (
    <>
      <button className={s.gear} onClick={() => setOpen(!open)} aria-label={t('설정')} title={t('설정')}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" strokeLinejoin="round" /><circle cx="12" cy="12" r="3" />
        </svg>
        {!online && <i className={`${s.gearDot} ${s.off}`} />}
      </button>
      {open && (
        <div className={s.panel}>
          <div className={s.who}><b>{me.studentNo} {me.name}</b>{!online && <span className={s.offTxt}> · {t('연결 끊김')}</span>}</div>
          <LangPicker className={`${s.lang} ${s.langSm}`} />
          <form onSubmit={changePw}>
            <input className={s.inpSm} type="password" placeholder={t('지금 비밀번호')} value={cur} onChange={(e) => setCur(e.target.value)} />
            <input className={s.inpSm} type="password" placeholder={t('새 비밀번호 (4자 이상)')} value={next} onChange={(e) => setNext(e.target.value)} />
            <button className={s.btnSm}>{t('비밀번호 바꾸기')}</button>
          </form>
          {msg && <div className={msg.ok ? s.okTxt : s.err} style={{ textAlign: 'start' }}>{t(msg.t)}</div>}
          <button className={`${s.btnSm} ${s.ghost}`} onClick={logout}>{t('로그아웃')}</button>
        </div>
      )}
    </>
  );
}
