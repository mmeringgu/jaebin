
const categories=[{id:'company',name:'우리회사 뉴스'},{id:'policy',name:'정책'},{id:'hospital',name:'학회&병원'},{id:'competitor',name:'경쟁사'}];
let articles = [];
function esc(value){return String(value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
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
// AI 인사이트 첫 줄 "영향: 기회/위협/참고"를 읽어 영향 종류를 돌려줍니다. 없으면 빈 글자입니다.
function impactOf(a){
 const text=a.ai_summary||'';
 if(text.indexOf('영향:')===-1)return '';
 // "영향:"이 있는 그 한 줄만 봅니다. (다음 줄에 나오는 "기회" 같은 단어에 헷갈리지 않게)
 const line=text.slice(text.indexOf('영향:')).split('\n')[0];
 if(line.indexOf('위협')!==-1)return '위협';
 if(line.indexOf('기회')!==-1)return '기회';
 return '참고';
}
// AI 인사이트에서 "한 줄"만 꺼냅니다.
// 새 형식은 "인사이트: …" 줄, 예전 형식(여러 줄)은 첫 번째 "- …" 줄을 씁니다.
function insightLine(a){
 const lines=String(a.ai_summary||'').split('\n').map(function(l){return l.trim();});
 const newLine=lines.find(function(l){return l.indexOf('인사이트:')===0;});
 if(newLine)return newLine.slice(5).trim();
 const oldLine=lines.find(function(l){return l.indexOf('- ')===0;});
 return oldLine?oldLine.slice(2).trim():'';
}
// 기사 앞부분을 "목록에 보이는 부분(preview)"과 "자세히에서 이어지는 부분(rest)"으로 나눕니다.
// 자세히를 눌렀을 때 이미 보이는 제목·첫 줄을 다시 보여주지 않기 위해서입니다.
const PREVIEW_LENGTH=90; // 목록에 보여줄 글자 수 (두 줄 정도)
function splitText(a){
 let body=String(a.summary||'').trim();
 // 기사 앞부분이 제목이나 부제목으로 시작하면 그 부분은 뺍니다. (이미 위에 보이므로)
 if(body.indexOf(a.title)===0)body=body.slice(a.title.length).trim();
 if(a.subtitle&&body.indexOf(a.subtitle)===0)body=body.slice(a.subtitle.length).trim();
 // 부제목이 있으면 목록에는 부제목, 자세히에는 본문 앞부분 전체
 if(a.subtitle)return {preview:a.subtitle,rest:body};
 if(body.length<=PREVIEW_LENGTH)return {preview:body,rest:''};
 // 단어 중간에서 자르지 않도록 90자 안쪽의 마지막 띄어쓰기에서 자릅니다.
 let cut=body.lastIndexOf(' ',PREVIEW_LENGTH);
 if(cut<40)cut=PREVIEW_LENGTH;
 return {preview:body.slice(0,cut)+' …',rest:'… '+body.slice(cut).trim()};
}
// 영향 필터: "both"는 기회와 위협을 함께 보여줍니다.
function matchesImpact(a,impact){
 if(!impact)return true;
 const kind=impactOf(a);
 if(impact==='both')return kind==='기회'||kind==='위협';
 return kind===impact;
}
// 기사 한 줄을 만듭니다. (신문 브리핑형)
// 한 줄에는 제목·매체·날짜·미리보기만 보이고,
// "자세히"를 누르면 AI 인사이트(한 줄), 미리보기 뒤로 이어지는 기사 내용, 같은 소식, 숨기기가 펼쳐집니다.
function card(a,others){
 // 정책 추적 예시 (데이터가 있을 때만)
 let track='';
 if(a.track){track='<details class="policy"><summary>정책 추적 예시 · '+esc(a.track.name)+'</summary><dl><dt>이전 기록</dt><dd>'+esc(a.track.before)+'</dd><dt>이번 기사에서 확인할 내용</dt><dd>'+esc(a.track.change)+'</dd><dt>다음 확인 사항</dt><dd>'+esc(a.track.next)+'</dd></dl><p class="policy-note">공식 자료 검증 및 자동 이력 비교 전의 화면 예시입니다.</p></details>';}

 // AI 인사이트가 있으면 인사이트 한 줄 상자를, 없으면 "AI 인사이트 만들기" 버튼을 보여줍니다.
 // 예전에 만든 요약을 새 인사이트로 바꾸고 싶을 때는 상자 안의 "다시 만들기"를 누릅니다.
 let aiBox='<button type="button" class="small-button" data-summary="'+a.id+'">✨ AI 인사이트 만들기</button>';
 const insight=insightLine(a);
 if(insight){aiBox='<div class="ai-summary"><strong>AI 인사이트</strong><p>'+highlight(insight)+'</p><button type="button" class="text-button" data-summary="'+a.id+'">↻ 다시 만들기</button></div>';}

 const star='<button type="button" class="star'+(a.starred?' on':'')+'" data-star="'+a.id+'" aria-label="중요 기사 표시">'+(a.starred?'★':'☆')+'</button>';
 const hideButton='<button type="button" class="text-button" data-hide="'+a.id+'">'+(a.hidden?'다시 보이기':'이 기사 숨기기')+'</button>';

 // 같은 소식을 다룬 다른 매체 기사 목록입니다.
 let sameNews='',sameChip='';
 if(others&&others.length){
  sameChip='<span class="chip">외 '+others.length+'개 매체</span>';
  sameNews='<div class="same-news"><strong>같은 소식을 다룬 기사</strong><ul>'+others.map(function(o){return '<li><a href="'+esc(o.url)+'" target="_blank" rel="noopener noreferrer">'+esc(o.title)+'</a> <span class="muted">'+esc(o.source)+' · '+esc(o.date)+'</span></li>';}).join('')+'</ul></div>';
 }
 // 한 줄 목록의 배지: 기회는 초록, 위협은 빨강, 그 밖에 인사이트가 있으면 파란 "AI 인사이트"
 const impact=impactOf(a);
 let aiChip=a.ai_summary?'<span class="chip ai-chip">AI 인사이트</span>':'';
 if(impact==='기회')aiChip='<span class="chip impact-good">🟢 기회</span>';
 if(impact==='위협')aiChip='<span class="chip impact-bad">🔴 위협</span>';

 // 미리보기: 부제목이 있으면 부제목, 없으면 기사 앞부분 90자 정도
 const text=splitText(a);
 const tags='<div class="tags">'+a.tags.map(function(t){return '<span class="tag">'+esc(t)+'</span>';}).join('')+'</div>';

 return '<article class="item'+(a.hidden?' hidden-item':'')+'">'+
  '<div class="item-body">'+
   '<div class="item-title"><a href="'+esc(a.url)+'" target="_blank" rel="noopener noreferrer">'+highlight(a.title)+'</a></div>'+
   '<div class="item-meta"><span class="entity">'+highlight(a.entity)+'</span><span>'+esc(a.source)+'</span><span>'+esc(a.date.slice(5).replace('-','/'))+'</span>'+aiChip+sameChip+'</div>'+
   (text.preview?'<p class="item-preview">'+highlight(text.preview)+'</p>':'')+
   '<details class="item-more"><summary>자세히</summary><div class="item-detail">'+
    aiBox+
    (text.rest?'<p class="detail-text">'+highlight(text.rest)+'</p>':'')+
    tags+track+sameNews+
    // 원문 링크는 "원문 보기" 대신 주소(URL) 자체를 보여줍니다. 길면 CSS가 끝을 "…"로 자릅니다.
    '<div class="detail-foot"><a class="source" href="'+esc(a.url)+'" target="_blank" rel="noopener noreferrer" title="'+esc(a.url)+'">🔗 '+esc(a.url)+'</a>'+hideButton+'</div>'+
   '</div></details>'+
  '</div>'+star+
 '</article>';
}
// 페이지 나누기: 카테고리마다 한 페이지에 기사(같은 소식 묶음은 1개로 셈)를 최대 6개까지 보여줍니다.
const PAGE_SIZE=6;
const currentPages={}; // 카테고리별로 지금 보고 있는 페이지 번호 (1부터 시작)
function resetPages(){categories.forEach(function(c){currentPages[c.id]=1;});}
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
// 정렬
// - 관련도순(기본): ⭐ 표시한 기사 먼저 → 맞은 키워드가 많은 기사 → 최신 기사
// - 최신순: 날짜가 최근인 기사 먼저
function sortRows(rows,sort){
 return rows.sort(function(a,b){
  const newer=b.date.localeCompare(a.date);
  if(sort==='new')return newer;
  return (b.starred?1:0)-(a.starred?1:0)||(b.tags||[]).length-(a.tags||[]).length||newer;
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
// 묶음 안의 기사 "하나라도" 제목이 비슷하면 같은 묶음에 넣습니다.
// (예전에는 묶음의 첫 기사하고만 비교해서, 제목이 조금 다른 매체 기사가 따로 나오곤 했습니다)
function groupSameNews(rows){
 const groups=[];
 rows.forEach(function(a){
  const pieces=titlePieces(a.title);
  const found=groups.find(function(g){
   return g.members.some(function(m){return daysBetween(m.date,a.date)<=3&&similarity(m.pieces,pieces)>=SAME_NEWS_LEVEL;});
  });
  if(found){found.others.push(a);found.members.push({date:a.date,pieces:pieces});}
  else groups.push({main:a,others:[],members:[{date:a.date,pieces:pieces}]});
 });
 return groups;
}
function render(){
 const q=document.getElementById('search').value.trim().toLocaleLowerCase();
 const topic=document.getElementById('topic').value;
 // "전체 키워드 기사" 스위치를 켜면 키워드가 모두 맞은 기사만 보여줍니다. (끄면 대표 키워드만 맞은 기사도 함께)
 const onlyFull=document.getElementById('only-full').checked;
 const period=document.getElementById('period').value;
 const impact=document.getElementById('impact').value;
 const sort=document.getElementById('sort').value;
 const onlyStar=document.getElementById('only-star').checked;
 const showHidden=document.getElementById('show-hidden').checked;
 searchWord=q;
 const matches=articles.filter(function(a){
  const text=[a.title,a.entity,a.source,a.summary,a.ai_summary].concat(a.tags).join(' ').toLocaleLowerCase();
  return (!onlyFull||a.match_level!=='main')&&(!q||text.includes(q))&&matchesTopic(a,topic)&&matchesPeriod(a,period)&&matchesImpact(a,impact)&&(!onlyStar||a.starred)&&(!a.hidden||showHidden);
 });
 // 통계 탭은 필터와 상관없이 전체 기사로 다시 계산합니다. (stats.js)
 if(typeof renderStats==='function')renderStats();
 renderBriefing(matches);
 document.getElementById('sections').innerHTML=categories.map(function(c){
  const rows=sortRows(matches.filter(function(a){return a.category===c.id;}),sort);
  const groups=groupSameNews(rows);
  // 전체 페이지 수를 구하고, 지금 페이지가 범위를 넘으면(기사를 숨겨서 줄어든 경우 등) 마지막 페이지로 맞춥니다.
  const pageCount=Math.max(1,Math.ceil(groups.length/PAGE_SIZE));
  let page=currentPages[c.id]||1;
  if(page>pageCount)page=pageCount;
  currentPages[c.id]=page;
  const shown=groups.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
  const more=pageCount>1?pageButtons(c,page,pageCount):'';
  const sameNote=rows.length>groups.length?'같은 소식 묶음 포함 기사 '+rows.length+'건':'';
  const list=shown.length?shown.map(function(g){return card(g.main,g.others);}).join(''):'<p class="empty">조건에 맞는 기사가 없습니다.</p>';
  return '<section class="news-section cat-'+c.id+'" id="'+c.id+'">'+
   '<div class="news-head"><h2><span class="dot"></span>'+c.name+'<span class="head-count">'+groups.length+'</span></h2><span class="count">'+sameNote+'</span></div>'+
   '<div class="news-list">'+list+'</div>'+more+
  '</section>';
 }).join('');
}

// 카테고리 아래의 페이지 버튼 줄을 만듭니다. 예: [◀ 이전] [1] [2] [3] [다음 ▶]
function pageButtons(c,page,pageCount){
 function one(number,label,disabled,current){
  return '<button type="button" class="page-button'+(current?' on':'')+'" data-category="'+c.id+'" data-page="'+number+'"'+(disabled?' disabled':'')+(current?' aria-current="page"':'')+'>'+label+'</button>';
 }
 let html=one(page-1,'◀ 이전',page===1,false);
 for(let n=1;n<=pageCount;n++)html+=one(n,String(n),false,n===page);
 html+=one(page+1,'다음 ▶',page===pageCount,false);
 return '<nav class="pager" aria-label="'+esc(c.name)+' 페이지">'+html+'</nav>';
}

// 맨 위 브리핑 영역: 오늘 날짜와 카테고리별 건수(누르면 그 구역으로 이동)를 보여줍니다.
function renderBriefing(list){
 const today=kstDate(0);
 const todayCount=list.filter(function(a){return a.date===today;}).length;
 document.getElementById('today-date').textContent=new Date().toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'long'});
 const chips=categories.map(function(c){
  const n=list.filter(function(a){return a.category===c.id;}).length;
  return '<a class="summary-chip cat-'+c.id+'" href="#'+c.id+'"><span class="dot"></span>'+c.name+' <b>'+n+'</b></a>';
 }).join('');
 document.getElementById('summary-bar').innerHTML='<span class="summary-chip today-chip">오늘 <b>'+todayCount+'</b>건</span>'+chips;
}
function changeFilters(){resetPages();render();}
document.getElementById('search').addEventListener('input',changeFilters);
document.getElementById('topic').addEventListener('change',changeFilters);
document.getElementById('only-full').addEventListener('change',changeFilters);
['period','impact','sort','only-star','show-hidden'].forEach(function(id){document.getElementById(id).addEventListener('change',changeFilters);});
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
async function saveHidden(id,hidden){
 try{await postJson('/api/article-hide',{id:id,hidden:hidden});articles.forEach(function(a){if(a.id===id)a.hidden=hidden;});render();}
 catch(e){alert(e.message);}
}
// AI 인사이트 만들기: 서버가 GPT에 다시 요청하고, 성공하면 카드에 인사이트를 넣습니다.
async function remakeSummary(button,id){
 button.disabled=true;button.textContent='AI 인사이트 만드는 중…';
 try{const d=await postJson('/api/article-summary',{id:id});articles.forEach(function(a){if(a.id===id)a.ai_summary=d.ai_summary;});render();}
 catch(e){alert(e.message);button.disabled=false;button.textContent='AI 인사이트 만들기';}
}
document.getElementById('sections').addEventListener('click',function(event){
 const starButton=event.target.closest('button[data-star]');
 if(starButton){const id=Number(starButton.getAttribute('data-star'));const now=articles.find(function(a){return a.id===id;});saveStar(id,!(now&&now.starred));return;}
 const summaryButton=event.target.closest('button[data-summary]');
 if(summaryButton){remakeSummary(summaryButton,Number(summaryButton.getAttribute('data-summary')));return;}
 const hideBtn=event.target.closest('button[data-hide]');
 if(hideBtn){const id=Number(hideBtn.getAttribute('data-hide'));const now=articles.find(function(a){return a.id===id;});saveHidden(id,!(now&&now.hidden));return;}
 // 페이지 버튼: 누른 카테고리의 페이지 번호를 바꾸고, 그 카테고리 맨 위로 화면을 옮깁니다.
 const button=event.target.closest('button[data-page]');if(!button)return;
 const category=button.getAttribute('data-category');if(!categories.some(function(c){return c.id===category;}))return;
 currentPages[category]=Number(button.getAttribute('data-page'));render();
 document.getElementById(category).scrollIntoView({block:'start'});
});
// 맨 위 제목줄의 높이를 재서 CSS에 알려 줍니다. 카테고리 줄이 그 바로 아래에 붙도록 하기 위해서입니다.
// (화면 폭이 좁으면 제목줄이 두 줄이 되어 높이가 바뀌므로, 창 크기가 바뀔 때마다 다시 잽니다)
function measureHeader(){
 const height=document.querySelector('.topbar').offsetHeight;
 document.documentElement.style.setProperty('--header-height',height+'px');
}
measureHeader();
window.addEventListener('resize',measureHeader);
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
async function refreshArticles(){const r=await fetch('/api/articles');if(!r.ok)throw new Error('Article loading failed');articles=(await r.json()).articles;changeFilters();}
refreshArticles().catch(function(e){document.getElementById('sections').textContent=e.message;});
