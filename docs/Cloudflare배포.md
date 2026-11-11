# Cloudflare 배포

## 한 줄 소개
뉴스 모니터 전체를 Cloudflare에서 돌아가는 자바스크립트 프로그램(Worker)으로 바꿔서, 내 PC를 켜 두지 않아도 사이트와 예약 수집이 계속 돌아가게 했습니다.

## 왜 만들었나요
- 예전 파이썬 버전은 내 PC에서 서버를 켜 둬야만 사이트가 열리고 예약 수집이 돌았습니다.
- PC를 끄면 사이트도 꺼지고, 아침 브리핑도 오지 않았습니다.
- Cloudflare에 올리면 인터넷 주소 하나로 언제든 열 수 있고, 수집도 Cloudflare가 1분마다 알아서 돌립니다.

## 어떻게 쓰나요
처음 한 번만 아래 순서대로 준비합니다. (Node.js(자바스크립트 실행 프로그램)가 설치되어 있어야 합니다)

1. 프로젝트 폴더에서 `npm install`을 실행합니다. Cloudflare 배포 도구(wrangler)가 설치됩니다.
2. `npx wrangler login`을 실행해서 Cloudflare 계정에 로그인합니다.
3. `npx wrangler d1 list`를 실행해서 예전에 쓰던 D1(Cloudflare의 데이터베이스)의 이름과 ID를 확인합니다.
4. `wrangler.toml`의 `database_name`, `database_id`에 3번에서 본 이름과 ID를 넣습니다.
5. `npx wrangler d1 execute 데이터베이스이름 --remote --file=schema.sql`을 실행해서 필요한 표를 만듭니다. 이미 있는 표는 건드리지 않습니다.
6. 비밀값을 넣습니다. (AI 요약·브리핑을 쓸 때만)
   - `npx wrangler secret put OPENAI_API_KEY`
   - `npx wrangler secret put BRIEFING_WEBHOOK_URL`
7. `npm run deploy`를 실행하면 Cloudflare에 올라가고, 사이트 주소가 화면에 나옵니다.

이후 코드나 설정을 고쳤을 때는 `npm run deploy`만 다시 실행하면 됩니다.

### 내 PC에서 먼저 시험해 보기
1. `npx wrangler d1 execute 데이터베이스이름 --local --file=schema.sql` (내 PC용 시험 DB 만들기, 처음 한 번)
2. `npm run dev`
3. 브라우저에서 http://127.0.0.1:8787 을 엽니다.
4. 화면 아래 **기사 수집**에서 정보원을 고르고 **기사 수집** 버튼을 눌러 봅니다.

내 PC 시험은 진짜 Cloudflare DB가 아니라 내 PC 안의 시험용 DB를 씁니다. 그래서 마음껏 눌러 봐도 실제 데이터에는 영향이 없습니다.

## 어떻게 동작하나요
1. 누군가 사이트 주소를 열면 → Cloudflare가 `static` 폴더의 화면(HTML·CSS·JS)을 보내 줍니다.
2. 화면에서 버튼을 누르면 → `/api/...` 요청이 Worker(`src/index.js`)로 가고 → 알맞은 기능을 실행한 뒤 결과를 돌려줍니다.
3. 기사와 수집 기록은 D1에 저장됩니다. (예전 SQLite 파일 대신)
4. Cloudflare가 1분마다 예약 작업을 부르면 → 예약 수집이 켜져 있고 한국 시간 오전 7시 이후일 때 → 목록 한 곳 또는 기사 한 건을 처리합니다.

예전 파이썬 파일과 새 자바스크립트 파일은 1:1로 대응합니다.

| 예전 (파이썬) | 지금 (자바스크립트) | 하는 일 |
|---|---|---|
| `app/main.py` | `src/index.js` | 화면 요청 받기, 1분마다 예약 수집 부르기 |
| `app/service.py` | `src/service.js` | 수집·저장·예약 수집 흐름 |
| `app/crawler.py` | `src/crawler.js` | 정보원 사이트에서 기사 가져오기 |
| `app/rules.py` | `src/rules.js` | 키워드로 카테고리 나누기 |
| `app/ai_summary.py` | `src/ai_summary.js` | GPT 요약·주간 리포트 |
| `app/briefing.py` | `src/briefing.js` | 아침 브리핑 |
| `app/db.py` | `src/db.js` + `schema.sql` | 데이터베이스 |
| `app/settings.py` + `.env` | `src/settings.js` + `wrangler.toml` | 설정 |

## 설정 방법
- 일반 설정은 `wrangler.toml`의 `[vars]` 아래에 있습니다.
  ```
  AUTO_ENABLED = "true"         # 예약 수집 켜짐 ("false"로 바꾸면 꺼짐)
  AUTO_SOURCE_LIMIT = "30"      # 예약 수집할 정보원 수 (최대 30, 빙 검색 6개 포함)
  AUTO_MAX_BODY_PER_DAY = "120" # 하루에 읽을 기사 수 상한
  OPENAI_MODEL = "gpt-5-mini"
  ARCHIVE_DAYS = "90"
  ```
- 비밀값(OpenAI 키, 웹훅 주소)은 파일에 적지 않고 `npx wrangler secret put 이름`으로 넣습니다.
- 내 PC 시험용 비밀값은 `.dev.vars.example`을 `.dev.vars`로 복사해서 적습니다.
- 키워드·정보원은 예전처럼 `src/config.json`에 있습니다.
- 설정을 바꾼 뒤에는 `npm run deploy`로 다시 올려야 반영됩니다.

## 알아두면 좋은 점
- **무료 요금제 기준으로 만들었습니다.** 무료 요금제는 요청 한 번에 쓸 수 있는 계산 시간이 짧습니다(10ms). 그래서 기사 페이지는 Cloudflare에 기본으로 들어 있는 빠른 도구(HTMLRewriter)로 읽습니다. 그래도 아주 큰 페이지에서 "실행 자원 한도 초과(1102)" 오류가 나면 유료 요금제(월 $5)를 고려하세요.
- **결과는 예전과 같습니다.** 정보원 12곳에서 목록 수집 결과(주소·제목·분류)가 파이썬 버전과 똑같았고, 기사 36건에서 발행일·부제목·첫 문단이 똑같았습니다. 본문 길이만 몇 글자 차이가 나는 경우가 있는데, 본문은 GPT 요약에 보낼 때만 씁니다.
- **예전 D1을 그대로 씁니다.** ⭐·메모·브리핑 날짜 칸이 없으면 Worker가 처음 켜질 때 자동으로 추가합니다.
- 병원 보도자료 사이트(서울대·세브란스·서울아산·서울성모)는 2026-11-10에 정보원에서 삭제했습니다. 학회·병원 기사는 신문사 사이트에서만 가져옵니다.
- 사이트에 로그인 기능은 없습니다. 사내에서만 보려면 Cloudflare Access(Cloudflare의 접속 제한 기능)를 연결하세요.
- `start.js`는 아주 예전 Cloudflare 버전으로 참고용입니다. 지금은 쓰지 않습니다.

## 관련 파일
- `wrangler.toml` (Cloudflare 설정), `package.json` (실행 명령)
- `src/index.js`, `src/service.js`, `src/crawler.js`, `src/rules.js`, `src/ai_summary.js`, `src/briefing.js`, `src/db.js`, `src/settings.js`, `src/config.json`
- `schema.sql` (D1 표 만들기), `static/_headers` (화면 보안 설정), `.dev.vars.example`
- `tests/rules.test.js` (`npm test`로 실행)

## 작성일
2026-11-03
