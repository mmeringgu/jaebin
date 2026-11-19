const COOKIE='smd_admin';
const SESSION_SECONDS=8*60*60;
export const ADMIN_PATHS=new Set(['/api/sources','/api/source-status','/api/automation-status','/api/candidates','/api/excluded-articles','/api/hidden-articles','/api/export.csv','/api/collect','/api/read-body','/api/automation-step','/api/manual-article-preview','/api/manual-article']);

async function hash(value){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
function tokenOf(request){
 const cookie=(request.headers.get('Cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='));
 const token=cookie?.slice(COOKIE.length+1)||'';
 return /^[a-f0-9]{64}$/.test(token)?token:'';
}
function cookie(request,value,clear=false){
 return COOKIE+'='+value+'; Path=/api; HttpOnly; SameSite=Strict'+(new URL(request.url).protocol==='https:'?'; Secure':'')+(clear?'; Max-Age=0':'');
}
async function setup(db){
 await db.prepare('CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)').run();
 await db.prepare('CREATE TABLE IF NOT EXISTS admin_login_attempts (client_hash TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)').run();
}
export async function adminSession(request,env){
 const token=tokenOf(request);if(!token)return false;
 try{
  const row=await env.DB.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash=?').bind(await hash(token)).first();
  return Number(row?.expires_at)>Math.floor(Date.now()/1000);
 }catch{return false;}
}
export async function adminLogin(request,env,password){
 await setup(env.DB);
 const now=Math.floor(Date.now()/1000),client=await hash(request.headers.get('CF-Connecting-IP')||'local');
 const attempts=await env.DB.prepare('SELECT attempts,expires_at FROM admin_login_attempts WHERE client_hash=?').bind(client).first();
 if(attempts?.expires_at>now&&attempts.attempts>=5)throw Object.assign(new Error('잠시 후 다시 시도해 주세요.'),{status:429});
 if(password!=='1126'){
  await env.DB.prepare('INSERT INTO admin_login_attempts(client_hash,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(client_hash) DO UPDATE SET attempts=CASE WHEN expires_at>? THEN attempts+1 ELSE 1 END, expires_at=CASE WHEN expires_at>? THEN expires_at ELSE excluded.expires_at END').bind(client,now+600,now,now).run();
  throw Object.assign(new Error('비밀번호가 올바르지 않습니다.'),{status:401});
 }
 await env.DB.prepare('DELETE FROM admin_login_attempts WHERE client_hash=? OR expires_at<=?').bind(client,now).run();
 await env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').bind(now).run();
 const old=tokenOf(request);
 if(old)await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await hash(old)).run();
 const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 await env.DB.prepare('INSERT INTO admin_sessions(token_hash,expires_at) VALUES(?,?)').bind(await hash(token),now+SESSION_SECONDS).run();
 return cookie(request,token);
}
export async function adminLogout(request,env){
 const token=tokenOf(request);
 if(token)await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await hash(token)).run();
 return cookie(request,'',true);
}
