(function(){
 const get=function(id){return document.getElementById('manual-'+id);};
 const form=document.getElementById('manual-article-form'),fields=get('fields'),status=get('status');
 const url=get('url'),preview=get('preview'),save=get('save');
 let articleUrl='',busy=false;
 function setBusy(value){busy=value;preview.disabled=value;save.disabled=value;fields.disabled=value||!articleUrl;url.disabled=value;}
 async function post(path,data){
  const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  let d;try{d=await r.json();}catch(e){throw new Error('응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');}
  if(!r.ok)throw new Error(d.error||'기사 추가에 실패했습니다.');return d;
 }
 url.addEventListener('input',function(){articleUrl='';fields.hidden=true;fields.disabled=true;status.textContent='';});
 preview.onclick=async function(){
  if(busy||!url.reportValidity())return;
  articleUrl='';fields.hidden=true;setBusy(true);status.textContent='기사 정보를 확인하는 중…';
  try{
   const d=await post('/api/manual-article-preview',{url:url.value.trim()});
   articleUrl=d.article.url;
   ['title','source','date','category','summary'].forEach(function(key){get(key).value=d.article[key]||'';});
   fields.hidden=false;status.textContent='내용을 확인하고 비어 있는 정보를 보완한 뒤 추가해 주세요.';
  }catch(e){status.textContent=e.message;}
  finally{setBusy(false);}
 };
 form.addEventListener('submit',async function(event){
  event.preventDefault();if(busy||!articleUrl||!form.reportValidity())return;
  const payload={url:articleUrl};['title','source','date','category','summary'].forEach(function(key){payload[key]=get(key).value.trim();});
  setBusy(true);status.textContent='기사를 추가하는 중…';
  try{
   const d=await post('/api/manual-article',payload);
   articleUrl='';form.reset();fields.hidden=true;
   status.textContent='추가 완료 · '+d.article.title;
   try{await refreshArticles();}catch(e){status.textContent+=' · 목록을 새로고침해 주세요.';}
   document.dispatchEvent(new CustomEvent('collection-finished'));
  }catch(e){status.textContent=e.message;}
  finally{setBusy(false);}
 });
})();
