
const categories=[{id:'company',name:'캐논 뉴스'},{id:'competitor',name:'경쟁사'},{id:'policy',name:'정책'},{id:'hospital',name:'병원'},{id:'conference',name:'학회'}];
// 학회·병원 나누기: 서버(DB)에는 둘 다 "hospital"로 저장돼 있어서, 화면에서 제목을 보고 나눕니다.
// 제목에 아래 단어가 있으면 "학회", 없으면 "병원"으로 보여줍니다.
const CONFERENCE_WORDS=['학회','학술대회','학술회의','심포지엄','symposium','congress','conference'];
function splitConference(a){
 if(a.manual)return a;
 const title=a.title.toLowerCase();
 if(a.category==='hospital'&&CONFERENCE_WORDS.some(function(w){return title.includes(w);}))a.category='conference';
 return a;
}
// 교수 수상 소식(학술상·논문상·저술상 등)은 장비 영업과 관계가 적어 화면에서 뺍니다.
// (새로 수집하는 기사는 src/config.json의 excluded_title_words로도 걸러집니다)
const AWARD_WORDS=['학술상','논문상','저술상'];
function isAwardNews(a){
 if(a.manual)return false;
 return AWARD_WORDS.some(function(w){return a.title.includes(w);})||(a.title.includes('교수')&&a.title.includes('수상'));
}
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
// 기사 한 줄을 만듭니다. (신문 브리핑형)
// 한 줄에는 제목·매체·날짜·미리보기만 보이고,
// "자세히"를 누르면 미리보기 뒤로 이어지는 기사 내용, 같은 소식, 숨기기가 펼쳐집니다.
function card(a,others){
 // 정책 추적 예시 (데이터가 있을 때만)
 let track='';
 if(a.track){track='<details class="policy"><summary>정책 추적 예시 · '+esc(a.track.name)+'</summary><dl><dt>이전 기록</dt><dd>'+esc(a.track.before)+'</dd><dt>이번 기사에서 확인할 내용</dt><dd>'+esc(a.track.change)+'</dd><dt>다음 확인 사항</dt><dd>'+esc(a.track.next)+'</dd></dl><p class="policy-note">공식 자료 검증 및 자동 이력 비교 전의 화면 예시입니다.</p></details>';}

 const originalTitle=a.original_title?'<p class="original-title"><strong>원제</strong> '+esc(a.original_title)+'</p>':'';

 const star='<button type="button" class="star'+(a.starred?' on':'')+'" data-star="'+a.id+'" aria-label="중요 기사 표시" aria-pressed="'+(a.starred?'true':'false')+'">'+(a.starred?'★':'☆')+'</button>';
 const hideButton='<button type="button" class="text-button" data-hide="'+a.id+'">'+(a.hidden?'다시 보이기':'이 기사 숨기기')+'</button>';

 // 같은 소식을 다룬 다른 매체 기사 목록입니다.
 let sameNews='',sameChip='';
 if(others&&others.length){
  sameChip='<span class="chip">외 '+others.length+'개 매체</span>';
  sameNews='<div class="same-news"><strong>같은 소식을 다룬 기사</strong><ul>'+others.map(function(o){return '<li><a href="'+esc(o.url)+'" target="_blank" rel="noopener noreferrer">'+esc(o.title)+'</a> <span class="muted">'+esc(o.source)+' · '+esc(o.date)+'</span></li>';}).join('')+'</ul></div>';
 }
 // 별표한 기사에만 직접 선택한 분류와 선택 버튼을 표시합니다.
 const impactChip=impactControls(a);

 // 미리보기: 부제목이 있으면 부제목, 없으면 기사 앞부분 90자 정도
 const text=splitText(a);
 const tags='<div class="tags">'+a.tags.map(function(t){return '<span class="tag">'+esc(t)+'</span>';}).join('')+'</div>';

 return '<article class="item'+(a.hidden?' hidden-item':'')+'">'+
  '<div class="item-body">'+
   '<div class="item-title"><a href="'+esc(a.url)+'" target="_blank" rel="noopener noreferrer">'+highlight(a.title)+'</a>'+impactChip+'</div>'+
   '<div class="item-meta"><span class="entity">'+highlight(a.entity)+'</span><span>'+esc(a.source)+'</span><span>'+esc(a.date.slice(5).replace('-','/'))+'</span>'+(a.manual?'<span class="chip">직접 추가</span>':'')+sameChip+'</div>'+
   (text.preview?'<p class="item-preview">'+highlight(text.preview)+'</p>':'')+
   '<details class="item-more"><summary>자세히</summary><div class="item-detail">'+
    originalTitle+
    (text.rest?'<p class="detail-text">'+highlight(text.rest)+'</p>':'')+
    tags+track+sameNews+
    // 원문 링크는 "원문 보기" 대신 주소(URL) 자체를 보여줍니다. 길면 CSS가 끝을 "…"로 자릅니다.
    '<div class="detail-foot"><a class="source" href="'+esc(a.url)+'" target="_blank" rel="noopener noreferrer" title="'+esc(a.url)+'">🔗 '+esc(a.url)+'</a>'+hideButton+'</div>'+
   '</div></details>'+
  '</div>'+star+
 '</article>';
}
// 페이지 나누기: 카테고리마다 한 페이지에 기사(같은 소식 묶음은 1개로 셈)를 최대 4개까지 보여줍니다.
const PAGE_SIZE=4;
const MAX_PAGES=10; // 페이지는 최대 10쪽까지만 보여줍니다. (그보다 오래된 기사는 목록에서 빠짐)
const currentPages={}; // 카테고리별로 지금 보고 있는 페이지 번호 (1부터 시작)
function resetPages(){categories.forEach(function(c){currentPages[c.id]=1;});}
function matchesTopic(a,topic){
 if(!topic)return true;
 if(topic==='Vet')return NewsRules.isVeterinaryImaging(a.title);
 const text=[a.title].concat(a.tags||[]).join(' ');
 if(topic==='AI')return /(?:\bAI\b|인공지능|人工知能)/i.test(text);
 if(topic==='CT')return /(?:\bCT\b|CT(?=[가-힣])|컴퓨터단층|전산화단층|コンピュータ断層)/i.test(text);
 if(topic==='MRI')return /(?:\bMRI?\b|MRI?(?=[가-힣])|자기공명|磁気共鳴)/i.test(text);
 // UL: 초음파(Ultrasound) 장비
 if(topic==='UL')return /초음파|超音波|ultrasound/i.test(text);
 // VL/XR: 혈관조영(Angiography) 장비, 엑스레이 장비
 if(topic==='VL/XR')return /혈관조영|angio|엑스레이|엑스선|X線|血管撮影|x-?ray|\bXR\b|\bVL\b/i.test(text);
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
  const newer=compareNewest(a,b);
  if(sort==='new')return newer;
  return (b.starred?1:0)-(a.starred?1:0)||(b.tags||[]).length-(a.tags||[]).length||newer;
 });
}
// 발행일이 같으면 최근 수집 시각, 그것도 같으면 저장 번호가 큰 기사부터 고릅니다.
// 현재 원문의 발행 시각은 저장하지 않으므로 수집 시각(saved_at)을 사용합니다.
function compareNewest(a,b){return NewsRules.compareNewest(a,b);}
function titlePieces(title){return NewsRules.titlePieces(title);}
function similarity(a,b){return NewsRules.similarity(a,b);}
function groupSameNews(rows){return NewsRules.groupSameNews(rows);}
function render(){
 const q=document.getElementById('search').value.trim().toLocaleLowerCase();
 const topic=document.getElementById('topic').value;
 const period=document.getElementById('period').value;
 const sort=document.getElementById('sort').value;
 const onlyStar=document.getElementById('only-star').checked;
 const showHidden=document.getElementById('show-hidden').checked;
 searchWord=q;
 const matches=articles.filter(function(a){
  const text=[a.title,a.original_title,a.entity,a.source,a.summary].concat(a.tags).join(' ').toLocaleLowerCase();
  return (!q||text.includes(q))&&matchesTopic(a,topic)&&matchesPeriod(a,period)&&(!onlyStar||a.starred)&&(!a.hidden||showHidden);
 });
 // 업계 동향 탭은 필터와 상관없이 전체 기사로 다시 계산합니다. (stats.js)
 if(typeof renderStats==='function')renderStats();
 // 카테고리가 다르게 분류된 중복 기사도 한 번만 표시합니다.
 const allGroups=groupSameNews(matches);
 renderBriefing(allGroups.map(function(g){return g.main;}));
 document.getElementById('sections').innerHTML=categories.map(function(c){
  const groups=allGroups.filter(function(g){return g.main.category===c.id;});
  const ordered=sortRows(groups.map(function(g){return g.main;}),sort);
  const positions=new Map(ordered.map(function(a,i){return [a,i];}));
  groups.sort(function(a,b){return positions.get(a.main)-positions.get(b.main);});
  const originalCount=groups.reduce(function(n,g){return n+1+g.others.length;},0);
  // 전체 페이지 수를 구하고, 지금 페이지가 범위를 넘으면(기사를 숨겨서 줄어든 경우 등) 마지막 페이지로 맞춥니다.
  const pageCount=Math.min(MAX_PAGES,Math.max(1,Math.ceil(groups.length/PAGE_SIZE)));
  let page=currentPages[c.id]||1;
  if(page>pageCount)page=pageCount;
  currentPages[c.id]=page;
  const shown=groups.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
  const more=pageCount>1?pageButtons(c,page,pageCount):'';
  const sameNote=originalCount>groups.length?'중복 기사 포함 '+originalCount+'건':'';
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
['period','sort','only-star','show-hidden'].forEach(function(id){document.getElementById(id).addEventListener('change',changeFilters);});
// 화면 아래에 알림을 잠깐 띄웁니다. (팝업 대신 사용)
// undo를 넘기면 "되돌리기" 버튼이 함께 나옵니다.
let noticeTimer=null;
function showNotice(text,undo){
 const box=document.getElementById('notice');
 box.replaceChildren();
 const message=document.createElement('span');message.textContent=text;box.append(message);
 if(undo){
  const button=document.createElement('button');button.type='button';button.textContent='되돌리기';
  button.onclick=function(){box.hidden=true;undo();};
  box.append(button);
 }
 box.hidden=false;
 clearTimeout(noticeTimer);
 noticeTimer=setTimeout(function(){box.hidden=true;},5000);
}
// 서버에 저장 요청을 보냅니다. 실패하면 한국어 메시지로 바꿔 알려 줍니다.
async function postJson(path,data){
 const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 if(!r.ok){let m='저장하지 못했습니다.';try{m=(await r.json()).error||m;}catch(e){}throw new Error(m);}
 try{return await r.json();}catch(e){throw new Error('저장 결과를 확인하지 못했습니다. 새로고침해 주세요.');}
}
// 별표 저장: 저장하는 동안 버튼을 잠가서 여러 번 눌리지 않게 합니다.
async function saveStar(id,starred,button){
 if(button)button.disabled=true;
 try{await postJson('/api/article-star',{id:id,starred:starred});articles.forEach(function(a){if(a.id===id){a.starred=starred?1:0;if(!starred)a.impact_override='';}});render();}
 catch(e){showNotice(e.message);if(button)button.disabled=false;}
}
// 숨기기 저장: 숨긴 뒤에는 "되돌리기"가 있는 알림을 보여줍니다.
async function saveHidden(id,hidden){
 try{
  await postJson('/api/article-hide',{id:id,hidden:hidden});articles.forEach(function(a){if(a.id===id)a.hidden=hidden;});render();
  if(hidden)showNotice('기사를 숨겼습니다. (숨긴 기사 보기에서 다시 볼 수 있어요)',function(){saveHidden(id,false);});
  else showNotice('기사를 다시 보이게 했습니다.');
 }
 catch(e){showNotice(e.message);}
}
// 기사별 별표·영향 직접 분류·숨김·페이지 이동을 처리합니다.
document.getElementById('sections').addEventListener('click',function(event){
 const starButton=event.target.closest('button[data-star]');
 if(starButton){const id=Number(starButton.getAttribute('data-star'));const now=articles.find(function(a){return a.id===id;});saveStar(id,!(now&&now.starred),starButton);return;}
 const impactButton=event.target.closest('button[data-impact]');
 if(impactButton){saveImpact(impactButton);return;}
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
let titleRefreshTimer=null,titleRefreshAttempts=0;
async function refreshArticles(){clearTimeout(titleRefreshTimer);const r=await fetch('/api/articles');const data=await r.json().catch(function(){return null;});if(!r.ok)throw new Error(data?.error||'기사 목록을 불러오지 못했습니다. (HTTP '+r.status+')');if(!Array.isArray(data?.articles))throw new Error('기사 목록 응답 형식이 올바르지 않습니다.');articles=data.articles.filter(function(a){return !isAwardNews(a);}).map(splitConference);changeFilters();if((data.title_refresh_pending||data.title_refresh_failed>0)&&titleRefreshAttempts<60){titleRefreshAttempts++;titleRefreshTimer=setTimeout(function(){refreshArticles().catch(function(e){console.warn('제목 재조회 실패:',e.message);});},data.title_refresh_pending?2000:65000);}else if(!data.title_refresh_pending&&!data.title_refresh_failed){titleRefreshAttempts=0;}}
refreshArticles().catch(function(e){const box=document.getElementById('sections');box.replaceChildren();const p=document.createElement('p');p.className='empty';p.textContent=e.message;box.append(p);});
