// 기존 관리 기능 테스트는 실제 로그인 세션을 발급한 상태에서 실행합니다.
import {DatabaseSync} from 'node:sqlite';
import worker from '../../src/index.js';
import {ADMIN_PATHS} from '../../src/admin-auth.js';
const sessions=new WeakMap();
async function authorized(env){
 if(sessions.has(env))return sessions.get(env);
 const pending=(async()=>{
  const sqlite=new DatabaseSync(':memory:');
  const db=new Proxy(env.DB,{get(target,key){
   if(key==='prepare')return sql=>{
    if(!/\badmin_(?:sessions|login_attempts)\b/.test(sql))return target.prepare(sql);
    let args=[];
    const statement={bind(...values){args=values;return statement;},async run(){return sqlite.prepare(sql).run(...args);},async first(){return sqlite.prepare(sql).get(...args)||null;}};
    return statement;
   };
   const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});
  const scoped={...env,DB:db};
  const response=await worker.fetch(new Request('https://example.com/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:JSON.stringify({password:'1126'})}),scoped);
  if(response.status!==200)throw new Error('Admin session setup failed: '+await response.text());
  return {env:scoped,cookie:response.headers.get('Set-Cookie').split(';')[0]};
 })();
 sessions.set(env,pending);return pending;
}
export default {...worker,async fetch(request,env,ctx){
 if(!ADMIN_PATHS.has(new URL(request.url).pathname))return worker.fetch(request,env,ctx);
 const session=await authorized(env),headers=new Headers(request.headers);headers.set('Cookie',session.cookie);
 return worker.fetch(new Request(request,{headers}),session.env,ctx);
}};
