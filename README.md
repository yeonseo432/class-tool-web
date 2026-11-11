# 수업도구 (Vercel + Supabase)

Google Apps Script + 구글 시트로 만든 **수업도구**(실시간 문제풀이 · 개념지도 · 형성평가 분석)를
Next.js(Vercel) + Supabase(Postgres · Auth · Realtime · Storage)로 옮기는 프로젝트예요.

- 원본 코드: [`legacy/gas/`](legacy/gas) (Apps Script 프로젝트 "수업도구"에서 clasp로 받은 것, 참고용)
- 원본 데이터: 구글 시트 "수업도구 DB" → `data/sheet-export.xlsx` (학생 이름이 있어 git에서 제외)
- 팀원 작업 · GitHub에 올리는 법: [`CONTRIBUTING.md`](CONTRIBUTING.md)

## 폴더 구조

```
src/
  app/
    login/             교사 로그인 · 가입 (Supabase Auth, 이메일+비밀번호)
    auth/confirm/      가입 인증 메일 링크 처리
    auth/signout/      로그아웃 (POST)
    api/teacher/       교사 기능 호출 창구  POST { fn, args }
    api/student/       학생 기능 호출 창구 (로그인 없음)
    teacher/           교사 화면 — 골격(teacher-app.tsx) + 스타일(teacher.css)
    teacher/widget/    수업 위젯
    student/           학생 태블릿 화면
  server/
    core.ts            Ctx(교사 세션) · ApiError · all()(1000행 넘는 목록 나눠 가져오기) · 공통 함수
    mappers.ts         DB 행 → 기존 시트 열 이름(camelCase) 객체
    api/               legacy Code.js · Analysis.js 기능별 이전 (bank, classes, live, concepts, misconceptions, settings, bootstrap, analysis)
    student.ts         학생 참여 · 상태 · 제출
    realtime.ts        수업 화면에 "바뀌었어요" 신호 보내기
  lib/
    database.types.ts  DB 타입 (npm run db:types 로 다시 생성)
    supabase/          client · server · admin · proxy 클라이언트
  proxy.ts             Next.js 16 Proxy (구 middleware)
public/teacher-app/
  app.js               교사 화면 스크립트 (legacy Index.html 거의 그대로) — 문제은행 · 수업하기 · 개념지도 · 설정
  analysis.js          교사 화면 스크립트 (legacy AnalysisUI.html 거의 그대로) — 형성평가 분석 · 오개념 목록 · 중간고사 출제
supabase/migrations/   DB 스키마 (시트 탭 → 테이블, 문제 이미지 버킷)
scripts/
  import-sheet.mjs         구글 시트 → Supabase 데이터 이전
  smoke-teacher-api.mjs    교사 API 통합 시험 (임시 교사 2명 만들고 끝나면 삭제)
  smoke-live.mjs           실시간 수업 통합 시험
  parity-analysis.mjs      통계 결과가 원본 Analysis.js 와 같은지 비교
legacy/gas/            원본 Apps Script 코드
```

## 교사 화면

원래 앱의 화면 코드(`legacy/gas/Index.html`, `AnalysisUI.html`)를 거의 그대로 `public/teacher-app/` 으로 옮겼어요.
선생님들이 쓰던 화면 · 동작이 똑같고, 바뀐 곳은 각 파일 맨 위 주석에 적혀 있어요 (서버 호출 · 로그인 · 주소 · 설정의 키 입력 · 로그아웃).
`src/app/teacher/teacher-app.tsx` 가 화면 골격을 그리고 두 스크립트를 순서대로 불러와요 (두 파일은 전역 범위를 공유하는 일반 스크립트).
나중에 React로 바꾸고 싶으면 메뉴(화면) 하나씩 옮기면 돼요.

## 교사 API (`POST /api/teacher`)

화면에서 `fetch('/api/teacher', { method: 'POST', body: JSON.stringify({ fn: 'bootstrap', args: [] }) })`.
응답은 `{ ok: true, data }` 또는 `{ ok: false, error }` (로그인 필요 시 401 · `code: 'AUTH'`).
기능 이름 · 인자 · 반환 형식은 legacy `Code.js` 의 `API` 와 같아요 (목록: `src/server/api/index.ts`).

| 기존 (GAS) | 지금 |
|---|---|
| 교사 비밀번호 1개 + 공용 TOKEN | 교사마다 Supabase 계정, 세션 쿠키 |
| 설정 화면에서 OpenAI 키 입력 | Vercel 환경변수 `OPENAI_API_KEY` (화면에서 입력하면 안내 메시지) |
| 이미지 → 구글 드라이브 | Supabase Storage `question-images/<교사 uid>/…` (공개 읽기) |
| 실시간 상태 → CacheService | `live_sessions` · `live_joins` · `responses(session_id)` |
| `aiChat` · `aiFormat` · 문항 분석 · 출제 조언 | `src/server/openai.ts` (OpenAI Chat Completions JSON 모드, 프롬프트는 원본 그대로). 키가 없으면 안내 메시지, `aiFormat` 은 규칙 기반 정리 |

시험: `npm run build && npx next start -p 3123` 를 띄운 뒤 `npm run smoke:teacher -- http://localhost:3123`

## 실시간 수업

| 화면 | 주소 | 로그인 |
|---|---|---|
| 교사 수업 위젯 (PPT 옆 작은 창) | `/teacher/widget?lesson=<차시 id>` — 교사 화면의 [수업 시작] | 교사 쿠키 (기존 `?t=TOKEN` 없앰) |
| 학생 태블릿 | `/student` | 학년 · 반 · 번호 · 이름 + 비밀번호, 교사의 학생 명단에 있어야 함 (4자리 코드 입장은 없앰) |

- 학생 API: `POST /api/student { fn: studentJoin | studentState | studentSubmit, args }` — secret key로 동작하므로
  `src/server/student.ts` 에서 코드 · 단계 · 문제 id · 보기 번호를 직접 검증. 정답 · 해설은 '정답 공개' 단계에서만 보냄.
- 갱신: 교사 조작 · 학생 참여 · 제출 때 서버가 Supabase Realtime Broadcast(`live-<세션 uuid>`, 이벤트 `changed`)로 신호 →
  화면이 새로 불러옴 (`src/lib/use-live-channel.ts`). 놓친 신호 대비 폴링: 위젯 5초 · 학생 15초.
- QR은 외부 서비스(api.qrserver.com) 대신 브라우저에서 생성.
- 시험: `npm run smoke:live -- http://localhost:3123` · 통계 비교: `npm run parity:analysis -- http://localhost:3123`

## 시트 → 테이블 대응

| 시트 탭 | 테이블 | 비고 |
|---|---|---|
| Folders | `folders` | `parentId ''` → `parent_id null` |
| Questions | `questions` | `choices`·`misconceptions`·`conceptIds` → `text[]`, `analysis` → `jsonb` |
| Semesters | `semesters` | |
| Holidays | `holidays` | PK (owner_id, date) |
| Classes | `classes` | `schedule` → `jsonb` |
| Lessons | `lessons` | `questionIds` → `text[]`, `done` → `date` |
| Concepts | `concepts` | `desc` → `description` |
| Links | `links` | `from`/`to` → `from_id`/`to_id` |
| Misconceptions | `misconceptions` | |
| Responses | `responses` | `correct` → `boolean`, 같은 수업·문제·학생 중복 제출은 DB가 막음 |
| (CacheService · Script Properties) | `live_sessions`, `live_joins` | 실시간 수업 상태 |
| (Script Properties `OPENAI_MODEL`) | `teacher_settings` | API 키는 환경변수 `OPENAI_API_KEY` |

기존 id(`q_…`, `f_…` 등)를 그대로 PK로 써요. 모든 테이블에 `owner_id`가 있고
RLS로 **교사마다 자기 데이터만** 보게 돼요. 학생은 로그인 없이 `/api/student/*`(서버)만 거쳐요.

## 처음 설정

```bash
npm install
cp .env.example .env.local     # 값 채우기 (또는 vercel env pull .env.local)
```

Supabase 프로젝트에 스키마 적용:

```bash
npx supabase login
npx supabase link --project-ref <프로젝트 ref>
npm run db:push
```

시트 데이터 옮기기 (교사 계정으로 먼저 가입한 뒤):

```bash
npm run import:sheet -- --file data/sheet-export.xlsx --dry-run          # 변환 결과만 확인
npm run import:sheet -- --file data/sheet-export.xlsx --email 교사@이메일  # 실제로 넣기
```

개발 서버: `npm run dev`

### 내 컴퓨터에서만 돌려 보기 (운영 DB와 분리)

Docker Desktop 을 켠 뒤:

```bash
npm run local:up      # 로컬 Supabase 켜기 + 마이그레이션 전부 적용 + .env.development.local 생성
npm run local:demo    # 시험용 교사(teacher@local.test / local-teacher-1) · 1학년 3반 학생 5명 · 클래스 · 오늘 차시
npm run dev           # http://localhost:3000 — .env.development.local 이 있으면 로컬 DB 를 써요
npm run local:down    # 끄고 .env.development.local 삭제 → npm run dev 가 다시 운영 DB 를 써요
```

`npm run local:reset` 은 로컬 DB 를 비우고 처음부터. 로컬이 켜져 있으면 `smoke:*` · `parity:analysis` 도 로컬 DB 로 돌아요.
`npm run build && npm start`(운영 모드)는 .env.development.local 을 읽지 않으니 로컬 확인은 `npm run dev` 로 하세요.

## 7단계 변경 (학생 명단 · 학생 로그인 · 오개념 · 출제 가이드)

DB에 `supabase/migrations/20261113000000_roster_choice_mis.sql`, `20261114000000_student_security.sql` 을 적용해야 해요 (`npm run db:push`).

- **학생 목록 관리** (수업하기 › 학생 목록 관리): 학교 › 학년 › 반 › 학생(번호 · 이름). 엑셀 두 열 붙여넣기, 비밀번호 0000 초기화.
  테이블 `homerooms` · `students`, `classes.homeroom_id`. [수업 추가하기]에서 반을 고르면 연결되고, 형성평가 분석의 학생 탭도 명단 기준(응답 없는 학생 포함).
- **학생 화면** (`src/app/student`, `src/server/student.ts`, `src/server/student-auth.ts`): 로그인 쿠키는 서명한 httpOnly 쿠키
  (`STUDENT_SESSION_SECRET` 환경변수, 없으면 `SUPABASE_SECRET_KEY` 로 서명). 같은 학년반번호이름이 여러 선생님 명단에 있으면 함께 로그인.
  평소엔 빈 화면 → [문제 출제하기] → 제출하면 고른 답 · 정답(해설 없음) → [제출 마감]이면 빈 화면. 학생은 자기 반 클래스의 진행 중인 수업(`live_sessions.class_id`)에 자동으로 들어가요.
- **복수 정답**: 객관식 정답이 '1|3' 이면 학생은 정답 개수만큼 골라야 제출할 수 있고, 모두 맞아야 정답.
- **선지별 오개념 여러 개**: `questions.choice_mis_ids[i]` = ',' 로 이은 id, `misconceptions[i]` = 줄바꿈으로 이은 이름. 문항 단위 '드러난 오개념'(`mis_ids`)은 화면에서 없앰.
  오개념 이름을 바꾸거나 지우면 연결된 선지도 함께 정리(`syncQuestionMis`).
- **문제 편집**: 더블클릭 수정(발문 · 그림 상황 · 선지 · 해설 · 오개념), Ctrl+S 저장, 오개념 입력 후 Enter → 개념 범주 고르기, 오개념을 다른 개념으로 끌면 이동 · Ctrl(⌥)+끌기는 복제.
- **뒤로 가기**: 브라우저 뒤로/앞으로 가기가 화면 · 문제은행 폴더 · 편집 창에 맞게 동작, [‹ 상위 폴더] · [‹ 문제 목록] 버튼, Backspace = 상위 폴더.
- **개념 지도**: 마우스 휠 · 터치패드 오므리기 · 버튼으로 확대/축소, 빈 곳 끌기로 화면 이동, [자동 배치] 방사형 · 관계망 · 원형.
- **정기고사 출제 가이드**: 학생 능력 · 절대 난이도 · 예상 점수 분포 · 집단 분류를 없애고, 개념의 상대 순위(아래 1/3 약점 · 위 1/3 강점)와
  오개념 선택 비율(고른 응답 ÷ 노출된 응답)로 시험 목적(최소 성취기준 · 상대평가 · 결손 진단)별 설계를 추천.
- 기본 물리 문항 세트에서 '(보기 중에 답이 없으면 직접 그리기)' 선지와 발문 안내를 뺐고, 이미 들어간 문항도 마이그레이션이 정리해요.
- **학생 사칭 방지** (`20261114000000_student_security.sql`, `src/server/student-auth.ts`):
  - 처음 비밀번호는 0000 대신 학생마다 다른 6자리 숫자(`students.initial_pw`, 암호학적 난수). 명단 화면에서 가려 두고(눌러서 보기), [안내문 인쇄]로 한 장씩 나눠 줘요.
  - 처음 비밀번호로 들어오면 그 자리에서 자기 비밀번호를 정해야 들어가요(너무 쉬운 비밀번호 거절). 정하면 `initial_pw` 는 지워져요.
  - 새로 로그인하면 `students.session_id` 가 바뀌어 이전 기기는 로그아웃되고 "다른 기기에서 로그인" 안내가 떠요.
  - 비밀번호를 잊으면 교사가 [처음 비밀번호 새로 만들기] → 자기 비밀번호 삭제 · 로그인해 있던 기기 로그아웃.
  - 비밀번호 틀림 횟수 제한은 두지 않았어요.
- `STUDENT_SESSION_SECRET`(선택): 학생 로그인 쿠키 서명 키. 없으면 `SUPABASE_SECRET_KEY` 에서 만들어 써요. 바꾸면 학생 전원이 다시 로그인해요.
- 통계 쿼리: 형성평가 분석 · 개념 지도가 교사의 모든 응답 대신 해당 차시 · 개념의 응답만 DB에서 가져와요 (`allIn` 으로 150개씩 나눠 조회).
- 시험 스크립트(`scripts/`)를 위 내용에 맞게 고쳤어요: `smoke:teacher`(91개) · `smoke:live`(학생 로그인 · 사칭 방지 · 복수 정답, 49개)
  · `smoke:ai-mock`(17개) · `parity:analysis`(형성평가 통계는 원본과 같은 지표 비교, 출제 가이드는 규칙 확인, 24개).
  실제 Supabase 대신 메모리 DB로 같은 API 를 띄워 모두 통과하는 것까지 확인했고, 실제 Supabase 로는 아직 돌려 보지 않았어요.

## 이전 진행 상황

- [x] 1단계 — 프로젝트 뼈대, Supabase 클라이언트, DB 스키마(RLS), 시트 데이터 이전 스크립트
- [x] 2단계 — 교사 로그인(Supabase Auth), 서버 API (`Code.js` 기능 중 AI·통계 제외 38개), 통합 시험 58개 통과
- [x] 3단계 — 실시간 수업: 학생 화면 `/student` · 수업 위젯 `/teacher/widget`, 폴링 → Supabase Realtime Broadcast (API 시험 29개 · 실제 브라우저 시험 22개 통과)
- [x] 4단계 — 교사 화면(`Index.html`, `AnalysisUI.html`) + `Analysis.js` 통계 이전 (통계는 원본과 결과 일치 확인, 브라우저 시험 26개 통과)
- [x] 5단계 — OpenAI 기능 (출제 챗봇 · AI 서식 정리 · 문항 사전 분석 · 출제 조언) — 가짜 OpenAI 서버 시험 21개 통과 (`npm run smoke:ai-mock`, 방법은 스크립트 맨 위 주석)
- [x] 6단계 — Vercel 배포 https://class-tool-web.vercel.app (Supabase Marketplace 연동 · 서울 리전), 시트 데이터 이전, OPENAI_API_KEY 설정

## 기본 문항 세트 (모든 교사 계정 · 새 계정)

DB에 `supabase/migrations/20261115000000_sample_set_v2.sql` 을 적용해야 해요 (`npm run db:push`).

- 세트 파일: `src/server/seed/physics-items.json` (직접 고치지 말고 아래 명령으로 다시 만들어요) + 그림 `public/sample/*.svg`
- 만들기: 최종 수정한 계정에서 내보내고 → 그림을 붙여 세트로 만들어요.
  ```bash
  npm run sample:update     # = sample:export (기준 교사: .env.local 의 SAMPLE_EMAIL) + sample:build
  ```
  `sample:export` 는 운영 DB(.env.local)를 읽기만 해서 `data/sample-export.json` 을 만들고, `sample:build` 가 세트 파일 · 그림을 써요.
  내용이 바뀌면 세트 `version` 이 1 올라가요. ⚠ 경고가 나오면(선지 글 · 그림 설명이 그림을 그릴 때와 달라짐) 그 문항은 그림 선지 대신 글 선지로 들어가요 → `scripts/sample-figures.mjs` 의 그림을 고쳐 다시 만들어요.
- 맞추기(`src/server/api/sample.ts`): 교사가 접속할 때 `teacher_settings.sample_version` 이 세트 version 보다 낮으면 한 번
  - 예전 기본 문항(`questions.sample_key` 가 있는 문항, 예전 형식은 기본 폴더 안의 같은 문항 번호)을 지우고 새로 넣어요. 이 문항을 담았던 차시 · 응답 기록의 연결은 끊겨요.
  - 개념 · 오개념은 이름으로 맞춰요(있으면 내용을 세트대로, 없으면 추가). 예전 세트에만 있던 것은 교사 문항이 쓰지 않을 때만 지워요.
  - 교사가 만든 문항 · 폴더 · 개념은 그대로. 기본 문항을 고쳐 저장하면 그때부터 그 교사의 문항이에요(다음 세트 때 지워지지 않음).
- 그림 선지: `questions.choice_images[i]` (없으면 ''). 그림만 있는 선지는 글이 비어 있어도 돼요. 편집 창 선지의 [그림] 버튼으로 넣고 바꿀 수 있어요.

## 화면 정리 (11/12)

- **수업하기**: 메뉴는 [클래스 전체보기] · [학생 목록 관리] / 운영 중인 클래스. 전체보기는 '운영 중인 클래스' · '종료된 클래스' 탭과 과목 체크 필터(중학 과학1 ~ 전자기와 양자).
- **문제은행**: [+ 빈 문제] 없앰(문제는 오른쪽 문제 만들기로). 체크 칸을 누른 채 끌면 여러 문제를 한 번에 골라요. 목록의 과목 · 개념 개수 대신 개념 키워드.
- **편집 창**: 과목은 선택 상자, 개념은 검색해서 추가(앞글자 · 포함 · 초성으로 후보, 없으면 새 개념), 해설란 · [AI로 빈 선지 만들기] 없앰, 정답이 1개면 '모두 골라야' 안내 없음.
- **문제 만들기(AI)**: 만든 문제에 개념 · 오개념을 자동으로 붙이지 않아요(교사가 편집 창에서 추가). "그림도 만들어줘"처럼 말하면 편집 중인 문제에 그림을 만들어 넣어요.
  그림 모델은 `OPENAI_IMAGE_MODEL`(기본 gpt-image-1) — 조직 인증이 안 된 키라 gpt-image-1 을 못 쓰면 dall-e-3 로 대신 만들어요. 실패하면 채팅에 이유가 나와요.
- **개념 지도**: 새 개념(개념 지도에서 추가 · 문제 저장 때 새 개념)은 같은 단원 노드와, 키가 있으면 AI가 고른 관련 기존 개념 1~3개와 처음 연결(`autoLinkConcepts`).
  기본 세트 v6 에 다른 과목 · 물리학 2, 3단원 임시 개념을 넣었어요(`data/extra-concepts.json` → `npm run sample:build`).
- **형성평가 분석 › 개념 지도**: 그림 대신 단원별 목록. **학생 목록**: [학생 랜덤 채우기] (테스트용).

## manatee 디자인 · 학년도 (11/12)

- 이름 · 로고: **manatee** — 매너티 얼굴 로고 `public/brand/manatee-mark.svg` (= `src/components/manatee.tsx`, 교사 화면은 `app.js` 의 `MANATEE`), 파비콘 `src/app/icon.svg`.
- 색: 연한 베이지(바탕 · 카드) 6.5 : 유광 검정(메뉴 · 주요 버튼 · 탭 · 클래스 카드 머리) 2.5 : 파스텔 다홍(강조 점 · 상태 · 선택) 1.
  교사 화면 `src/app/teacher/teacher.css` 맨 아래 'manatee 테마' 와 :root 변수(`--beige` `--paper` `--ink` `--gloss` `--coral` …), 로그인 · 첫 화면 · 수업 위젯도 같은 색.
- 학생 화면: 문제가 없을 때 둥근 카드 가운데 "선생님께서 아직 문제를 올리지 않으셨어요".
- **학년도** (`supabase/migrations/20261117000000_homeroom_year.sql` → `npm run db:push`): 반(homerooms)에 `year`.
  학년도 = 3월 ~ 다음 해 2월. 끝난 학년도 반은 학생 목록에서 숨기고([지난 학년도 보기]로 볼 수 있음) 학생 로그인 · 클래스 연결 목록에서 빠져요. 데이터는 남아 지난 수업 분석은 그대로.
  이미 있던 반은 만든 날짜의 학년도로 채워요. 같은 학교 · 학년 · 반도 학년도가 다르면 따로 만들 수 있어요.
- 글꼴: Pretendard (`src/app/layout.tsx` 에서 jsDelivr 의 dynamic subset CSS 를 불러오고, `globals.css` 의 `--font-sans`). 못 불러오면 시스템 한글 글꼴로.
- 빈 화면 안내: `emptyBox(글, 버튼)` (app.js) — 작은 매너티 + 한 줄 + 다음에 할 일 버튼 하나로 모든 화면 통일.
