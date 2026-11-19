import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import worker from '../src/index.js';
import adminWorker from './helpers/admin-worker.js';
import {SOURCE_BY_ID} from '../src/settings.js';

test('숨긴 기사는 공개 뉴스에서 제외하고 관리자 목록에서 확인·복원할 수 있습니다',async()=>{
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 const env={DB:{prepare(sql){let args=[];const query={bind(...values){args=values;return query;},async run(){return sqlite.prepare(sql).run(...args);},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};}};return query;}}};
 try{
  const insert=sqlite.prepare("INSERT INTO articles(id,category,entity,published_date,source,title,url,summary,hidden) VALUES(?,'policy','','2026-11-19',?,?,?,?,?)");
  const summary=JSON.stringify({format:'excerpt',source_id:'S012',first_paragraph:'검사 수가와 의료장비 설치 제도의 변화에 관한 기사입니다.'});
  for(const [id,title,hidden] of [[1,'검사수가 깎아 필수의료 지원',1],[2,'특수의료장비 설치 기준 개편',0],[3,'지멘스 산업용 컴퓨터 AI 공개',1]])insert.run(id,SOURCE_BY_ID.S012.name,title,'https://www.docdocdoc.co.kr/news/articleView.html?idxno='+id,summary,hidden);
  const get=path=>new Request('https://example.com'+path);
  const visible=await (await worker.fetch(get('/api/articles'),env)).json();assert.deepEqual(visible.articles.map(a=>a.id),[2]);
  assert.equal((await worker.fetch(get('/api/hidden-articles'),env)).status,401);
  const hidden=await (await adminWorker.fetch(get('/api/hidden-articles'),env)).json();
  assert.equal(hidden.count,2);assert.deepEqual(hidden.articles.map(a=>a.id),[3,1]);
  const restore=await worker.fetch(new Request('https://example.com/api/article-hide',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:JSON.stringify({id:1,hidden:false})}),env);
  assert.equal(restore.status,200);
  const after=await (await worker.fetch(get('/api/articles'),env)).json();assert.deepEqual(after.articles.map(a=>a.id),[2,1]);
  assert.equal((await (await adminWorker.fetch(get('/api/hidden-articles'),env)).json()).count,1);
 }finally{sqlite.close();}
});

test('관리 목록은 펼칠 때 조회하고 안전하게 제목을 표시하며 복원 후 뉴스 목록도 갱신합니다',async()=>{
 const nodes=new Map(),events=new Map(),calls=[];let restored=false,newsRefreshes=0;
 const node=tag=>({tag,children:[],style:{},disabled:false,textContent:'',append(child){this.children.push(child);},replaceChildren(){this.children=[];},addEventListener(name,fn){this[name]=fn;}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,node('div'));return nodes.get(id);};
 const details=get('hidden-article-management');details.open=false;
 const context={document:{getElementById:get,createElement:node,addEventListener(name,fn){events.set(name,fn);}},
  AdminAccess:{ready:Promise.resolve(),request:async(path,options)=>{
   calls.push(path);
   if(path==='/api/article-hide'){assert.deepEqual(JSON.parse(options.body),{id:7,hidden:false});restored=true;return {ok:true,json:async()=>({ok:true})};}
   return {ok:true,json:async()=>({articles:restored?[]:[{id:7,title:'<img src=x> 원문 기사 제목',url:'https://example.com/7',category:'policy',source:'매체',date:'2026-11-19'}]})};
  }},refreshArticles:async()=>{newsRefreshes++;}};
 runInNewContext(readFileSync(new URL('../static/hidden-articles.js',import.meta.url),'utf8'),context);
 assert.equal(calls.length,0);
 details.open=true;details.toggle();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,['/api/hidden-articles']);
 const table=get('hidden-articles-output').children[0],row=table.children[1].children[0];
 assert.equal(row.children[0].children[0].textContent,'<img src=x> 원문 기사 제목');
 await row.children[4].children[0].click();
 assert.equal(newsRefreshes,1);assert.equal(get('hidden-articles-output').children.length,0);
 assert.match(get('hidden-articles-status').textContent,/숨긴 기사가 없습니다/);
});
