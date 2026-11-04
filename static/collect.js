
(function(){
 const select=document.getElementById('collect-source');
 const button=document.getElementById('collect-button');
 const resultBox=document.getElementById('collect-result');
 const toggle=document.getElementById('show-other');
 let rows=[];
 async function api(path,input){const r=await fetch(path,input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{});let d;const raw=await r.text();try{d=JSON.parse(raw);}catch(e){if(/1102|exceeded.*(CPU|resource)|CPU.*limit/i.test(raw))throw new Error('FastAPI 실행 자원 한도를 초과했습니다.');throw new Error('응답을 확인하지 못했습니다. 새로고침하고 로그인 상태를 확인해 주세요.');}if(!r.ok)throw new Error(d.error||'처리 실패');return d;}
 function render(){
  const box=document.getElementById('candidate-list');box.replaceChildren();
  const selected=rows.filter(function(a){return a.selection.level==='full';});
  const mainOnly=rows.filter(function(a){return a.selection.level==='main';});
  const unknown=rows.filter(function(a){return a.fetch_status==='success'&&!a.published_date;}).length;
  document.getElementById('selection-count').textContent='우선 선별 '+selected.length+' · 메인 일치 '+mainOnly.length+' · 처리 중 '+rows.filter(function(a){return a.fetch_status==='pending';}).length+' · 실패 '+rows.filter(function(a){return a.fetch_status==='error';}).length+' · 날짜 미확인 '+unknown;
  (toggle.checked?rows.filter(function(a){return a.selection.selected;}):selected).forEach(function(a){
   const item=document.createElement('div');item.className='candidate';
   const link=document.createElement('a');link.textContent=a.source_name+' · '+a.title;link.href=a.url;link.target='_blank';link.rel='noopener noreferrer';item.append(link);
   const info=document.createElement('div');info.className='candidate-info';info.textContent='발행일 '+(a.published_date||'미확인')+' · '+(a.selection.level==='full'?'우선 선별':'메인 일치')+(a.fetch_status==='error'?' · 내용 확인 실패':a.fetch_status==='pending'?' · 처리 중':'');item.append(info);
   const reason=document.createElement('div');reason.className='candidate-reason';reason.textContent=(a.selection.reasons.length?'기준: '+a.selection.reasons.join(' / '):'')+(a.fetch_error?' · '+a.fetch_error:'');item.append(reason);
   if(a.excerpt.subtitle){const sub=document.createElement('p');sub.textContent=a.excerpt.subtitle;sub.className='candidate-sub';item.append(sub);}
   if(a.excerpt.first_paragraph){const lead=document.createElement('p');lead.textContent=a.excerpt.first_paragraph;lead.className='candidate-lead';item.append(lead);}
   box.append(item);
  });
  if(!selected.length&&!toggle.checked){const p=document.createElement('p');p.textContent='우선 선별 기사가 없습니다. 메인 일치 기사를 확인해 주세요.';box.append(p);}
 }
 async function refresh(){const d=await api('/api/candidates?source_id='+encodeURIComponent(select.value));rows=d.candidates;render();}
 select.onchange=async function(){rows=[];render();try{await refresh();resultBox.textContent='저장된 기사입니다.';}catch(e){resultBox.textContent=e.message;}};
 toggle.onchange=render;
 button.onclick=async function(){
  button.disabled=true;select.disabled=true;resultBox.textContent='수집 중…';
  try {
   let notice='';
   try{const c=await api('/api/collect',{source_id:select.value});notice='새 기사 '+c.saved+'건'+(c.warning?' · '+c.warning:'');}
   catch(e){if(!e.message.includes('10분 후'))throw e;notice='저장된 기사를 처리합니다.';}
   let success=0,failed=0;
   for(let i=0;i<30;i++){
    resultBox.textContent=notice+' · 확인 중 '+(i+1)+'/30';
    const d=await api('/api/read-body',{source_id:select.value});
    if(d.message)break;
    if(d.skipped)continue;
    if(d.error)failed++;else success++;
   }
   await refresh();await refreshArticles();resultBox.textContent=notice+' · 확인 '+success+'건 · 실패 '+failed+'건 · 완료';
  }catch(e){resultBox.textContent=e.message;try{await refresh();}catch(ignore){}}
  finally{button.disabled=false;select.disabled=false;}
 };
 async function initialize(){
  button.disabled=true;select.disabled=true;
  try{
   const data=await api('/api/sources');select.replaceChildren();
   data.sources.forEach(function(s){const option=document.createElement('option');option.value=s.id;option.textContent=s.name;select.append(option);});
   await refresh();
  }catch(e){resultBox.textContent=e.message;}
  finally{button.disabled=false;select.disabled=false;}
 }
 initialize();
})();
