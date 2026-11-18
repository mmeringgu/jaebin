// 검증된 출처를 HTML 문자열이 아닌 DOM 요소로 표시합니다.
function reportSources(item){
 const sources=document.createElement('div');sources.className='report-sources';
 item.sources.forEach(function(source){
  if(!/^https?:\/\//i.test(source.url))return;
  const link=document.createElement('a');link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';
  link.textContent=(source.source||'원문 기사')+(source.date?' · '+source.date:'');link.title=source.title;sources.append(link);
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
   symbol.title=item.impact==='기회'?'긍정 영향 · 중요 기사 직접 선택':'부정 영향 · 중요 기사 직접 선택';
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
   const empty=document.createElement('p');empty.className='muted';empty.textContent=section.empty_message||'월간 요약에 포함할 항목이 없습니다.';output.append(empty);return;
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
// 월간 요약은 생성 요청 없이 중요 기사에서 바로 계산합니다.
function importantReport(list){
 const since=kstDate(29),until=kstDate(0);
 const important=NewsRules.monthlyArticles(list,since,until);
 const categories={company:'캐논 뉴스',policy:'정책',hospital:'병원',conference:'학회',competitor:'경쟁사'};
 function item(a){return {target:a.entity||categories[a.category]||'중요 기사',text:a.title,
  impact:['기회','위협'].includes(a.impact_override)?a.impact_override:'',
  sources:[{title:a.title,url:a.url,source:a.source,date:a.date}]};}
 return {since:since,until:until,count:important.length,
  unclassified:important.filter(function(a){return a.category!=='policy'&&!['기회','위협'].includes(a.impact_override);}).length,sections:[
  {title:'정책',format:'table',empty_message:'선택된 정책 기사가 없습니다.',items:important.filter(function(a){return a.category==='policy'&&!['기회','위협'].includes(a.impact_override);}).map(item)},
  {title:'기회',format:'table',empty_message:'선택된 기사가 없습니다.',items:important.filter(function(a){return a.impact_override==='기회';}).map(item)},
  {title:'위협',format:'table',empty_message:'선택된 기사가 없습니다.',items:important.filter(function(a){return a.impact_override==='위협';}).map(item)}
 ]};
}
function renderMonthlySummary(){
 const report=importantReport(articles);
 renderReport(report,document.getElementById('report-output'));
 document.getElementById('report-status').textContent=report.since+' ~ '+report.until+' · 중요 기사 '+report.count+'건'
  +(report.unclassified?' · 미분류 '+report.unclassified+'건: 중요 기사에서 기회·위협을 선택해 주세요.':'');
 refreshInsightState(report);
}
let monthlyInsightKey='',monthlyInsightBusy=false,monthlyInsightRequest=0;
function insightKey(){return JSON.stringify(NewsRules.monthlyArticles(articles,kstDate(29),kstDate(0))
 .map(function(a){return [a.id,a.url,a.title,a.summary,a.impact_override,a.category];}));}
function refreshInsightState(report){
 const button=document.getElementById('monthly-insight-button');
 if(!button)return;
 const key=insightKey();
 if(monthlyInsightKey&&monthlyInsightKey!==key){
  monthlyInsightRequest++;monthlyInsightBusy=false;monthlyInsightKey='';
  document.getElementById('monthly-insight-output').replaceChildren();
  document.getElementById('monthly-insight-status').textContent='중요 기사가 변경되었습니다. 인사이트를 다시 만들어 주세요.';
 }
 button.disabled=monthlyInsightBusy||report.count===0;
 button.textContent=monthlyInsightBusy?'AI 인사이트 만드는 중…':'AI 인사이트 만들기';
}
async function createMonthlyInsights(){
 if(monthlyInsightBusy)return;
 const report=importantReport(articles),status=document.getElementById('monthly-insight-status');
 if(!report.count){status.textContent='최근 30일의 중요 기사가 없습니다.';return;}
 monthlyInsightBusy=true;monthlyInsightKey=insightKey();const requestId=++monthlyInsightRequest;
 status.textContent='중요 기사를 바탕으로 대응 방향과 비즈니스 영향을 분석하고 있습니다…';refreshInsightState(report);
 try{
  const response=await fetch('/api/monthly-report',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'인사이트를 만들지 못했습니다. 다시 시도해 주세요.');
  if(requestId!==monthlyInsightRequest||monthlyInsightKey!==insightKey())return;
  const items=data.report&&data.report.insights;
  if(!Array.isArray(items)||items.length<2||items.length>3)throw new Error('인사이트 응답을 확인하지 못했습니다. 다시 시도해 주세요.');
  const output=document.getElementById('monthly-insight-output');output.replaceChildren();
  const list=document.createElement('ul');
  items.forEach(function(item){const row=document.createElement('li'),text=document.createElement('div');text.textContent=item.text;
   row.append(text);row.append(reportSources(item));list.append(row);});output.append(list);
  status.textContent=data.since+' ~ '+data.until+' · 중요 기사 '+data.article_count+'건 분석';
 }catch(error){if(requestId===monthlyInsightRequest)status.textContent=error.message;}
 finally{if(requestId===monthlyInsightRequest){monthlyInsightBusy=false;refreshInsightState(importantReport(articles));}}
}
(function(){
 const button=document.getElementById('monthly-insight-button');
 if(button&&button.addEventListener)button.addEventListener('click',createMonthlyInsights);
 renderMonthlySummary();
})();
