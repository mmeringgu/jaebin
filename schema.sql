-- D1 데이터베이스 테이블입니다.
-- 이미 있는 테이블은 건드리지 않으므로 예전 D1에 실행해도 안전합니다.
-- 실행: npx wrangler d1 execute smd-news-db --remote --file=schema.sql
-- (내 PC 시험용: --remote 대신 --local)

-- 기사 후보: 목록에서 찾은 기사. 7일이 지나면 지웁니다.
CREATE TABLE IF NOT EXISTS news_candidates (
 id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, source_name TEXT NOT NULL,
 title TEXT NOT NULL, url TEXT NOT NULL UNIQUE, published_date TEXT,
 suggested_category TEXT, matched_keyword_groups_json TEXT NOT NULL DEFAULT '[]',
 snippet TEXT NOT NULL DEFAULT '{}', body_text TEXT NOT NULL DEFAULT '',
 processing_status TEXT NOT NULL DEFAULT 'pending', fetch_status TEXT NOT NULL DEFAULT 'pending',
 fetch_error TEXT NOT NULL DEFAULT '', body_fetched_at TEXT,
 first_collected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_collected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 expires_at TEXT NOT NULL DEFAULT (datetime('now','+7 days'))
);
CREATE INDEX IF NOT EXISTS idx_candidates_source ON news_candidates(source_id, fetch_status, expires_at);

-- 게시된 기사: 화면에 보이는 기사
CREATE TABLE IF NOT EXISTS articles (
 id INTEGER PRIMARY KEY, category TEXT NOT NULL, entity TEXT NOT NULL,
 published_date TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL,
 url TEXT NOT NULL UNIQUE, summary TEXT NOT NULL, tags_json TEXT NOT NULL DEFAULT '[]',
 review_status TEXT NOT NULL DEFAULT 'published', is_sample INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 starred INTEGER NOT NULL DEFAULT 0, memo TEXT NOT NULL DEFAULT '',
 hidden INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
 impact_override TEXT NOT NULL DEFAULT '' CHECK(impact_override IN ('', '기회', '위협'))
);
CREATE INDEX IF NOT EXISTS idx_articles_date ON articles(published_date DESC);

-- 수집 기록: 정보원마다 언제 수집했는지 (7일 보관)
CREATE TABLE IF NOT EXISTS collection_runs (
 id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, source_name TEXT NOT NULL,
 run_status TEXT NOT NULL DEFAULT 'running', started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 finished_at TEXT, found_count INTEGER DEFAULT 0, saved_count INTEGER DEFAULT 0, error_message TEXT
);

-- 예약 수집 상태 (한 줄만 있음)
CREATE TABLE IF NOT EXISTS monitor_control (
 id INTEGER PRIMARY KEY CHECK(id=1), pause_day TEXT NOT NULL DEFAULT '',
 last_tick TEXT, last_message TEXT NOT NULL DEFAULT '',
 lock_token TEXT NOT NULL DEFAULT '', lock_until REAL NOT NULL DEFAULT 0,
 briefing_day TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO monitor_control(id) VALUES(1);

-- 예약 수집 작업 기록 (7일 보관)
CREATE TABLE IF NOT EXISTS monitor_jobs (
 job_key TEXT PRIMARY KEY, run_day TEXT NOT NULL, kind TEXT NOT NULL,
 source_id TEXT NOT NULL, article_id INTEGER, status TEXT NOT NULL,
 message TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_day ON monitor_jobs(run_day, source_id);
