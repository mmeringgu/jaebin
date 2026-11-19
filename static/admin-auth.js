(function(){
 const gate=document.getElementById('admin-gate'),content=document.getElementById('admin-content'),form=document.getElementById('admin-login-form');
 if(!gate||!content||!form)return;
 const password=document.getElementById('admin-password'),button=document.getElementById('admin-login-button'),status=document.getElementById('admin-login-status');
 let authenticated=false,resolveReady,ready=new Promise(resolve=>{resolveReady=resolve;}),everUnlocked=false,generation=0;
 function show(value){
  authenticated=value;gate.hidden=value;content.hidden=!value;
  if(value){
   resolveReady();if(everUnlocked)document.dispatchEvent(new CustomEvent('collection-finished'));everUnlocked=true;
  }else{ready=new Promise(resolve=>{resolveReady=resolve;});}
 }
 async function post(path,data){
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(10000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'인증을 확인하지 못했습니다.');return result;
 }
 globalThis.AdminAccess={
  get ready(){return ready;},
  async request(path,options){
   if(!authenticated)throw new Error('관리자 인증이 필요합니다.');
   const response=await fetch(path,options);
   if(response.status===401){show(false);status.textContent='비밀번호를 다시 입력해 주세요.';}
   return response;
  }
 };
 form.addEventListener('submit',async function(event){
  event.preventDefault();if(button.disabled||!form.reportValidity())return;
  const attempt=++generation;button.disabled=true;button.textContent='확인 중…';status.textContent='';
  try{await post('/api/admin/login',{password:password.value});if(attempt===generation){password.value='';show(true);}}
  catch(error){if(attempt===generation){status.textContent=error.message;password.value='';password.focus();}}
  finally{button.disabled=false;button.textContent='확인';}
 });
 document.getElementById('admin-lock-button').addEventListener('click',async function(){
  generation++;
  try{await post('/api/admin/logout',{});show(false);status.textContent='';password.value='';}
  catch(error){show(false);status.textContent='잠금 상태를 확인하지 못했습니다. 다시 시도해 주세요.';}
 });
 const initial=generation;
 fetch('/api/admin/session',{signal:AbortSignal.timeout(10000)}).then(async response=>{
  if(!response.ok)throw new Error('session');const data=await response.json();
  if(initial===generation&&data.authenticated===true)show(true);
 }).catch(()=>{});
})();
