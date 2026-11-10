// 수집 관리 탭의 "정보원 상태" 표를 그립니다.
// 정보원마다 마지막으로 확인한 시각, 최근 7일 새 기사 수, 며칠째 새 기사가 없는지를 보여줍니다.
(function(){
 const box=document.getElementById('source-status');
 const refreshButton=document.getElementById('source-status-refresh');

 // DB 시각("2026-11-04 01:31:01", 세계 표준시)을 한국 시각 글자로 바꿉니다.
 function koreaTime(value){
  if(!value)return '-';
  const date=new Date(value.replace(' ','T')+'Z');
  return date.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
 }

 // 지금부터 며칠 전인지 계산합니다.
 function daysAgo(value){
  const date=new Date(value.replace(' ','T')+'Z');
  return Math.floor((Date.now()-date.getTime())/(24*60*60*1000));
 }

 // 상태 글자와 색깔(good/warn/bad/none)을 정합니다.
 function judge(s){
  if(s.lastError)return {label:'수집 실패',level:'bad',detail:s.lastError};
  if(!s.lastRun)return {label:'기록 없음',level:'none',detail:'최근 7일 동안 수집한 적이 없습니다.'};
  if(!s.lastNew)return {label:'7일째 새 기사 없음',level:'warn',detail:''};
  const days=daysAgo(s.lastNew);
  if(days>=3)return {label:days+'일째 새 기사 없음',level:'warn',detail:''};
  return {label:'정상',level:'good',detail:''};
 }

 function escapeText(value){
  return String(value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
 }

 async function load(){
  box.textContent='불러오는 중…';
  try{
   const r=await fetch('/api/source-status');
   const d=await r.json();
   if(!r.ok)throw new Error(d.error||'정보원 상태를 불러오지 못했습니다.');
   // 문제 있는 정보원이 위로 오게 정렬합니다. (실패 → 새 기사 없음 → 기록 없음 → 정상)
   const order={bad:0,warn:1,none:2,good:3};
   const rows=d.sources.map(function(s){return {s:s,j:judge(s)};}).sort(function(a,b){return order[a.j.level]-order[b.j.level];});
   box.innerHTML='<table class="source-table"><thead><tr><th>정보원</th><th>상태</th><th>마지막 확인</th><th>최근 7일 새 기사</th></tr></thead><tbody>'+
    rows.map(function(x){
     return '<tr><td>'+escapeText(x.s.name)+'</td><td><span class="badge badge-'+x.j.level+'" title="'+escapeText(x.j.detail)+'">'+escapeText(x.j.label)+'</span></td><td>'+koreaTime(x.s.lastRun)+'</td><td>'+x.s.newCount+'건</td></tr>';
    }).join('')+'</tbody></table>';
  }catch(e){
   box.textContent=e.message;
  }
 }

 refreshButton.onclick=load;
 load();
})();
