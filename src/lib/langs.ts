/*
 * 학생 화면 언어 (서버 · 브라우저 모두 사용)
 *  - ko 가 원문. 나머지는 화면 글자(public/i18n/student/<code>.json)와 문제 번역(OpenAI · translations 표 캐시)에 써요.
 *  - 정답 판정은 언제나 원문(한국어) 기준이에요. 번역은 보여 주기만.
 *  - 언어를 더하려면 여기에 한 줄 넣고 `npm run i18n:student` 로 화면 글자 번역 파일을 만들어요.
 */
export type Lang = {
  code: string;
  /** 그 언어로 쓴 이름 (고르는 목록에 보여 줌) */
  native: string;
  /** 한국어 이름 (선생님 · 관리자용) */
  ko: string;
  /** 번역 프롬프트에 쓰는 영어 이름 */
  en: string;
  rtl?: boolean;
};

export const LANGS: Lang[] = [
  { code: 'ko', native: '한국어', ko: '한국어', en: 'Korean' },
  { code: 'en', native: 'English', ko: '영어', en: 'English' },
  { code: 'ja', native: '日本語', ko: '일본어', en: 'Japanese' },
  { code: 'zh', native: '中文 (简体)', ko: '중국어', en: 'Simplified Chinese' },
  { code: 'vi', native: 'Tiếng Việt', ko: '베트남어', en: 'Vietnamese' },
  { code: 'ru', native: 'Русский', ko: '러시아어', en: 'Russian' },
  { code: 'bn', native: 'বাংলা', ko: '벵골어', en: 'Bengali' },
  { code: 'mn', native: 'Монгол', ko: '몽골어', en: 'Mongolian (Cyrillic script)' },
  { code: 'uz', native: 'Oʻzbekcha', ko: '우즈베크어', en: 'Uzbek (Latin script)' },
  { code: 'kk', native: 'Қазақша', ko: '카자흐어', en: 'Kazakh (Cyrillic script)' },
  { code: 'ky', native: 'Кыргызча', ko: '키르기스어', en: 'Kyrgyz' },
  { code: 'tg', native: 'Тоҷикӣ', ko: '타지크어', en: 'Tajik (Cyrillic script)' },
  { code: 'km', native: 'ភាសាខ្មែរ', ko: '크메르어', en: 'Khmer' },
  { code: 'th', native: 'ไทย', ko: '태국어', en: 'Thai' },
  { code: 'id', native: 'Bahasa Indonesia', ko: '인도네시아어', en: 'Indonesian' },
  { code: 'tl', native: 'Filipino', ko: '필리핀어', en: 'Filipino (Tagalog)' },
  { code: 'my', native: 'မြန်မာ', ko: '미얀마어', en: 'Burmese' },
  { code: 'ne', native: 'नेपाली', ko: '네팔어', en: 'Nepali' },
  { code: 'ur', native: 'اردو', ko: '우르두어', en: 'Urdu', rtl: true },
  { code: 'ar', native: 'العربية', ko: '아랍어', en: 'Arabic (Modern Standard)', rtl: true },
  { code: 'fr', native: 'Français', ko: '프랑스어', en: 'French' },
  { code: 'ln', native: 'Lingála', ko: '링갈라어 (콩고)', en: 'Lingala' },
  { code: 'sw', native: 'Kiswahili', ko: '스와힐리어', en: 'Swahili' },
  { code: 'es', native: 'Español', ko: '스페인어', en: 'Spanish' },
  { code: 'pt', native: 'Português', ko: '포르투갈어', en: 'Portuguese' },
];

export const langOf = (code: unknown): Lang | undefined => LANGS.find((l) => l.code === code);
