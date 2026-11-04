
const categories=[{id:'company',name:'우리회사 뉴스'},{id:'policy',name:'정책'},{id:'hospital',name:'학회&병원'},{id:'competitor',name:'경쟁사'}];
let articles = [];
function esc(value){return String(value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
// NEW 표시: 지난번 방문 때 본 가장 최근 저장 시각입니다. 이보다 나중에 저장된 기사에 NEW를 붙입니다.
let lastSeen='';
try{lastSeen=localStorage.getItem('lastSeenSavedAt')||'';}catch(e){}
function isNew(a){return lastSeen!==''&&a.saved_at>lastSeen;}
// 검색어 강조: 지금 검색창에 쓴 단어입니다. 카드 글에서 이 단어를 찾아 <mark>로 감싸 노란색으로 보여줍니다.
let searchWord='';
function highlight(value){
 const text=String(value);
 if(!searchWord)return esc(text);
 const lower=text.toLocaleLowerCase();
 let result='',start=0,found=lower.indexOf(searchWord);
 while(found!==-1){
  result+=esc(text.slice(start,found))+'<mark>'+esc(text.slice(found,found+searchWord.length))+'</mark>';
  start=found+searchWord.length;
  found=lower.indexOf(searchWord,start);
 }
 return result+esc(text.slice(start));
}
function card(a,others){let track='';if(a.track){track='<details class="policy"><summary>정책 추적 예시 · '+esc(a.track.name)+'</summary><dl><dt>이전 기록</dt><dd>'+esc(a.track.before)+'</dd><dt>이번 기사에서 확인할 내용</dt><dd>'+esc(a.track.change)+'</dd><dt>다음 확인 사항</dt><dd>'+esc(a.track.next)+'</dd></dl><p class="policy-note">공식 자료 검증 및 자동 이력 비교 전의 화면 예시입니다.</p></details>';}
// AI 요약이 있으면 요약 상자를, 없으면 "AI 요약 만들기" 버튼을 보여줍니다.
let aiBox='<button type="button" class="hide-button" data-summary="'+a.id+'">AI 요약 만들기</button>';if(a.ai_summary){aiBox='<div class="ai-summary"><strong>AI 요약</strong><p>'+highlight(a.ai_summary)+'</p></div>';}
// 중요 표시(⭐) 버튼과 메모 상자입니다.
const star='<button type="button" class="star'+(a.starred?' on':'')+'" data-star="'+a.id+'" aria-label="중요 기사 표시">'+(a.starred?'★':'☆')+'</button>';
const memoBox='<details class="memo"><summary>'+(a.memo?'메모: '+esc(a.memo):'메모 달기')+'</summary><textarea maxlength="300" id="memo-'+a.id+'" placeholder="짧은 메모">'+esc(a.memo||'')+'</textarea><button type="button" class="reset" data-memo="'+a.id+'">저장</button></details>';
// 숨기기 버튼: 숨긴 기사에는 "다시 보이기"가 나옵니다.
const hideButton='<button type="button" class="hide-button" data-hide="'+a.id+'">'+(a.hidden?'다시 보이기':'숨기기')+'</button>';
const newBadge=isNew(a)?'<span class="new-badge">NEW</span>':'';
// 같은 소식을 다룬 다른 매체 기사 목록입니다.
let sameNews='';
if(others&&others.length){sameNews='<details class="same-news"><summary>같은 소식 · 외 '+others.length+'개 매체</summary><ul>'+others.map(function(o){return '<li><a href="'+esc(o.url)+'" target="_blank" rel="noopener noreferrer">'+esc(o.source)+' · '+esc(o.title)+'</a> <span class="muted">'+esc(o.date)+'</span></li>';}).join('')+'</ul></details>';}
return '<article class="card'+(a.hidden?' hidden-card':'')+'"><div class="meta">'+newBadge+'<span class="entity">'+highlight(a.entity)+'</span><span>'+esc(a.source)+' · '+esc(a.date)+'</span>'+star+'</div><h3>'+highlight(a.title)+'</h3>'+aiBox+'<p class="summary" style="white-space:pre-line" title="눌러서 펼치기/접기">'+highlight((a.subtitle?a.subtitle+'\n\n':'')+a.summary)+'</p><div class="tags">'+a.tags.map(function(t){return '<span class="tag">'+esc(t)+'</span>';}).join('')+'</div>'+track+sameNews+memoBox+'<div class="card-foot"><a class="source" href="'+esc(a.url)+'" target="_blank" rel="noopener noreferrer">원문 보기 ↗</a>'+hideButton+'</div></article>';}
const PAGE_SIZE=6;
const visibleCounts={};
function resetVisibleCounts(){categories.forEach(function(c){visibleCounts[c.id]=PAGE_SIZE;});}
function matchesTopic(a,topic){
 if(!topic)return true;
 const text=[a.title].concat(a.tags||[]).join(' ');
 if(topic==='AI')return /(?:\bAI\b|인공지능)/i.test(text);
 if(topic==='CT')return /(?:\bCT\b|CT(?=[가-힣])|컴퓨터단층|전산화단층)/i.test(text);
 if(topic==='MR')return /(?:\bMRI?\b|MRI?(?=[가-힣])|자기공명)/i.test(text);
 if(topic==='초음파')return /초음파|ultrasound/i.test(text);
 if(topic==='학회')return /학회|학술대회|학술회의|심포지엄|symposium|congress|conference/i.test(text);
 return false;
}
// 한국 시간 기준으로 오늘에서 days일 전 날짜(YYYY-MM-DD)를 만듭니다.
function kstDate(days){return new Date(Date.now()-days*86400000+9*3600000).toISOString().slice(0,10);}
// 기간 필터: 기사 날짜(YYYY-MM-DD)가 기준일 이후인지 확인합니다. (한국 시간 기준)
function matchesPeriod(a,period){
 if(!period)return true;
 const days=period==='today'?0:Number(period)-1;
 return a.date>=kstDate(days);
}
// 정렬: 메인 일치 기사는 항상 뒤로 보내고, 그 안에서 선택한 순서대로 정렬합니다.
function sortRows(rows,sort){
 return rows.sort(function(a,b){
  const main=Number(a.match_level==='main')-Number(b.match_level==='main');
  if(sort==='old')return main||a.date.localeCompare(b.date);
  if(sort==='star')return main||b.starred-a.starred||b.date.localeCompare(a.date);
  return main||b.date.localeCompare(a.date);
 });
}
// 같은 소식 묶기: 제목을 두 글자씩 잘라(예: "캐논메디칼" → 캐논, 논메, 메디 …) 겹치는 비율을 봅니다.
function titlePieces(title){
 const text=title.replace(/[^가-힣A-Za-z0-9]/g,'').toLowerCase();
 const pieces=new Set();
 for(let i=0;i<text.length-1;i++)pieces.add(text.slice(i,i+2));
 return pieces;
}
function similarity(a,b){
 let same=0;a.forEach(function(p){if(b.has(p))same++;});
 return same/(a.size+b.size-same||1);
}
function daysBetween(d1,d2){return Math.abs(new Date(d1)-new Date(d2))/86400000;}
const SAME_NEWS_LEVEL=0.45;  // 이 값보다 많이 겹치면 같은 소식으로 봅니다. (0~1, 높을수록 엄격)
function groupSameNews(rows){
 const groups=[];
 rows.forEach(function(a){
  const pieces=titlePieces(a.title);
  const found=groups.find(function(g){return daysBetween(g.main.date,a.date)<=3&&similarity(g.pieces,pieces)>=SAME_NEWS_LEVEL;});
  if(found)found.others.push(a);
  else groups.push({main:a,pieces:pieces,others:[]});
 });
 return groups;
}
// 통계: 지금 불러온 기사로 카테고리별 건수와 경쟁사별 언급 횟수를 막대로 보여줍니다.
function bars(title,counts){
 const names=Object.keys(counts).sort(function(a,b){return counts[b]-counts[a];}).slice(0,8);
 const max=names.length?counts[names[0]]:1;
 return '<div class="stat-box"><h3>'+title+'</h3>'+(names.length?names.map(function(n){return '<div class="bar-row"><span class="bar-name">'+esc(n)+'</span><span class="bar-track"><span class="bar-fill" style="width:'+Math.round(counts[n]/max*100)+'%"></span></span><span class="bar-num">'+counts[n]+'</span></div>';}).join(''):'<p class="muted">기사가 없습니다.</p>')+'</div>';
}
// 일별 추이: 최근 14일 날짜별 기사 수를 세로 막대로 보여줍니다.
function dailyChart(list){
 const days=[];
 for(let i=13;i>=0;i--)days.push(kstDate(i));
 const counts={};
 list.forEach(function(a){counts[a.date]=(counts[a.date]||0)+1;});
 const max=Math.max.apply(null,days.map(function(d){return counts[d]||0;}).concat([1]));
 return '<div class="stat-box wide"><h3>최근 14일 날짜별 기사 수</h3><div class="day-chart">'+days.map(function(d){const n=counts[d]||0;return '<div class="day-col" title="'+d+' · '+n+'건"><span class="day-num">'+n+'</span><span class="day-bar" style="height:'+Math.round(n/max*100)+'%"></span><span class="day-label">'+d.slice(5).replace('-','/')+'</span></div>';}).join('')+'</div></div>';
}
function renderStats(list){
 const byCategory={},byEntity={};
 list.forEach(function(a){
  const name=(categories.find(function(c){return c.id===a.category;})||{name:a.category}).name;
  byCategory[name]=(byCategory[name]||0)+1;
  if(a.category==='competitor')byEntity[a.entity]=(byEntity[a.entity]||0)+1;
 });
 document.getElementById('stats').innerHTML='<div class="section-head"><h2>간단 통계</h2><span class="count">현재 필터 기준 '+list.length+'건</span></div><div class="stat-grid">'+bars('카테고리별 기사 수',byCategory)+bars('경쟁사별 언급 횟수',byEntity)+dailyChart(list)+'</div>';
}
function render(){
 const q=document.getElementById('search').value.trim().toLocaleLowerCase();
 const topic=document.getElementById('topic').value;
 const includeMain=document.getElementById('include-main').checked;
 const period=document.getElementById('period').value;
 const sort=document.getElementById('sort').value;
 const onlyStar=document.getElementById('only-star').checked;
 const showHidden=document.getElementById('show-hidden').checked;
 const onlyNew=document.getElementById('only-new').checked;
 searchWord=q;
 const matches=articles.filter(function(a){
  const text=[a.title,a.entity,a.source,a.summary,a.ai_summary].concat(a.tags).join(' ').toLocaleLowerCase();
  return (a.match_level!=='main'||includeMain)&&(!q||text.includes(q))&&matchesTopic(a,topic)&&matchesPeriod(a,period)&&(!onlyStar||a.starred)&&(!a.hidden||showHidden)&&(!onlyNew||isNew(a));
 });
 renderStats(matches);
 document.getElementById('sections').innerHTML=categories.map(function(c,i){
  const rows=sortRows(matches.filter(function(a){return a.category===c.id;}),sort);
  const groups=groupSameNews(rows);
  const shown=groups.slice(0,visibleCounts[c.id]||PAGE_SIZE);
  const empty='최신 기사가 없습니다.';
  const more=shown.length<groups.length?'<div class="more-wrap"><button type="button" class="more-button" data-more="'+c.id+'" aria-label="'+esc(c.name)+' 기사 더보기">더보기</button></div>':'';
  const count=(shown.length<groups.length?shown.length+' / '+groups.length+'건':groups.length+'건')+(rows.length>groups.length?' (같은 소식 묶음 · 기사 '+rows.length+'건)':'');
  return '<section class="section" id="'+c.id+'"><div class="section-head"><h2><span>0'+(i+1)+'</span>'+c.name+'</h2><span class="count">'+count+'</span></div><div class="grid">'+(shown.length?shown.map(function(g){return card(g.main,g.others);}).join(''):'<div class="empty">'+empty+'</div>')+'</div>'+more+'</section>';
 }).join('');
}
function changeFilters(){resetVisibleCounts();render();}
document.getElementById('search').addEventListener('input',changeFilters);
document.getElementById('topic').addEventListener('change',changeFilters);
document.getElementById('include-main').addEventListener('change',changeFilters);
['period','sort','only-star','show-hidden','only-new'].forEach(function(id){document.getElementById(id).addEventListener('change',changeFilters);});
// 서버에 저장 요청을 보냅니다. 실패하면 한국어 메시지를 띄웁니다.
async function postJson(path,data){
 const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 if(!r.ok){let m='저장하지 못했습니다.';try{m=(await r.json()).error||m;}catch(e){}throw new Error(m);}
 return r.json();
}
async function saveStar(id,starred){
 try{await postJson('/api/article-star',{id:id,starred:starred});articles.forEach(function(a){if(a.id===id)a.starred=starred?1:0;});render();}
 catch(e){alert(e.message);}
}
async function saveMemo(id){
 const memo=document.getElementById('memo-'+id).value.trim();
 try{await postJson('/api/article-memo',{id:id,memo:memo});articles.forEach(function(a){if(a.id===id)a.memo=memo;});render();}
 catch(e){alert(e.message);}
}
async function saveHidden(id,hidden){
 try{await postJson('/api/article-hide',{id:id,hidden:hidden});articles.forEach(function(a){if(a.id===id)a.hidden=hidden;});render();}
 catch(e){alert(e.message);}
}
// AI 요약 만들기: 서버가 GPT에 다시 요청하고, 성공하면 카드에 요약을 넣습니다.
async function remakeSummary(button,id){
 button.disabled=true;button.textContent='AI 요약 만드는 중…';
 try{const d=await postJson('/api/article-summary',{id:id});articles.forEach(function(a){if(a.id===id)a.ai_summary=d.ai_summary;});render();}
 catch(e){alert(e.message);button.disabled=false;button.textContent='AI 요약 만들기';}
}
document.getElementById('sections').addEventListener('click',function(event){
 // 기사 요약 글을 누르면 4줄 ↔ 전체 보기로 바뀝니다.
 const summaryText=event.target.closest('.summary');
 if(summaryText){summaryText.classList.toggle('open');return;}
 const starButton=event.target.closest('button[data-star]');
 if(starButton){const id=Number(starButton.getAttribute('data-star'));const now=articles.find(function(a){return a.id===id;});saveStar(id,!(now&&now.starred));return;}
 const memoButton=event.target.closest('button[data-memo]');
 if(memoButton){saveMemo(Number(memoButton.getAttribute('data-memo')));return;}
 const summaryButton=event.target.closest('button[data-summary]');
 if(summaryButton){remakeSummary(summaryButton,Number(summaryButton.getAttribute('data-summary')));return;}
 const hideBtn=event.target.closest('button[data-hide]');
 if(hideBtn){const id=Number(hideBtn.getAttribute('data-hide'));const now=articles.find(function(a){return a.id===id;});saveHidden(id,!(now&&now.hidden));return;}
 const button=event.target.closest('button[data-more]');if(!button)return;
 const category=button.getAttribute('data-more');if(!categories.some(function(c){return c.id===category;}))return;
 visibleCounts[category]=(visibleCounts[category]||PAGE_SIZE)+PAGE_SIZE;render();
});
// 탭 메뉴: 위쪽 탭 버튼을 누르면 그 화면만 보이고 나머지 화면은 숨깁니다.
function showTab(name){
 // 없는 탭 이름이면 뉴스 탭을 보여줍니다.
 if(!document.querySelector('[data-panel="'+name+'"]'))name='news';
 document.querySelectorAll('[data-panel]').forEach(function(panel){panel.hidden=panel.getAttribute('data-panel')!==name;});
 document.querySelectorAll('.tab').forEach(function(button){
  const on=button.getAttribute('data-tab')===name;
  button.classList.toggle('on',on);
  button.setAttribute('aria-selected',on?'true':'false');
 });
 // 마지막으로 본 탭을 기억해 두었다가, 다음에 열 때 그 탭을 먼저 보여줍니다.
 try{localStorage.setItem('lastTab',name);}catch(e){}
}
document.querySelectorAll('.tab').forEach(function(button){
 button.addEventListener('click',function(){showTab(button.getAttribute('data-tab'));window.scrollTo(0,0);});
});
let lastTab='news';
try{lastTab=localStorage.getItem('lastTab')||'news';}catch(e){}
showTab(lastTab);
// 이번에 본 가장 최근 저장 시각을 기억해 두고, 새 기사 수를 안내합니다.
function rememberLastSeen(){
 const newest=articles.reduce(function(max,a){return a.saved_at>max?a.saved_at:max;},'');
 const count=articles.filter(function(a){return isNew(a)&&!a.hidden;}).length;
 document.getElementById('new-note').textContent=lastSeen===''?'':(count?'지난 방문 이후 새 기사 '+count+'건':'지난 방문 이후 새 기사가 없습니다.');
 try{if(newest)localStorage.setItem('lastSeenSavedAt',newest);}catch(e){}
}
async function refreshArticles(){const r=await fetch('/api/articles');if(!r.ok)throw new Error('Article loading failed');articles=(await r.json()).articles;rememberLastSeen();changeFilters();}
refreshArticles().catch(function(e){document.getElementById('sections').textContent=e.message;});
