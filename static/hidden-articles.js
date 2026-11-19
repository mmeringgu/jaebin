(function(){
 const details=document.getElementById('hidden-article-management');if(!details)return;
 const output=document.getElementById('hidden-articles-output'),status=document.getElementById('hidden-articles-status'),refresh=document.getElementById('hidden-articles-refresh');
 const request=(...args)=>globalThis.AdminAccess?globalThis.AdminAccess.request(...args):fetch(...args);
 const categories={company:'캐논 뉴스',competitor:'경쟁사',policy:'정책',hospital:'병원',conference:'학회'};
 let busy=false;
 function render(rows){
  output.replaceChildren();
  if(!rows.length){status.textContent='숨긴 기사가 없습니다.';return;}
  status.textContent='숨긴 기사 '+rows.length+'건';
  const table=document.createElement('table');table.className='hidden-articles-table';
  const head=document.createElement('thead'),header=document.createElement('tr');
  ['기사','분류','발행일','출처','표시'].forEach(function(label){const cell=document.createElement('th');cell.scope='col';cell.textContent=label;header.append(cell);});
  head.append(header);table.append(head);
  const body=document.createElement('tbody');
  rows.forEach(function(a){
   const row=document.createElement('tr'),title=document.createElement('td');
   if(/^https?:\/\//i.test(a.url)){
    const link=document.createElement('a');link.href=a.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=a.title;title.append(link);
   }else title.textContent=a.title;
   row.append(title);
   [categories[a.category]||a.category,a.date,globalThis.NewsRules?.companyLabel(a.source)||a.source].forEach(function(value){const cell=document.createElement('td');cell.textContent=value||'';row.append(cell);});
   const action=document.createElement('td'),button=document.createElement('button');button.type='button';button.className='button';button.textContent='다시 보이기';
   button.addEventListener('click',async function(){
    if(busy)return;busy=true;refresh.disabled=true;button.disabled=true;status.textContent='기사를 다시 표시하는 중…';
    try{
     const response=await request('/api/article-hide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:a.id,hidden:false})});
     const data=await response.json();if(!response.ok)throw new Error(data.error||'기사를 다시 표시하지 못했습니다.');
     busy=false;await load();
     try{if(typeof refreshArticles==='function')await refreshArticles();}catch{status.textContent+=' · 뉴스 목록을 새로고침해 주세요.';}
    }catch(error){status.textContent=error.message;button.disabled=false;}
    finally{busy=false;refresh.disabled=false;}
   });
   action.append(button);row.append(action);body.append(row);
  });
  table.append(body);output.append(table);
 }
 async function load(){
  if(busy)return;
  if(globalThis.AdminAccess)await globalThis.AdminAccess.ready;
  busy=true;refresh.disabled=true;status.textContent='숨긴 기사를 불러오는 중…';
  try{
   const response=await request('/api/hidden-articles');const data=await response.json();
   if(!response.ok)throw new Error(data.error||'숨긴 기사를 불러오지 못했습니다.');
   if(!Array.isArray(data.articles))throw new Error('기사 목록을 확인하지 못했습니다.');
   render(data.articles);
  }catch(error){status.textContent=error.message;}
  finally{busy=false;refresh.disabled=false;}
 }
 details.addEventListener('toggle',function(){if(details.open)load();});
 refresh.addEventListener('click',load);
 ['hidden-articles-changed','collection-finished'].forEach(function(name){document.addEventListener(name,function(){if(details.open)load();});});
})();
