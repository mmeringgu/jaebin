// 검증된 출처를 HTML 문자열이 아닌 DOM 요소로 표시합니다.
function renderReport(report,output){
 output.replaceChildren();
 report.sections.forEach(function(section){
  const heading=document.createElement('h3');heading.textContent=section.title;output.append(heading);
  if(!section.items.length){
   const empty=document.createElement('p');empty.className='muted';empty.textContent='리포트에 포함할 항목이 없습니다.';output.append(empty);return;
  }
  const list=document.createElement('ul');
  section.items.forEach(function(item){
   const row=document.createElement('li');
   const text=document.createElement('div');text.textContent=item.text;row.append(text);
   const sources=document.createElement('div');sources.className='report-sources';
   item.sources.forEach(function(source){
    if(!/^https?:\/\//i.test(source.url))return;
    const link=document.createElement('a');link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';
    link.textContent=source.source||'원문 기사';link.title=source.title;sources.append(link);
   });
   row.append(sources);list.append(row);
  });
  output.append(list);
 });
}
(function(){
 // 주간·월간 리포트: 버튼을 누르면 서버가 GPT로 최근 7일(주간) 또는 30일(월간) 리포트를 만들어 돌려줍니다.
 const weekButton=document.getElementById('report-button');
 const monthButton=document.getElementById('report-month-button');
 const statusBox=document.getElementById('report-status');
 const output=document.getElementById('report-output');

 // period는 "week"(주간) 또는 "month"(월간)입니다.
 async function makeReport(period){
  weekButton.disabled=true;monthButton.disabled=true;
  output.replaceChildren();
  statusBox.textContent=(period==='month'?'월간':'주간')+' 리포트를 만드는 중입니다… (최대 2분 정도 걸릴 수 있어요)';
  try{
   const r=await fetch('/api/weekly-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({period:period})});
   const d=await r.json();
   if(!r.ok)throw new Error(d.error||'리포트를 만들지 못했습니다.');
   renderReport(d.report,output);
   statusBox.textContent=d.since+' ~ '+d.until+' · 기사 '+d.article_count+'건으로 작성';
  }catch(e){statusBox.textContent=e.message;}
  finally{weekButton.disabled=false;monthButton.disabled=false;}
 }
 weekButton.addEventListener('click',function(){makeReport('week');});
 monthButton.addEventListener('click',function(){makeReport('month');});

})();
