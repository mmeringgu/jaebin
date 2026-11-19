(function(){
 const dashboard=document.getElementById('industry-dashboard');if(!dashboard)return;
 const companies=['GE','Siemens','Philips','Samsung Medison'];
 const state={recalls:{rows:[],results:[],page:1},approvals:{rows:[],results:[],page:1}};
 let loading=false,lastLoaded=0;
 const details=new Map();
 const get=id=>document.getElementById('industry-'+id);
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const day=(days=0)=>new Date(Date.now()-days*86400000+9*3600000).toISOString().slice(0,10);
 function sourceLink(row,label){
  try{const u=new URL(row.url);if(u.origin==='https://emedi.mfds.go.kr')return '<a href="'+escape(u.href)+'" target="_blank" rel="noopener noreferrer" title="'+escape(row.item_name+' · '+row.permit+(row.reason?' · '+row.reason:''))+'">'+escape(label)+'</a>';}catch{}
  return escape(label);
 }
 function draw(kind){
  const size=kind==='recalls'?4:5;
  const s=state[kind],company=get('company').value,period=Number(get('approval-period').value),since=day(period-1);
  const rows=s.rows.filter(r=>(!company||r.company===company)&&(kind!=='approvals'||r.date>=since&&r.date<=day()));
  const pages=Math.max(1,Math.ceil(rows.length/size));s.page=Math.max(1,Math.min(s.page,pages));
  const shown=rows.slice((s.page-1)*size,s.page*size);
  const selected=s.results.filter(r=>!company||r.company===company),failed=selected.filter(r=>r.error),partial=selected.some(r=>r.data?.partial),stale=selected.some(r=>r.data?.stale);
  if(kind==='recalls')get(kind+'-output').innerHTML=shown.length?'<ul class="industry-recall-list">'+shown.map(r=>{const detail=details.get(r.id);return '<li><div class="industry-record-heading"><div class="industry-record-title">'+sourceLink({...r,reason:detail?.reason},detail?.model||r.item_name)+'</div><span class="industry-record-family">'+escape(r.family)+'</span><span class="industry-record-company">'+escape(r.company)+'</span></div><div class="industry-record-detail"><time datetime="'+escape(r.date)+'">'+escape(r.date.slice(2).replace(/-/g,'.'))+'</time><span>'+escape(r.action)+' · '+escape(r.permit)+'</span></div></li>';}).join('')+'</ul>':empty();
  else get(kind+'-output').innerHTML=shown.length?'<div class="table-scroll"><table class="industry-approval-table"><thead><tr><th scope="col">회사</th><th scope="col">장비</th><th scope="col">모델</th><th scope="col">허가일</th></tr></thead><tbody>'+shown.map(r=>'<tr><th scope="row">'+escape(r.company)+'</th><td>'+escape(r.family)+'</td><td>'+sourceLink(r,r.model||r.item_name)+'<span class="industry-permit">'+escape(r.permit)+'</span></td><td><time datetime="'+escape(r.date)+'">'+escape(r.date.slice(2).replace(/-/g,'.'))+'</time></td></tr>').join('')+'</tbody></table></div>':empty();
  function empty(){return '<p class="industry-empty">'+(loading?'공식자료를 불러오는 중…':failed.length?'일부 공식자료를 불러오지 못했습니다.':partial?'조회된 자료에서 조건에 맞는 항목이 없습니다.':'조건에 맞는 '+(kind==='recalls'?'진행중 회수 공지':'인허가 자료')+'가 없습니다.')+'</p>';}
  get(kind+'-pages').innerHTML=pages>1?'<button type="button" data-industry-page="'+kind+'" data-step="-1" '+(s.page===1?'disabled':'')+' aria-label="'+(kind==='recalls'?'회수':'인허가')+' 이전 페이지">이전</button><span>'+s.page+' / '+pages+'</span><button type="button" data-industry-page="'+kind+'" data-step="1" '+(s.page===pages?'disabled':'')+' aria-label="'+(kind==='recalls'?'회수':'인허가')+' 다음 페이지">다음</button>':'';
  const dates=selected.map(r=>r.data?.fetched_at).filter(Boolean).sort(),notes=[];
  if(loading)notes.push('조회 중…');
  if(failed.length)notes.push(failed.map(r=>r.company).join(', ')+' 조회 실패');
  if(partial)notes.push('일부 자료만 조회됨 · 전체는 식약처에서 확인');
  if(stale)notes.push('갱신 실패 · 이전 조회자료 표시');
  if(dates.length)notes.push(new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(dates[0]))+' 확인');
  get(kind+'-status').textContent=notes.join(' · ');
  if(kind==='recalls')shown.forEach(r=>{
   if(details.has(r.id))return;details.set(r.id,{});
   fetch('/api/industry-recall-detail?'+new URLSearchParams({id:r.id,permit:r.permit}),{signal:AbortSignal.timeout(35000)}).then(async response=>{
    if(!response.ok)return;const detail=await response.json();if(detail.id===r.id){details.set(r.id,detail);draw('recalls');}
   }).catch(()=>{/* The official notice link remains usable when enrichment is unavailable. */});
  });
 }
 function drawAll(){draw('recalls');draw('approvals');}
 async function load(){
  if(loading||lastLoaded&&Date.now()-lastLoaded<6*3600000)return;
  loading=true;drawAll();
  await Promise.all(['recalls','approvals'].map(async kind=>{
   const results=await Promise.all(companies.map(async company=>{
    try{
     const response=await fetch('/api/industry-official?'+new URLSearchParams({kind,company}),{signal:AbortSignal.timeout(90000)});
     const data=await response.json();if(!response.ok||!Array.isArray(data.records))throw new Error(data.error||'공식자료 조회 실패');
     return {company,data};
    }catch(error){return {company,error:error.message};}
   }));
   // Keep a previously loaded company on transient errors instead of clearing its records.
   state[kind].results=results.map(r=>r.error?{...r,data:state[kind].results.find(old=>old.company===r.company)?.data}:r);
   state[kind].rows=state[kind].results.flatMap(r=>r.data?.records||[]).sort((a,b)=>b.date.localeCompare(a.date)||String(b.id).localeCompare(String(a.id)));
   draw(kind);
  }));
  loading=false;if(['recalls','approvals'].every(kind=>state[kind].results.every(r=>!r.error&&!r.data?.stale)))lastLoaded=Date.now();drawAll();
 }
 get('company').addEventListener('change',()=>{state.recalls.page=state.approvals.page=1;drawAll();});
 get('approval-period').addEventListener('change',()=>{state.approvals.page=1;draw('approvals');});
 dashboard.addEventListener('click',event=>{
  const button=event.target.closest('button[data-industry-page]');if(!button)return;
  const kind=button.dataset.industryPage,step=Number(button.dataset.step);if(!state[kind]||![-1,1].includes(step))return;
  state[kind].page+=step;draw(kind);
 });
 const panel=document.querySelector('[data-panel="stats"]');
 if(typeof MutationObserver==='function')new MutationObserver(()=>{if(!panel.hidden)load();}).observe(panel,{attributes:true,attributeFilter:['hidden']});
 document.querySelector('[data-tab="stats"]').addEventListener('click',()=>load());
 if(!panel.hidden)load();
})();
