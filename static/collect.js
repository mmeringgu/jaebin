
(function(){
 const resultBox=document.getElementById('collect-result');
 let sources=[],busy=false;
 function setBusy(value){busy=value;document.dispatchEvent(new CustomEvent('collection-busy',{detail:{busy:value}}));}
 async function api(path,input){const r=await fetch(path,input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{});let d;const raw=await r.text();try{d=JSON.parse(raw);}catch(e){if(/1102|exceeded.*(CPU|resource)|CPU.*limit/i.test(raw))throw new Error('서버 처리 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.');throw new Error('응답을 확인하지 못했습니다. 새로고침하고 로그인 상태를 확인해 주세요.');}if(!r.ok)throw new Error(d.error||'처리 실패');return d;}
 async function collect(sourceId){
  if(busy)return;
  await ready;
  if(busy)return;
  if(!sources.some(function(source){return source.id===sourceId;})){resultBox.textContent='정보원 목록을 확인하지 못했습니다. 새로고침해 주세요.';return;}
  const sourceName=sources.find(function(source){return source.id===sourceId;}).name;
  setBusy(true);resultBox.textContent=sourceName+' · 수집 중…';
  try {
   let notice='';
   try{const c=await api('/api/collect',{source_id:sourceId});notice='새 기사 '+c.saved+'건'+(c.warning?' · '+c.warning:'');}
   catch(e){if(!e.message.includes('10분 후'))throw e;notice='저장된 기사를 처리합니다.';}
   let success=0,failed=0;
   for(let i=0;i<30;i++){
    resultBox.textContent=sourceName+' · '+notice+' · 확인 중 '+(i+1)+'/30';
    const d=await api('/api/read-body',{source_id:sourceId});
    if(d.message)break;
    if(d.skipped)continue;
    if(d.error)failed++;else success++;
   }
   await refreshArticles();resultBox.textContent=sourceName+' · '+notice+' · 확인 '+success+'건 · 실패 '+failed+'건 · 완료';
  }catch(e){resultBox.textContent=sourceName+' · '+e.message;}
  finally{setBusy(false);document.dispatchEvent(new CustomEvent('collection-finished'));}
 }
 document.addEventListener('collection-request',function(event){collect(event.detail.sourceId).catch(function(e){resultBox.textContent=e.message;});});
 async function initialize(){
  try{const data=await api('/api/sources');sources=data.sources;}
  catch(e){resultBox.textContent=e.message;}
 }
 const ready=initialize();
})();
