
(function(){
 const status=document.getElementById('auto-status'),result=document.getElementById('auto-result'),test=document.getElementById('auto-test'),refreshButton=document.getElementById('auto-refresh');
 let collecting=false,testing=false,setupRequired=false;
 function updateTest(){test.disabled=collecting||testing||setupRequired;}
 document.addEventListener('collection-busy',function(event){collecting=event.detail.busy;updateTest();});
 document.addEventListener('collection-finished',function(){refresh().catch(function(e){result.textContent=e.message;});});
 async function refresh(){
  const r=await fetch('/api/automation-status');let d;try{d=await r.json();}catch(e){throw new Error('예약 상태 응답을 확인하지 못했습니다.');}if(!r.ok)throw new Error(d.error||'상태 조회 실패');
  setupRequired=Boolean(d.setupRequired);updateTest();
  if(setupRequired){status.textContent='예약 수집용 D1 설정이 필요합니다.';return;}
  // 한 줄에 몰려 있던 상태를 작은 칸 여러 개로 나눠 보여줍니다.
  status.replaceChildren();
  function pill(text,bad){const span=document.createElement('span');span.textContent=text;if(bad)span.className='pill-bad';status.append(span);}
  pill(d.paused?'자동 수집 중지':d.settings.enabled?'자동 수집 켜짐':'자동 수집 꺼짐',d.paused||!d.settings.enabled);
  pill('오늘 게시 '+(d.published_today||0)+'건');
  pill('원문 처리 '+d.bodies_done+' / '+d.settings.maxBodies+'회');
  pill('처리 대기 '+(d.pending_count||0)+'건');
  if(d.failed)pill('실패 '+d.failed+'회',true);
  const last=d.last_tick?new Date(d.last_tick.replace(' ','T')+'Z'):null;
  document.getElementById('auto-schedule-note').textContent=(last&&!Number.isNaN(last.getTime())?'마지막 실행 '+last.toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'아직 자동 수집 실행 기록이 없습니다.')+(d.paused&&d.last_message?' · '+d.last_message:'');
  const distribution=document.getElementById('auto-distribution');distribution.replaceChildren();
  (d.categories||[]).forEach(function(c){
   const card=document.createElement('div');card.className='quota-card';
   const title=document.createElement('strong');title.textContent=c.name;card.append(title);
   const used=document.createElement('p');used.textContent='처리 '+c.done+' / 목표 '+c.target+'회';card.append(used);
   const pending=document.createElement('span');pending.textContent='대기 '+c.pending+'건 · 중복 후순위 '+c.duplicates+'건';card.append(pending);distribution.append(card);
  });
  const history=document.getElementById('auto-history');history.replaceChildren();
  (d.recent||[]).forEach(function(row){const p=document.createElement('p');p.className='history-row';const when=new Date((row.started_at||'').replace(' ','T')+'Z');p.textContent=(Number.isNaN(when.getTime())?'':when.toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' · ')+row.source+' · '+(row.kind==='list'?'목록':'기사')+' · '+({running:'처리 중',success:'완료',error:'실패',aborted:'중단',skipped:'확인'}[row.status]||row.status)+' · '+(row.message||'');history.append(p);});
 }
 // 상태 확인: 누르는 동안 버튼을 잠그고 "확인 중…"을 보여줍니다. 오류는 바로 위 상태 칸에 보여줍니다.
 refreshButton.onclick=async function(){refreshButton.disabled=true;refreshButton.textContent='확인 중…';try{await refresh();}catch(e){status.textContent=e.message;}finally{refreshButton.disabled=false;refreshButton.textContent='상태 확인';}};
 test.onclick=async function(){if(collecting||testing||setupRequired)return;testing=true;updateTest();document.dispatchEvent(new CustomEvent('collection-busy',{detail:{busy:true}}));result.textContent='다음 작업 한 개를 실행합니다…';try{const r=await fetch('/api/automation-step',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});let d;try{d=await r.json();}catch(e){throw new Error('실행 응답을 확인하지 못했습니다.');}if(!r.ok)throw new Error(d.error||'실행 실패');result.textContent=(d.source?d.source+' · ':'')+(d.message||d.status);await refresh();await refreshArticles();}catch(e){result.textContent=e.message;}finally{testing=false;document.dispatchEvent(new CustomEvent('collection-busy',{detail:{busy:false}}));updateTest();document.dispatchEvent(new CustomEvent('collection-finished'));}};
 refresh().catch(function(e){status.textContent=e.message;});
})();
