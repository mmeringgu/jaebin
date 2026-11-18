// 검증된 출처를 HTML 문자열이 아닌 DOM 요소로 표시합니다.
function reportSources(item){
 const sources=document.createElement('div');sources.className='report-sources';
 item.sources.forEach(function(source){
  if(!/^https?:\/\//i.test(source.url))return;
  const link=document.createElement('a');link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';
  link.textContent=source.source||'원문 기사';link.title=source.title;sources.append(link);
 });
 return sources;
}
function reportTable(section){
 const scroll=document.createElement('div');scroll.className='table-scroll';
 const table=document.createElement('table');table.className='report-table';
 const head=document.createElement('thead'),header=document.createElement('tr');
 ['대상','핵심 변화','영향','출처'].forEach(function(label){
  const cell=document.createElement('th');cell.scope='col';cell.textContent=label;header.append(cell);
 });
 head.append(header);table.append(head);
 const body=document.createElement('tbody');
 section.items.forEach(function(item){
  const row=document.createElement('tr');
  const target=document.createElement('th');target.scope='row';target.textContent=item.target||'';
  const change=document.createElement('td');change.className='report-change';change.textContent=item.text;
  const impact=document.createElement('td');impact.className='report-impact';
  if(item.impact==='기회'||item.impact==='위협'){
   const symbol=document.createElement('span');
   symbol.className=item.impact==='기회'?'report-positive':'report-negative';
   symbol.textContent=item.impact==='기회'?'▲':'▼';
   symbol.title=item.impact==='기회'?'긍정 영향 · 별표 기사 직접 선택':'부정 영향 · 별표 기사 직접 선택';
   symbol.setAttribute('role','img');symbol.setAttribute('aria-label',symbol.title);impact.append(symbol);
  }
  const source=document.createElement('td');source.append(reportSources(item));
  row.append(target);row.append(change);row.append(impact);row.append(source);body.append(row);
 });
 table.append(body);scroll.append(table);return scroll;
}
function renderReport(report,output){
 output.replaceChildren();
 report.sections.forEach(function(section){
  const heading=document.createElement('h3');heading.textContent=section.title;output.append(heading);
  if(!section.items.length){
   const empty=document.createElement('p');empty.className='muted';empty.textContent='월간 요약에 포함할 항목이 없습니다.';output.append(empty);return;
  }
  if(section.format==='table'){output.append(reportTable(section));return;}
  const list=document.createElement('ul');
  section.items.forEach(function(item){
   const row=document.createElement('li');
   const text=document.createElement('div');text.textContent=item.text;row.append(text);
   row.append(reportSources(item));list.append(row);
  });
  output.append(list);
 });
}
(function(){
 // 월간 요약: 최근 30일 기사를 바탕으로 생성합니다.
 const monthButton=document.getElementById('report-month-button');
 const statusBox=document.getElementById('report-status');
 const output=document.getElementById('report-output');

 async function makeReport(){
  monthButton.disabled=true;
  output.replaceChildren();
  statusBox.textContent='월간 요약을 만드는 중입니다… (최대 2분 정도 걸릴 수 있어요)';
  try{
   const r=await fetch('/api/monthly-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
   let d;try{d=await r.json();}catch(e){throw new Error('월간 요약 응답을 확인하지 못했습니다. 시간이 오래 걸렸을 수 있으니 잠시 후 다시 눌러 주세요.');}
   if(!r.ok)throw new Error(d.error||'월간 요약을 만들지 못했습니다.');
   renderReport(d.report,output);
   statusBox.textContent=d.since+' ~ '+d.until+' · 기사 '+d.article_count+'건으로 작성';
  }catch(e){statusBox.textContent=e.message;}
  finally{monthButton.disabled=false;}
 }
 monthButton.addEventListener('click',makeReport);

})();
