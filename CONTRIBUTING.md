# 팀원 작업 매뉴얼 — GitHub에 내 작업 올리기

git을 처음 써도 따라 할 수 있게 **GitHub Desktop**(버튼으로 하는 프로그램) 기준으로 적었어요.
명령어가 편하면 맨 아래 [명령어로 하기](#명령어로-하기)를 보세요.

> **작업하는 길은 두 가지예요. 편한 쪽을 쓰면 돼요.**
>
> | | 길 A — 구글 드라이브 (예전처럼) | 길 B — GitHub (이 문서) |
> |---|---|---|
> | 어디서 고치나 | 드라이브의 `class-tool-web` 폴더 | 내 컴퓨터에 받은(Clone) 폴더 |
> | GitHub에 올리기 | 관리자(yeonseo432)가 모아서 올려요 | 내가 직접 Push → Pull Request |
> | git 몰라도 됨 | ✅ | GitHub Desktop 정도 |
>
> - **길 A**: 지금처럼 드라이브 폴더에서 고치고 저장하면 끝. 관리자가 드라이브 변경을 GitHub에 커밋하고,
>   GitHub에 합쳐진 내용도 드라이브 폴더로 내려 줘요. 드라이브 폴더 안의 `.git` 파일은 관리자 컴퓨터용이니 지우거나 고치지 마세요.
> - **길 B**: 아래 0~1번 순서대로.
> - ⚠️ **같은 파일을 두 길에서 동시에 고치지 마세요.** 한쪽 작업이 덮어써질 수 있어요.
>   길 B로 큰 작업을 시작할 땐 팀 채팅에 "○○ 파일 작업 중"이라고 알려 주세요.

---

## 0. 처음 한 번만 하는 준비

### 0-1. GitHub 계정과 초대
1. https://github.com 에서 계정을 만들어요 (이미 있으면 그대로).
2. **GitHub 아이디**를 저장소 관리자(yeonseo432)에게 알려 주세요.
3. 이메일(또는 https://github.com/notifications)로 온 **초대(Invitation)를 수락**해요.
   수락해야 내 작업을 올릴(push) 수 있어요.

### 0-2. 프로그램 설치
| 프로그램 | 받는 곳 | 메모 |
|---|---|---|
| GitHub Desktop | https://desktop.github.com | 설치 후 GitHub 계정으로 로그인 |
| Node.js (LTS) | https://nodejs.org | 내 컴퓨터에서 앱을 띄워 볼 때 필요 |
| 편집기 (선택) | VS Code · Cursor · Claude Code 등 | 평소 쓰던 것 |

### 0-3. 저장소를 내 컴퓨터로 받기 (Clone)
1. GitHub Desktop → **File → Clone repository** → **URL** 탭
2. URL: `https://github.com/yeonseo432/class-tool-web`
3. Local path: **구글 드라이브가 아닌 곳** (예: `문서/GitHub/class-tool-web`)
4. **Clone** 클릭

### 0-4. 열쇠 파일(.env.local) 받기
- 앱을 띄우려면 `.env.local` 파일이 필요해요 (DB · OpenAI 키가 들어 있음).
- 관리자에게 **개인 메시지로** 받아서, 받은 폴더(`class-tool-web`) 맨 위에 그대로 넣어 주세요.
- ⚠️ 이 파일은 **절대 GitHub · 단톡방 · 문서에 올리지 마세요.** (`.gitignore`가 자동으로 막아 주지만, 다른 이름으로 복사하면 막지 못해요.)

### 0-5. 내 컴퓨터에서 띄워 보기
터미널(맥: 터미널 앱, 윈도: PowerShell)에서 받은 폴더로 가서:
```bash
npm install      # 처음 한 번 (또는 package.json 이 바뀌었을 때)
npm run dev      # http://localhost:3000 열기
```
> 내 컴퓨터에서 띄워도 **운영 DB에 바로 연결**돼요. 실제 선생님 계정 데이터를 지우거나 바꾸는 테스트는 하지 마세요.

---

## 1. 매번 하는 작업 순서

```
최신 받기 → 내 브랜치 만들기 → 고치기 → 커밋 → 올리기(Push) → Pull Request
```

### 1-1. 시작 전에 최신 내용 받기
GitHub Desktop 위쪽 **Current branch**가 `main`인지 확인 → **Fetch origin** → (나오면) **Pull origin**

### 1-2. 내 작업 브랜치 만들기
**Current branch → New branch** → 이름을 짓고 **Create branch**
- 이름 예: `이름/한-일` → `jiwoo/widget-timer`, `minsu/fix-student-login`
- 한 가지 일마다 브랜치 하나 (여러 일을 섞지 않기)

### 1-3. 고치기
평소처럼 편집기에서 파일을 고쳐요. GitHub Desktop 왼쪽에 바뀐 파일이 자동으로 보여요.
- 올리면 안 되는 파일(학생 명단, 키, 개인 메모)이 목록에 있으면 체크를 해제하세요.

### 1-4. 커밋 (변경 내용 저장)
왼쪽 아래 **Summary**에 한 줄 요약을 쓰고 **Commit to 내-브랜치** 클릭
- 예: `학생 화면: 제출 후 내 답 보이게`, `위젯 타이머 추가`
- 작업 중간에도 여러 번 해도 돼요.

### 1-5. 올리기 (Push)
위쪽 **Publish branch** (두 번째부터는 **Push origin**) 클릭

### 1-6. Pull Request 만들기
**Create Pull Request** 버튼 → GitHub 웹페이지가 열리면:
- 제목: 무엇을 했는지
- 설명: 왜 · 어디를 바꿨는지, 확인한 방법
- **DB를 바꿨다면 꼭 적기** (아래 2번)
- **Create pull request** 클릭 → 관리자가 확인하고 `main`에 합쳐요(merge).

합쳐진 뒤 다음 작업은 다시 **1-1**부터 (`main`으로 바꾸고 Pull).

---

## 2. 꼭 지켜 주세요

1. **DB 구조를 바꿀 때**
   - `supabase/migrations/` 에 `날짜시간_설명.sql` 파일을 새로 추가해요 (예전 파일은 고치지 않기).
   - `src/lib/database.types.ts` 도 맞춰 주세요.
   - PR 설명에 "마이그레이션 있음"이라고 적기.
   - **운영 DB 적용은 배포 담당이 배포 직전에 해요.** 각자 운영 DB에 직접 적용하지 마세요.
     (코드보다 DB가 늦으면 사이트가 오류 나고, DB만 먼저 바뀌면 지금 사이트가 깨질 수 있어요.)
2. **공개 저장소예요.** 학생 실명 · 학교 실제 명단 · 이메일 · 비밀번호 · API 키를 코드나 파일에 넣지 마세요.
   (`data/` 폴더와 `.env*` 파일은 자동으로 제외돼요.)
3. **`main`에 바로 올리지 말고** 내 브랜치 → Pull Request 로 올려 주세요.
4. 다른 사람 브랜치에 **Force push 하지 않기.**
5. 올리기 전에 가능하면 확인:
   ```bash
   npx tsc --noEmit   # 타입 오류 검사 (아무것도 안 나오면 통과)
   npm run build      # 실제 배포처럼 빌드
   ```

---

## 3. 관리자용: 드라이브 ↔ GitHub 맞추기

관리자 컴퓨터의 드라이브 폴더가 git 작업 폴더예요 (git 기록은 드라이브 밖 `~/git-repos/class-tool-web.git`).
배포 전마다 아래 순서로 맞춰요. (Claude Code에 "드라이브 변경 GitHub에 올리고 main 받아 와"라고 해도 돼요.)

```bash
git status                        # 드라이브에서 팀원이 바꾼 파일 확인
git add -A && git commit -m "드라이브 작업 반영: 요약"
git pull --rebase origin main     # GitHub에 합쳐진 PR 받기 (충돌 나면 여기서 정리)
git push origin main
```
`pull` 로 받은 파일은 드라이브를 통해 팀원들 폴더에도 내려가요.

---

## 4. 배포

- 운영 사이트: https://class-tool-web.vercel.app
- 배포는 관리자가 `main`에 합친 뒤 해요. 급하면 PR에 "배포 필요"라고 적어 주세요.

---

## 5. 자주 생기는 문제

| 상황 | 해결 |
|---|---|
| Push 할 때 권한 오류 (403) | 초대를 수락했는지 확인 (0-1) |
| Pull 할 때 "conflict" (충돌) | 같은 줄을 둘이 고친 경우예요. 혼자 고치기 어려우면 그대로 두고 관리자에게 알려 주세요. |
| `npm run dev` 가 키 오류 | `.env.local` 위치 · 내용 확인 (0-4) |
| 실수로 커밋에 키 · 개인정보가 들어감 | **Push 하지 말고** 바로 관리자에게 알려 주세요. 이미 Push 했다면 키를 새로 바꿔야 해요. |
| 어떤 브랜치에 있는지 헷갈림 | GitHub Desktop 위쪽 **Current branch** 확인 |

---

## 명령어로 하기

```bash
# 처음 한 번
git clone https://github.com/yeonseo432/class-tool-web.git
cd class-tool-web
npm install

# 매번
git switch main && git pull                 # 최신 받기
git switch -c 이름/한-일                     # 내 브랜치
# ... 고치기 ...
git add -A && git commit -m "한 줄 요약"     # 커밋
git push -u origin 이름/한-일                # 올리기
gh pr create --fill                         # (GitHub CLI가 있으면) Pull Request
```

Claude Code를 쓴다면 "내 작업을 새 브랜치에 커밋하고 Pull Request 만들어 줘"라고 해도 돼요.
