// 중요 기사에만 직접 분류를 제공합니다.
function impactOf(a){return a.starred&&['기회','위협'].includes(a.impact_override)?a.impact_override:'';}

function impactControls(a){
 if(!a.starred)return '';
 const impact=impactOf(a);
 const choices='<span class="impact-choices" role="group" aria-label="기사 영향 직접 분류">'+['기회','위협'].map(function(value){
  return '<button type="button" class="impact-choice" data-impact="'+a.id+'" data-impact-value="'+value+'" aria-pressed="'+(a.impact_override===value)+'">'+(value==='기회'?'🟢':'🔴')+' '+value+'</button>';
 }).join('')+(a.impact_override?'<button type="button" class="text-button" data-impact="'+a.id+'" data-impact-value="">선택 해제</button>':'')+'</span>';
 if(!impact)return '<span class="impact-controls">'+choices+'</span>';
 const origin='직접 분류';
 return '<span class="impact-controls"><span class="chip '+(impact==='기회'?'impact-good':'impact-bad')+'" title="'+origin+'">'+(impact==='기회'?'🟢':'🔴')+' '+impact+'</span><details class="impact-edit"><summary aria-label="기사 영향 분류 변경">변경</summary>'+choices+'</details></span>';
}

async function saveImpact(button){
 const id=Number(button.getAttribute('data-impact'));
 const impact=button.getAttribute('data-impact-value');
 const container=button.closest('.impact-controls');
 container.querySelectorAll('button').forEach(function(b){b.disabled=true;});
 try{
  await postJson('/api/article-impact',{id:id,impact:impact});
  const article=articles.find(function(a){return a.id===id;});
  if(article)article.impact_override=impact;
  render();
 }catch(e){
  showNotice(e.message);
 }finally{
  container.querySelectorAll('button').forEach(function(b){b.disabled=false;});
 }
}
