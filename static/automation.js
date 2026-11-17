
(function(){
 const status=document.getElementById('auto-status'),result=document.getElementById('auto-result'),test=document.getElementById('auto-test');
 let collecting=false,testing=false,setupRequired=false;
 function updateTest(){test.disabled=collecting||testing||setupRequired;}
 document.addEventListener('collection-busy',function(event){collecting=event.detail.busy;updateTest();});
 document.addEventListener('collection-finished',function(){refresh().catch(function(e){result.textContent=e.message;});});
 async function refresh(){
  const r=await fetch('/api/automation-status');let d;try{d=await r.json();}catch(e){throw new Error('예약 상태 응답을 확인하지 못했습니다.');}if(!r.ok)throw new Error(d.error||'상태 조회 실패');
  setupRequired=Boolean(d.setupRequired);updateTest();
  if(setupRequired){status.textContent='예약 수집용 D1 설정이 필요합니다.';return;}
  status.textContent=(d.settings.enabled?'자동 수집 켜짐':'자동 수집 꺼짐')+(d.paused?' · 오늘 오류로 중지':'')+' · 대상 '+d.source_count+'곳 · 오늘 목록 확인 '+d.lists_done+'곳 ('+(d.lists_run??d.lists_done)+'회) · 기사 처리 '+d.bodies_done+'/'+d.settings.maxBodies+'회 · 실패 '+d.failed;
  document.getElementById('auto-schedule-note').textContent='원문 대기 '+(d.pending_count||0)+'건 · 현재 목록 수집 대기 '+(d.lists_due||0)+'곳'+(d.reserved_slots?' · 캐논 오후 예약 '+d.reserved_slots+'회 ('+d.reserve_release_hour+'시부터 남은 몫 재배분)':'')+(d.last_message?' · '+d.last_message:'');
  const distribution=document.getElementById('auto-distribution');distribution.replaceChildren();
  (d.categories||[]).forEach(function(c){
   const card=document.createElement('div');card.className='quota-card';
   const title=document.createElement('strong');title.textContent=c.name;card.append(title);
   const used=document.createElement('p');used.textContent='처리 '+c.done+' / 배정 목표 '+c.target+'회';card.append(used);
   const pending=document.createElement('span');pending.textContent='대기 '+c.pending+'건 · 중복 후순위 '+c.duplicates+'건';card.append(pending);distribution.append(card);
  });
  const history=document.getElementById('auto-history');history.replaceChildren();
  (d.recent||[]).forEach(function(row){const p=document.createElement('p');p.className='history-row';const when=new Date((row.started_at||'').replace(' ','T')+'Z');p.textContent=(Number.isNaN(when.getTime())?'':when.toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' · ')+row.source+' · '+(row.kind==='list'?'목록':'기사')+' · '+({running:'처리 중',success:'완료',error:'실패',aborted:'중단',skipped:'확인'}[row.status]||row.status)+' · '+(row.message||'');history.append(p);});
 }
 document.getElementById('auto-refresh').onclick=function(){refresh().catch(function(e){result.textContent=e.message;});};
 test.onclick=async function(){if(collecting||testing||setupRequired)return;testing=true;updateTest();document.dispatchEvent(new CustomEvent('collection-busy',{detail:{busy:true}}));result.textContent='다음 작업 한 개를 실행합니다…';try{const r=await fetch('/api/automation-step',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});let d;try{d=await r.json();}catch(e){throw new Error('실행 응답을 확인하지 못했습니다.');}if(!r.ok)throw new Error(d.error||'실행 실패');result.textContent=(d.source?d.source+' · ':'')+(d.message||d.status);await refresh();await refreshArticles();}catch(e){result.textContent=e.message;}finally{testing=false;document.dispatchEvent(new CustomEvent('collection-busy',{detail:{busy:false}}));updateTest();document.dispatchEvent(new CustomEvent('collection-finished'));}};
 refresh().catch(function(e){status.textContent=e.message;});
})();
