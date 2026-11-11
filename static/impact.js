// 제목 자동 판단과 수동 분류 전용입니다. AI 인사이트는 판단에 사용하지 않습니다.
function guessImpact(a){return NewsRules.guessImpact(a);}
function impactOf(a){return NewsRules.impactOf(a);}

function impactControls(a){
 const impact=impactOf(a);
 const choices='<span class="impact-choices" role="group" aria-label="기사 영향 직접 분류">'+['기회','위협'].map(function(value){
  return '<button type="button" class="impact-choice" data-impact="'+a.id+'" data-impact-value="'+value+'" aria-pressed="'+(a.impact_override===value)+'">'+(value==='기회'?'🟢':'🔴')+' '+value+'</button>';
 }).join('')+(a.impact_override?'<button type="button" class="text-button" data-impact="'+a.id+'" data-impact-value="">선택 해제</button>':'')+'</span>';
 if(!impact)return '<span class="impact-controls"><span class="muted impact-prompt">직접 분류</span>'+choices+'</span>';
 const origin=a.impact_override?'직접 분류':'제목 기준 추정';
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
  alert(e.message);
 }finally{
  container.querySelectorAll('button').forEach(function(b){b.disabled=false;});
 }
}
