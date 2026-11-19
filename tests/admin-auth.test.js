import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import worker from '../src/index.js';
import {ADMIN_PATHS} from '../src/admin-auth.js';

function database(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 const env={DB:{prepare(sql){
  let args=[];
  const query={bind(...values){args=values;return query;},async run(){return sqlite.prepare(sql).run(...args);},async first(){return sqlite.prepare(sql).get(...args)||null;}};
  return query;
 }}};
 const request=(path,body,cookie='',origin='https://example.com')=>worker.fetch(new Request('https://example.com'+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin}),Cookie:cookie},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
 return {sqlite,request};
}
test('관리 API는 인증 전에 DB 접근이나 동작을 실행하지 않습니다',async()=>{
 for(const path of ADMIN_PATHS)for(const method of ['GET','POST']){
  const response=await worker.fetch(new Request('https://example.com'+path,{method}),{});
  assert.equal(response.status,401,path);
  assert.match((await response.json()).error,/관리자 인증/);
 }
});
test('정확한 비밀번호로만 무작위 세션을 발급하고 쿠키 위조·만료·로그아웃을 차단합니다',async()=>{
 const {sqlite,request}=database();
 try{
  assert.equal((await request('/api/admin/login',{password:'0000'})).status,401);
  assert.equal((await request('/api/admin/login',{password:1126})).status,401);
  assert.equal((await request('/api/admin/login',{password:'1126'},'','https://other.example')).status,403);
  const response=await request('/api/admin/login',{password:'1126'});
  assert.equal(response.status,200);
  const header=response.headers.get('Set-Cookie'),cookie=header.split(';')[0];
  assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Strict/);assert.match(header,/Secure/);assert.match(cookie,/^smd_admin=[a-f0-9]{64}$/);
  assert.equal((await (await request('/api/admin/session',undefined,cookie)).json()).authenticated,true);
  assert.equal((await request('/api/sources',undefined,cookie)).status,200);
  assert.equal((await request('/api/sources',undefined,'smd_admin=1126')).status,401);
  assert.equal((await request('/api/sources',undefined,'smd_admin='+'a'.repeat(64))).status,401);
  assert.notEqual(sqlite.prepare('SELECT token_hash FROM admin_sessions').get().token_hash,cookie.split('=')[1]);
  const logout=await request('/api/admin/logout',{},cookie);assert.equal(logout.status,200);assert.match(logout.headers.get('Set-Cookie'),/Max-Age=0/);
  assert.equal((await request('/api/sources',undefined,cookie)).status,401);
  const again=await request('/api/admin/login',{password:'1126'}),next=again.headers.get('Set-Cookie').split(';')[0];
  sqlite.prepare('UPDATE admin_sessions SET expires_at=0').run();
  assert.equal((await request('/api/sources',undefined,next)).status,401);
 }finally{sqlite.close();}
});
test('반복된 오입력은 잠시 제한하고 제한 시간이 지나면 다시 인증할 수 있습니다',async()=>{
 const {sqlite,request}=database();
 try{
  for(let i=0;i<5;i++)assert.equal((await request('/api/admin/login',{password:'0000'})).status,401);
  assert.equal((await request('/api/admin/login',{password:'1126'})).status,429);
  sqlite.prepare('UPDATE admin_login_attempts SET expires_at=0').run();
  assert.equal((await request('/api/admin/login',{password:'1126'})).status,200);
 }finally{sqlite.close();}
});
test('관리 화면은 오입력 시 잠금을 유지하고 인증 후 열리며 만료 시 다시 잠깁니다',async()=>{
 const nodes=new Map();
 function get(id){if(!nodes.has(id))nodes.set(id,{hidden:id==='admin-content',value:'',textContent:'',disabled:false,addEventListener(key,fn){this[key]=fn;},reportValidity(){return true;},focus(){}});return nodes.get(id);}
 let allowed=false,expired=false;
 const code=readFileSync(new URL('../static/admin-auth.js',import.meta.url),'utf8');
 assert.doesNotMatch(code,/1126/);
 const context={document:{getElementById:get,dispatchEvent(){}},CustomEvent:class{},AbortSignal,
  fetch:async(path,options)=>{
   if(path==='/api/admin/session')return {ok:true,json:async()=>({authenticated:false})};
   if(path==='/api/admin/login')return {ok:allowed,json:async()=>allowed?{authenticated:true}:{error:'비밀번호가 올바르지 않습니다.'}};
   if(path==='/api/admin/logout')return {ok:true,json:async()=>({authenticated:false})};
   return {status:expired?401:200};
  }};
 runInNewContext(code,context);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(get('admin-content').hidden,true);
 await get('admin-login-form').submit({preventDefault(){}});
 assert.equal(get('admin-content').hidden,true);assert.match(get('admin-login-status').textContent,/올바르지/);
 allowed=true;get('admin-password').value='1126';await get('admin-login-form').submit({preventDefault(){}});
 await context.AdminAccess.ready;
 assert.equal(get('admin-gate').hidden,true);assert.equal(get('admin-content').hidden,false);assert.equal(get('admin-password').value,'');
 expired=true;await context.AdminAccess.request('/api/source-status');
 assert.equal(get('admin-content').hidden,true);assert.equal(get('admin-gate').hidden,false);
});
