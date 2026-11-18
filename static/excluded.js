(function(){
 const details=document.getElementById('excluded-articles-details'),box=document.getElementById('excluded-list'),status=document.getElementById('excluded-status'),button=document.getElementById('excluded-refresh');
 let busy=false,loaded=false;
 async function load(){
  if(busy)return;
  busy=true;button.disabled=true;status.textContent='제외 기사를 확인하는 중…';
  try{
   const r=await fetch('/api/excluded-articles');
   let data;try{data=await r.json();}catch(e){throw new Error('제외 기사 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');}
   if(!r.ok)throw new Error(data.error||'제외 기사 조회 실패');
   if(!Array.isArray(data.articles))throw new Error('제외 기사 응답을 확인하지 못했습니다.');
   box.replaceChildren();
   data.articles.forEach(function(a){
    const item=document.createElement('div');item.className='candidate';
    const link=document.createElement('a');link.textContent=a.title;link.href=a.url;link.target='_blank';link.rel='noopener noreferrer';item.append(link);
    const info=document.createElement('div');info.className='candidate-info';info.textContent=a.date+' · '+a.source;item.append(info);
    const reason=document.createElement('p');reason.className='candidate-reason';reason.textContent=(a.selection?.reasons||[]).join(' / ');item.append(reason);
    box.append(item);
   });
   status.textContent='현재 기준에서 제외된 기사 '+data.articles.length+'건';loaded=true;
  }catch(e){status.textContent=e.message;}
  finally{busy=false;button.disabled=false;}
 }
 details.addEventListener('toggle',function(){if(details.open&&!loaded)load();});
 button.onclick=load;
 document.addEventListener('collection-finished',function(){loaded=false;if(details.open)load();});
})();
