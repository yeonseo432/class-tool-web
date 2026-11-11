'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { LANGS, langOf } from '@/lib/langs';

/*
 * 학생 화면 글자 번역
 *  - 화면 글자는 한국어 원문을 그대로 열쇠로 써요: t('수업 참여하기') → 고른 언어 글 (없으면 한국어 그대로)
 *  - 번역 파일: public/i18n/student/<언어>.json  { "한국어": "번역" }
 *    글자를 바꾸거나 t('…') 를 새로 쓰면 `npm run i18n:student` 로 빠진 것만 번역해 채워요 (OpenAI).
 *  - 서버 오류 문구(ApiError)도 같은 파일에 들어 있어 t(e.message) 로 바꿔 보여 줘요.
 *  - {n} 같은 자리는 t('답을 {n}개 골라 주세요.', { n: 2 })
 *  - 고른 언어는 이 기기에 기억 (localStorage st_lang) → 로그인 화면부터 문제 화면까지 이어져요.
 */

const KEY = 'st_lang';
const read = () => { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } };
const write = (v: string) => { try { localStorage.setItem(KEY, v); } catch { /* 사생활 보호 모드 등 */ } };
const dicts = new Map<string, Record<string, string>>();

type Vars = Record<string, string | number>;
const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

type Ctx = { lang: string; rtl: boolean; setLang: (code: string) => void; t: (ko: string, vars?: Vars) => string };
const I18n = createContext<Ctx>({ lang: 'ko', rtl: false, setLang: () => {}, t: fill });

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // 처음 그릴 때(서버 · 하이드레이션)는 빈 화면이라 기기에 기억한 언어를 바로 써도 어긋나지 않아요
  const [lang, setLangState] = useState(() => (typeof window === 'undefined' ? 'ko' : langOf(read())?.code ?? 'ko'));
  const [, loaded] = useState(0);   // 사전을 받으면 다시 그리기

  useEffect(() => {
    document.documentElement.lang = lang;
    if (lang === 'ko' || dicts.has(lang)) return;
    fetch(`/i18n/student/${lang}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
      .then((d: Record<string, string>) => { dicts.set(lang, d); loaded((n) => n + 1); });
  }, [lang]);

  // 사전을 받기 전에는 한국어 그대로
  const cur = dicts.get(lang) ?? {};
  const value: Ctx = {
    lang,
    rtl: !!langOf(lang)?.rtl,
    setLang: (code) => { if (!langOf(code)) return; write(code); setLangState(code); },
    t: (ko, vars) => fill((lang !== 'ko' && cur[ko]) || ko, vars),
  };
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export const useI18n = () => useContext(I18n);

/** 언어 고르기 (로그인 화면 · 설정) */
export function LangPicker({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <label className={className} title="Language · 언어">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={`Language · ${t('언어')}`}>
        {LANGS.map((l) => <option key={l.code} value={l.code}>{l.native}{l.code === 'ko' ? '' : ` · ${l.ko}`}</option>)}
      </select>
    </label>
  );
}
