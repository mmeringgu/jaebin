// 검증된 출처를 HTML 문자열이 아닌 DOM 요소로 표시합니다.
function reportSources(item){
 const sources=document.createElement('div');sources.className='report-sources';
 item.sources.forEach(function(source){
  if(!/^https?:\/\//i.test(source.url))return;
  const link=document.createElement('a');link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';
  link.textContent=(globalThis.NewsRules?.companyLabel(source.source||'원문 기사')||source.source||'원문 기사')+(source.date?' · '+source.date:'');link.title=source.title;sources.append(link);
 });
 return sources;
}
function reportTable(section){
 const scroll=document.createElement('div');scroll.className='table-scroll';
 const table=document.createElement('table');table.className='report-table';
 const head=document.createElement('thead'),header=document.createElement('tr');
 ['관련 항목','핵심 변화','출처'].forEach(function(label){
  const cell=document.createElement('th');cell.scope='col';cell.textContent=label;header.append(cell);
 });
 head.append(header);table.append(head);
 const body=document.createElement('tbody');
 section.items.forEach(function(item,index){
  const row=document.createElement('tr');
  const grouped=section.group_rows;
  const first=!grouped||index===0||section.items[index-1].target!==item.target;
  const members=grouped?section.items.filter(function(other){return other.target===item.target;}):[item];
  if(first){
   const target=document.createElement('th');target.scope=grouped&&members.length>1?'rowgroup':'row';target.textContent=item.target||'';
   target.rowSpan=members.length;row.append(target);
  }
  const change=document.createElement('td');change.className='report-change';
  change.textContent=(grouped&&members.length>1?(members.indexOf(item)+1)+'. ':'')+item.text;
  const source=document.createElement('td');source.append(reportSources(item));
  row.append(change);row.append(source);body.append(row);
 });
 table.append(body);scroll.append(table);return scroll;
}
function renderReport(report,output){
 output.replaceChildren();
 report.sections.forEach(function(section){
  const icon={기회:'🟢',위협:'🔴'}[section.title];
  const heading=document.createElement('h3');heading.textContent=(icon?icon+' ':'')+section.title;output.append(heading);
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
 function related(a){
  if(a.category!=='competitor')return '정책';
  return NewsRules.designatedCompany(a);
 }
 function item(a){return {target:related(a),text:a.title,
  impact:['기회','위협'].includes(a.impact_override)?a.impact_override:'',
  sources:[{title:a.title,url:a.url,source:a.source,date:a.date}]};}
 return {since:since,until:until,count:important.length,sections:['기회','위협'].map(function(impact){
  const items=important.filter(function(a){return a.impact_override===impact;}).map(item);
  items.sort(function(a,b){return (a.target==='정책')-(b.target==='정책')||a.target.localeCompare(b.target,'ko');});
  return {title:impact,format:'table',group_rows:true,empty_message:'선택된 기사가 없습니다.',items:items};
 })};
}
function renderMonthlySummary(){
 const report=importantReport(articles);
 renderReport(report,document.getElementById('report-output'));
 document.getElementById('report-status').textContent=report.since+' ~ '+report.until;
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
 if(!report.count){status.textContent='최근 30일의 중요 기사 중 기회·위협을 선택한 기사가 없습니다.';return;}
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
