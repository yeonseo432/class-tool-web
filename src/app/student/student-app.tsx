'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import QuestionImage from '@/components/question-image';
import { ManateeMark } from '@/components/manatee';
import { CIRC, DONT_KNOW, DONT_KNOW_LABEL } from '@/lib/live';
import { RpcError, studentApi } from '@/lib/rpc';
import { useLiveChannel } from '@/lib/use-live-channel';
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
const circ = (a: string) => (a.trim() === DONT_KNOW ? DONT_KNOW_LABEL : nos(a).map((x) => CIRC[Number(x) - 1] ?? x).join(' '));

export default function StudentApp() {
  const [me, setMe] = useState<Profile | null | undefined>(undefined);   // undefined: 확인 중
  const [notice, setNotice] = useState('');
  /** 로그아웃 (이유가 있으면 로그인 화면에 안내) */
  const out = useCallback((why?: string) => { setNotice(why ?? ''); setMe(null); }, []);

  useEffect(() => {
    studentApi<Profile | null>('studentMe').then(setMe).catch((e) => out(isAuth(e) ? (e as Error).message : ''));
  }, [out]);

  if (me === undefined) return <div className={s.page} />;
  if (!me) return <LoginView notice={notice} onLogin={(p) => { setNotice(''); setMe(p); }} />;
  return <MainView me={me} out={out} />;
}

/* ---------------- 로그인 ---------------- */
function LoginView({ notice, onLogin }: { notice: string; onLogin: (p: Profile) => void }) {
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
    if (f.code.length !== 4) return setErr('학습코드 4자리를 입력해 주세요.');
    if (f.studentNo.length < 4) return setErr('학번을 입력해 주세요. (예: 30301)');
    if (!f.pw) return setErr('비밀번호를 입력해 주세요.');
    if (step === 'newpw') {
      if (np.a.length < 4) return setErr('새 비밀번호를 4자 이상으로 정해 주세요.');
      if (np.a !== np.b) return setErr('새 비밀번호 두 칸이 서로 달라요.');
    }
    setBusy(true);
    setErr('');
    try {
      const r = await studentApi<Login>('studentLogin', f.code, f.studentNo, f.pw, step === 'newpw' ? np.a : undefined);
      store.set('st_code', f.code); store.set('st_sno', f.studentNo);
      if (r.needNewPassword) { setStep('newpw'); setBusy(false); return; }
      onLogin(r);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  if (step === 'newpw') {
    return (
      <div className={s.page}>
        <div className={s.wrap}>
          <form className={`${s.card} ${s.join}`} onSubmit={login}>
            <h1>내 비밀번호 정하기</h1>
            <p>학번 {f.studentNo} · 처음 로그인이에요.<br />
              앞으로 쓸 비밀번호를 정해 주세요. 친구가 알 수 있는 생일 · 번호 같은 건 피해 주세요.</p>
            <input className={s.inp} type="password" placeholder="새 비밀번호 (4자 이상)" value={np.a} maxLength={30} autoFocus
              onChange={(e) => setNp({ ...np, a: e.target.value })} autoComplete="new-password" />
            <input className={s.inp} type="password" placeholder="새 비밀번호 한 번 더" value={np.b} maxLength={30}
              onChange={(e) => setNp({ ...np, b: e.target.value })} autoComplete="new-password" />
            <button className={s.btn} disabled={busy}>{busy ? '저장하는 중…' : '정하고 들어가기'}</button>
            <div className={s.err} role="alert">{err}</div>
            <button type="button" className={s.linkBtn} onClick={() => { setStep('login'); setErr(''); setNp({ a: '', b: '' }); }}>‹ 처음으로</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className={s.page}>
      <div className={s.wrap}>
        <form className={`${s.card} ${s.join}`} onSubmit={login}>
          <h1>수업 참여하기</h1>
          <p>선생님이 알려 준 학습코드와 학번, 비밀번호를 입력하세요.</p>
          {notice && <div className={s.warn} role="status" style={{ marginBottom: 12 }}>{notice}</div>}
          <input className={`${s.inp} ${s.codeInp}`} inputMode="numeric" maxLength={4} placeholder="학습코드 4자리" value={f.code} onChange={set('code')} aria-label="학습코드" autoComplete="off" />
          <input className={s.inp} inputMode="numeric" maxLength={8} placeholder="학번 (예: 30301)" value={f.studentNo} onChange={set('studentNo')} aria-label="학번" autoComplete="username" />
          <input className={s.inp} type="password" placeholder="비밀번호 (처음엔 선생님이 준 6자리)" value={f.pw} maxLength={30} onChange={set('pw')} autoComplete="current-password" />
          <button className={s.btn} disabled={busy}>{busy ? '확인하는 중…' : '들어가기'}</button>
          <div className={s.err} role="alert">{err}</div>
        </form>
      </div>
    </div>
  );
}

/* ---------------- 수업 화면 (평소엔 빈 화면) ---------------- */
function MainView({ me, out }: { me: Profile; out: (why?: string) => void }) {
  const [v, setV] = useState<View | null>(null);
  const [online, setOnline] = useState(true);
  const inflight = useRef(false), again = useRef(false);
  // 수업 중이던 채널이 사라지면(=교사가 수업 종료) '수업이 끝났어요'
  const lastChannel = useRef<string | null>(null);
  const [ended, setEnded] = useState(false);

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

  const idleText = !v ? IDLE_TEXT.loading : ended && !v.channel ? IDLE_TEXT.ended : v.status === 'closed' ? IDLE_TEXT.closed : IDLE_TEXT.waiting;
  return (
    <div className={`${s.page} ${s.blank}`}>
      {v?.view === 'question' && v.question && (
        <div className={s.wrap}><QuestionView key={v.question.id} q={v.question} onSubmitted={refresh} onAuth={out} /></div>
      )}
      {v?.view === 'result' && v.result && <div className={s.wrap}><ResultView r={v.result} q={v.question} /></div>}
      {!(v?.view === 'question' && v.question) && !(v?.view === 'result' && v.result) && (
        <div className={s.idleWrap}>
          <div className={s.idle} role="status">
            <ManateeMark size={72} />
            <h2>{idleText[0]}</h2>
            <p>{idleText[1]}</p>
          </div>
        </div>
      )}
      <Settings me={me} online={online} onLogout={out} />
    </div>
  );
}

/** 한 문제. need = 골라야 하는 답의 개수 (정답이 여러 개면 모두 골라야 정답) */
function QuestionView({ q, onSubmitted, onAuth }: { q: NonNullable<View['question']>; onSubmitted: () => Promise<void>; onAuth: (why?: string) => void }) {
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
    if (picked.length >= q.need) return setErr(`답은 ${q.need}개까지 고를 수 있어요. 바꾸려면 고른 답을 한 번 더 눌러 빼 주세요.`);
    setPicked([...picked, v]);
  }

  async function submit() {
    if (!ready) return setErr(mc ? `답을 ${q.need}개 골라 주세요.` : '답을 입력해 주세요.');
    setSending(true);
    setErr('');
    try {
      await studentApi('studentSubmit', q.id, mc ? (unsure ? DONT_KNOW : picked.map(Number).sort((a, b) => a - b).join('|')) : text.trim());
      await onSubmitted();
    } catch (e) {
      if (isAuth(e)) return onAuth((e as Error).message);
      setErr((e as Error).message);
      setSending(false);
    }
  }

  return (
    <div className={s.card}>
      <div className={s.qno}>{q.no}번 문제</div>
      <div className={s.stem}>{q.stem}</div>
      <QuestionImage className={s.qimg} src={q.imageUrl} />
      {mc ? (
        <>
          <div className={s.need}>
            <span>{q.need > 1 ? <>정답 <b>{q.need}개</b>를 모두 고르세요</> : <>정답 <b>1개</b>를 고르세요</>}</span>
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
                  {img && <QuestionImage className={s.chImg} src={img} alt={`${i + 1}번 보기 그림`} />}
                  {c && <span>{c}</span>}
                </button>
              );
            })}
          </div>
          <button type="button" className={`${s.ch} ${s.dunno} ${unsure ? s.sel : ''}`} onClick={() => toggle(DONT_KNOW)} aria-pressed={unsure}>
            <span className={s.n}>?</span><span>{DONT_KNOW_LABEL}</span>
          </button>
        </>
      ) : (
        <input className={s.inp} style={{ marginTop: 16 }} placeholder="답을 입력하세요" maxLength={200}
          value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && submit()} />
      )}
      <button className={`${s.btn} ${s.submit}`} disabled={sending || !ready} onClick={submit}>
        {sending ? '제출하는 중…' : mc && !ready ? `답을 ${q.need}개 고르면 제출할 수 있어요` : unsure ? '모르겠어요로 제출하기' : '제출하기'}
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
function ResultView({ r, q }: { r: NonNullable<View['result']>; q: View['question'] }) {
  const mc = q ? q.type === 'mc' : /^\d+(\|\d+)*$/.test(r.answer ?? r.correctAnswer ?? '');
  const show = (x: string) => (mc ? circ(x) : x);
  const mine = new Set(r.answer == null ? [] : nos(r.answer));
  const right = new Set(r.revealed && r.correctAnswer != null ? nos(r.correctAnswer) : []);
  const head = !r.revealed
    ? <div className={`${s.result} ${s.sent}`}>제출했어요</div>
    : r.answer == null
      ? <div className={`${s.result} ${s.sent}`}>이번 문제는 제출하지 않았어요</div>
      : <div className={`${s.result} ${r.correct ? s.o : s.x}`}>{r.correct ? '정답이에요!' : '오답이에요'}</div>;
  return (
    <div className={`${s.card} ${s.resultCard}`}>
      {head}
      <div className={s.cmp}>
        {r.answer != null && <div style={!r.revealed ? { gridColumn: '1 / -1' } : undefined}><span>내가 고른 답</span><b>{show(r.answer)}</b></div>}
        {r.revealed && r.correctAnswer != null && (
          <div style={r.answer == null ? { gridColumn: '1 / -1' } : undefined}><span>정답</span><b className={s.right}>{mc ? circ(r.correctAnswer) : nos(r.correctAnswer)[0] ?? ''}</b></div>
        )}
      </div>
      {/* 문제 원문 (제출한 뒤에도 다시 볼 수 있게) — 내가 고른 선지 · 공개 뒤에는 정답 선지 표시 */}
      {q && (
        <div className={s.review}>
          <div className={s.qno}>{q.no}번 문제</div>
          <div className={s.stem}>{q.stem}</div>
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
                    {img && <QuestionImage className={s.chImg} src={img} alt={`${i + 1}번 보기 그림`} />}
                    {c && <span>{c}</span>}
                    {mine.has(v) && <em className={s.mineTag}>내 답</em>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      <div className={s.doneSub}>{r.revealed ? '다음 문제가 올라오면 이 화면에 바로 나타나요' : '선생님이 정답을 공개하면 결과가 여기에 나타나요'}</div>
    </div>
  );
}

/* ---------------- 설정 (왼쪽 아래) ---------------- */
function Settings({ me, online, onLogout }: { me: Profile; online: boolean; onLogout: (why?: string) => void }) {
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
      <button className={s.gear} onClick={() => setOpen(!open)} aria-label="설정" title="설정">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
        </svg>
        {!online && <i className={`${s.gearDot} ${s.off}`} />}
      </button>
      {open && (
        <div className={s.panel}>
          <div className={s.who}><b>{me.studentNo} {me.name}</b>{!online && <span className={s.offTxt}> · 연결 끊김</span>}</div>
          <div className={s.hint}>다른 기기에서 내 이름으로 로그인하면 이 기기는 로그아웃돼요. 그런 적이 없는데 로그아웃됐다면 비밀번호를 바꾸고 선생님께 알려 주세요.</div>
          <form onSubmit={changePw}>
            <input className={s.inpSm} type="password" placeholder="지금 비밀번호" value={cur} onChange={(e) => setCur(e.target.value)} />
            <input className={s.inpSm} type="password" placeholder="새 비밀번호 (4자 이상)" value={next} onChange={(e) => setNext(e.target.value)} />
            <button className={s.btnSm}>비밀번호 바꾸기</button>
          </form>
          {msg && <div className={msg.ok ? s.okTxt : s.err} style={{ textAlign: 'left' }}>{msg.t}</div>}
          <button className={`${s.btnSm} ${s.ghost}`} onClick={logout}>로그아웃</button>
        </div>
      )}
    </>
  );
}

