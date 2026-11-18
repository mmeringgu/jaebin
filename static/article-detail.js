(function(){
 const requests=new Map();
 document.addEventListener('toggle',async function(event){
  const details=event.target;
  if(!details.matches('details[data-article-detail]')||!details.open)return;
  const id=Number(details.getAttribute('data-article-detail'));
  const article=articles.find(function(a){return a.id===id;});
  if(!article||article.detail_loaded)return;
  const status=details.querySelector('.detail-message');
  status.hidden=false;status.textContent='추가 본문을 불러오는 중…';
  try{
   if(!requests.has(id))requests.set(id,(async function(){
    const r=await fetch('/api/article-detail?id='+id);
    let d;try{d=await r.json();}catch(e){throw new Error('추가 본문 응답을 확인하지 못했습니다. 원문 링크에서 확인해 주세요.');}
    if(!r.ok||!d.text)throw new Error(d.error||'추가 본문을 확인하지 못했습니다. 원문 링크에서 확인해 주세요.');
    return d.text;
   })());
   const text=await requests.get(id);
   article.detail_text=text;article.detail_loaded=true;
   const current=articles.find(function(a){return a.id===id;});
   if(current){current.detail_text=text;current.detail_loaded=true;}
   const rest=splitText(article).rest,body=details.querySelector('.detail-text');
   body.textContent=rest;body.hidden=!rest;
   status.textContent='확인된 본문은 위에 모두 표시했습니다. 더 읽으려면 원문 링크를 이용해 주세요.';
   status.hidden=Boolean(rest);
  }catch(e){requests.delete(id);status.textContent=e.message;}
 },true);
})();
