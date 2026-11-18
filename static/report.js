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
 const important=list.filter(function(a){return a.starred&&!a.hidden&&a.date>=since&&a.date<=until;}).slice().sort(NewsRules.compareNewest);
 const categories={company:'캐논 뉴스',policy:'정책',hospital:'병원',conference:'학회',competitor:'경쟁사'};
 function item(a){return {target:a.entity||categories[a.category]||'중요 기사',text:a.title,
  impact:['기회','위협'].includes(a.impact_override)?a.impact_override:'',
  sources:[{title:a.title,url:a.url,source:a.source,date:a.date}]};}
 return {since:since,until:until,count:important.length,sections:[
  {title:'이번 달 핵심 동향',format:'table',empty_message:'최근 30일의 중요 기사가 없습니다.',items:important.map(item)},
  {title:'비즈니스 기회',format:'table',empty_message:'선택된 기사가 없습니다.',items:important.filter(function(a){return a.impact_override==='기회';}).map(item)},
  {title:'위협·리스크',format:'table',empty_message:'선택된 기사가 없습니다.',items:important.filter(function(a){return a.impact_override==='위협';}).map(item)}
 ]};
}
function renderMonthlySummary(){
 const report=importantReport(articles);
 renderReport(report,document.getElementById('report-output'));
 document.getElementById('report-status').textContent=report.since+' ~ '+report.until+' · 중요 기사 '+report.count+'건';
}
(function(){renderMonthlySummary();})();
