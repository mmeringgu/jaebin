// D1 데이터베이스를 쉽게 쓰기 위한 작은 도우미 함수들입니다. (예전 app/db.py)
// 테이블은 schema.sql로 만들어 둡니다. (README 참고)

// 여러 줄을 가져옵니다. 예: await all(env.DB, "SELECT * FROM articles WHERE id=?", [3])
export async function all(db, sql, args = []) {
  const result = await db.prepare(sql).bind(...args).all();
  return result.results;
}

// 첫 줄 하나만 가져옵니다. 없으면 null
export async function first(db, sql, args = []) {
  return db.prepare(sql).bind(...args).first();
}

// 저장·수정·삭제를 실행합니다.
export async function run(db, sql, args = []) {
  return db.prepare(sql).bind(...args).run();
}

// 예전 D1에는 없는 칸(⭐, 메모, 브리핑 날짜, 숨김, 보관)을 추가합니다.
// 이미 있으면 오류가 나므로 그냥 넘어갑니다. Worker가 켜질 때 한 번만 실행됩니다.
let columnsChecked = false;
export async function addMissingColumns(db) {
  if (columnsChecked) return;
  const sqls = [
    "ALTER TABLE articles ADD COLUMN starred INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE articles ADD COLUMN memo TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE monitor_control ADD COLUMN briefing_day TEXT NOT NULL DEFAULT ''",
    // 숨김(hidden)·보관(archived) 표시 칸입니다. 예전 D1은 review_status에 'hidden'·'archived'를 넣을 수 없게
    // 막혀 있어서(CHECK 규칙) 수집이 멈췄습니다. 그래서 따로 칸을 만들어 0/1로 표시합니다.
    "ALTER TABLE articles ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE articles ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
  ];
  for (const sql of sqls) {
    try {
      await db.prepare(sql).run();
    } catch {
      // 이미 있는 칸이면 여기로 옵니다. 문제없습니다.
    }
  }
  columnsChecked = true;
}
