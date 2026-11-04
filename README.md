# SMD News Monitor — Cloudflare Worker 버전

의료 업계 뉴스를 정보원 사이트에서 모아 키워드로 분류하고, GPT 요약·주간 리포트·아침 브리핑까지 만들어 주는 사내 뉴스 클리핑 사이트입니다.
Cloudflare Worker(자바스크립트)로 돌아가서 PC를 켜 두지 않아도 됩니다.

자세한 설명은 [docs/Cloudflare배포.md](docs/Cloudflare배포.md)와 [docs/기능모음집.md](docs/기능모음집.md)를 보세요.

## 처음 준비 (한 번만)

Node.js가 설치되어 있어야 합니다.

```powershell
npm install                 # Cloudflare 배포 도구(wrangler) 설치
npx wrangler login          # Cloudflare 계정 로그인
npx wrangler d1 list        # 예전 D1 이름·ID 확인 → wrangler.toml에 적기
npx wrangler d1 execute 데이터베이스이름 --remote --file=schema.sql   # 표 만들기 (이미 있는 표는 그대로)
npx wrangler secret put OPENAI_API_KEY          # AI 요약을 쓸 때
npx wrangler secret put BRIEFING_WEBHOOK_URL    # 아침 브리핑을 쓸 때
```

## 실행

```powershell
npm run dev       # 내 PC에서 시험 (http://127.0.0.1:8787, 시험용 DB 사용)
npm run deploy    # Cloudflare에 올리기
npm test          # 자동 테스트
```

내 PC 시험을 처음 할 때는 `npx wrangler d1 execute 데이터베이스이름 --local --file=schema.sql`로 시험용 DB를 먼저 만드세요.

## 파일 구성

| 파일 | 역할 |
|---|---|
| `src/index.js` | 화면 요청(/api/...) 받기, 1분마다 예약 수집 부르기 |
| `src/service.js` | 수집·게시·조회·예약 작업 흐름, 동시 실행 막기 |
| `src/crawler.js` | 정보원 페이지 가져오기, 기사 주소 확인, 본문·날짜 꺼내기 |
| `src/rules.js` | 제목 키워드 분류 |
| `src/ai_summary.js` | GPT 요약·주간 리포트 |
| `src/briefing.js` | 아침 브리핑 |
| `src/db.js`, `schema.sql` | D1 데이터베이스 |
| `src/settings.js`, `src/config.json` | 설정, 정보원·키워드 목록 |
| `wrangler.toml` | Cloudflare 설정 (DB 연결, 예약 주기, 설정값) |
| `static/` | 화면 HTML, CSS, JavaScript |
| `start.js` | 아주 예전 Cloudflare 버전 (참고용, 사용 안 함) |

예전 파이썬 버전은 git 기록의 `파이썬 버전 마지막 상태` 커밋에 남아 있습니다.
