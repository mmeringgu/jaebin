// ───── 업계 동향 탭 및 관리 → 노출 관리의 회사 통계 ─────
// articles.js가 불러온 기사 목록(articles)으로 화면에서 바로 계산합니다. 서버에 따로 저장하지 않습니다.
// 뉴스 탭의 검색·필터와 상관없이, 숨기지 않은 전체 기사(최근 90일)로 셉니다.

// ── 설정: 회사 이름표 ──
// 같은 회사도 기사마다 "지멘스", "Siemens Healthineers"처럼 다르게 써서, 찾을 단어를 여러 개 둡니다. (소문자로)
// mine: true는 우리 회사입니다. (빨간색으로 강조)
const COMPANIES=[
 {name:'캐논',words:['캐논메디칼','캐논 메디칼','캐논메디컬','캐논 메디컬','canon medical'],mine:true},
 {name:'Siemens',words:['지멘스','siemens']},
 {name:'GE',words:['ge헬스케어','ge 헬스케어','ge healthcare','지이헬스케어'],tagWords:['ge']}, // "GE"는 짧아서 본문에서는 찾지 않고 키워드 태그로만 확인합니다.
 {name:'Philips',words:['필립스','philips']},
 {name:'Samsung Medison',words:['삼성메디슨','삼성 메디슨','samsung medison']}
];
// 회수·판매중지 소식을 찾을 단어
const RECALL_WORDS=['회수','리콜','recall','판매중지','판매 중지','사용중지','사용 중지','수입중지','제조중지','안전성 서한'];
// 신설·증설 병원을 찾을 단어 (제목에서만 찾습니다)
// 실제 병원이 짓거나 넓히는 소식만 남기려고, 뜻이 넓은 단어(개설·문 열다 등)는 뺐습니다.
const OPEN_WORDS=['개원','신설','증설','증축','신축','착공','준공','개소','병상 확충','확장 이전','확장 개소'];
// 위 단어가 있어도 병원을 새로 짓거나 넓히는 소식이 아닌 경우는 뺍니다.
// 예) "개원 32주년"(기념일), "개원가"(동네 의원들), "수가 신설"(제도), "의대 신설 요구"(주장)
const OPEN_EXCLUDE=['개원가','개원의','주년','기념','수가','요구','촉구','해야','반대','논란','학회','심포지엄','교수',
 '의대','학과','정원','위원회','협의체','제도','법안','개정','토론','세미나','강좌','교육','캠페인','협회','의사회','약국','팀','원격','해외'];
// 병원 이름이 아니라 "병원 종류"인 경우 (예: "지방 대학병원 신설 필요") 특정 병원 소식이 아니므로 뺍니다.
const GENERIC_HOSPITALS=['병원','대학병원','종합병원','상급종합병원','요양병원','공공병원','지방의료원','의료원','전문병원','국립대병원'];

// ── 설정: 추적할 정책 (3~5개) ──
// words 중 하나가 기사 제목·부제목에 있으면 그 정책 기사로 봅니다. 바꾸고 싶으면 여기만 고치세요.
// (2026-11-09 기준, 최근 기사에 실제로 자주 나오는 정책 중 영상의학 장비와 관련 있는 것으로 골랐습니다)
const TRACKED_POLICIES=[
 {name:'검사 수가 인하·수가 개편',words:['검사 수가','검사수가','검체검사','수가 개편','수가체계','상대가치','환산지수','영상검사 수가','CT 수가','MRI 수가']},
 {name:'관리급여 (비급여 관리)',words:['관리급여','비급여 관리']},
 {name:'의료 AI·디지털헬스 제도',words:['디지털헬스케어법','디지털의료제품법','혁신의료기술','AI 수가','AI 판독','의료 AI 보상']},
 {name:'특수의료장비 설치·품질 기준',words:['특수의료장비','노후 의료장비','노후장비','공동활용병상','병상공동활용']}
];
// 정책 단계: 위에서부터 차례로 확인해서 처음 맞는 단계로 봅니다.
// ("시행 예정"은 아직 시행 전이므로 "확정"에 넣었습니다)
const STAGES=[
 {name:'시행',words:['시행됐','시행된','시행되고','시행 중','본격 시행','시행에 들어','시행 첫','시행 이후']},
 {name:'확정',words:['확정','의결','통과','고시','공포','시행 예정','시행한다','시행키로']},
 {name:'논의',words:['논의','검토','공청회','의견수렴','의견 수렴','입법예고','행정예고','협의','심의','토론회']},
 {name:'발의',words:['발의','추진','제안','계획']}
];
const STAGE_ORDER=['발의','논의','확정','시행'];

let statsPeriod='week'; // 회사별 언급 수 추이: 'week'(주간) 또는 'month'(월간)

// ── 작은 도우미 ──
// 업계 동향·노출 분석은 뉴스 화면의 검색·분야 필터와 독립적으로 전체 분야를 집계합니다.
// 서버의 공통 업무 관련성 기준을 통과한 기사만 받아 뉴스와 같은 모집단으로 셉니다.
function statsArticles(){
 return articles.filter(function(a){return !a.hidden&&NewsRules.isDesignatedArticle(a);});
}
function domesticExposureArticles(list){return list.filter(function(a){return !a.hidden&&NewsRules.isDomesticMedia(a);});}
function textOf(a){return [a.title,a.subtitle,a.summary].join(' ').toLowerCase();}
function linkOf(a){return '<a href="'+esc(a.url)+'" target="_blank" rel="noopener noreferrer">'+esc(a.title)+'</a>';}
function shortDate(day){return day.slice(5).replace('-','/');}
// 이 기사가 회사를 언급하는지 확인합니다. (제목·부제목·기사 앞부분, 또는 키워드 태그)
function mentions(a,company){
 if(company.mine&&a.category==='company')return true;
 const text=textOf(a);
 if(company.words.some(function(w){return text.includes(w);}))return true;
 const tagWords=company.words.concat(company.tagWords||[]);
 return (a.tags||[]).some(function(t){return tagWords.includes(String(t).toLowerCase());});
}
// "2026-11-09"에서 days일을 더한 날짜
function plusDays(day,days){const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
// 그 날짜가 들어 있는 주의 월요일
function mondayOf(day){const d=new Date(day+'T00:00:00Z');return plusDays(day,-((d.getUTCDay()+6)%7));}

// ── 기간 나누기 ──
// 주간: 최근 8주 (월~일), 월간: 최근 3개월 (기사가 90일까지만 있어서 3개월)
function periods(){
 const today=kstDate(0);
 const list=[];
 if(statsPeriod==='week'){
  const thisMonday=mondayOf(today);
  for(let i=7;i>=0;i--){
   const start=plusDays(thisMonday,-7*i);
   list.push({label:i===0?'이번 주':shortDate(start)+'~',start:start,end:plusDays(start,6)});
  }
 }else{
  const year=Number(today.slice(0,4)),month=Number(today.slice(5,7));
  for(let i=2;i>=0;i--){
   const d=new Date(Date.UTC(year,month-1-i,1));
   const start=d.toISOString().slice(0,10);
   const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).toISOString().slice(0,10);
   list.push({label:i===0?'이번 달':(d.getUTCMonth()+1)+'월',start:start,end:end});
  }
 }
 return list;
}

// ───── 1. 경쟁사·우리회사 ─────
// 회사별 언급 수 추이 (표)
function companyTrend(list){
 list=domesticExposureArticles(list).filter(function(a){return a.date<=kstDate(0);});
 const ps=periods();
 const head='<tr><th>회사</th>'+ps.map(function(p){return '<th class="num">'+p.label+'</th>';}).join('')+'<th class="num">변화</th></tr>';
 const rows=COMPANIES.map(function(c){
  const mine=list.filter(function(a){return mentions(a,c);});
  const counts=ps.map(function(p){return mine.filter(function(a){return a.date>=p.start&&a.date<=p.end;}).length;});
  return {c:c,counts:counts,total:counts.reduce(function(sum,n){return sum+n;},0)};
 }).sort(function(a,b){return b.total-a.total;});
 const body=rows.map(function(row){
  const c=row.c,counts=row.counts;
  const now=counts[counts.length-1],before=counts[counts.length-2];
  return '<tr'+(c.mine?' class="mine-row"':'')+'><td class="trend-name">'+esc(c.name)+'</td>'+
   counts.map(function(n,i){return '<td class="num'+(i===counts.length-1?' now':'')+'">'+n+'</td>';}).join('')+
   '<td class="num">'+changeMark(now,before)+'</td></tr>';
 }).join('');
 const toggle='<div class="seg" role="group" aria-label="기간 단위">'+
  '<button type="button" class="seg-button'+(statsPeriod==='week'?' on':'')+'" data-stats-period="week">주간</button>'+
  '<button type="button" class="seg-button'+(statsPeriod==='month'?' on':'')+'" data-stats-period="month">월간</button></div>';
 return '<div class="stat-box company-trend"><div class="box-head"><h3>회사별 언급 수 추이 <span class="muted">표시 기간 합계순</span></h3>'+toggle+'</div>'+
  '<div class="company-trend-scroll"><table class="trend-table">'+head+body+'</table></div></div>';
}
// 증감 표시: 늘면 ▲(진한 글자), 줄면 ▼(회색), 같으면 – (좋고 나쁨이 아니라 변화만 보여줌)
function changeMark(now,before){
 if(now>before)return '<span class="trend-up">▲ '+(now-before)+'</span>';
 if(now<before)return '<span class="trend-down">▼ '+(before-now)+'</span>';
 return '<span class="muted">–</span>';
}
// 언급 점유율: 최근 30일, 다섯 회사 언급 수 합계 중 각 회사 비율
function companyShare(list){
 const recent=recentExposureArticles(list);
 const rows=COMPANIES.map(function(c){return {c:c,n:recent.filter(function(a){return mentions(a,c);}).length};});
 const total=rows.reduce(function(sum,r){return sum+r.n;},0);
 rows.sort(function(x,y){return y.n-x.n;});
 if(total===0)return '<div class="stat-box company-share"><h3>언급 점유율 <span class="muted">최근 30일</span></h3><p class="muted">최근 30일 동안 회사 이름이 나온 기사가 없습니다.</p></div>';
 const rank=rows.findIndex(function(r){return r.c.mine;})+1;
 const bars=rows.map(function(r){
  const pct=Math.round(r.n/total*100);
  return '<div class="bar-row'+(r.c.mine?' mine':'')+'"><span class="bar-name">'+esc(r.c.name)+'</span><span class="bar-track"><span class="bar-fill" style="width:'+pct+'%"></span></span><span class="bar-num">'+pct+'%</span></div>';
 }).join('');
 return '<div class="stat-box company-share"><h3>언급 점유율 <span class="muted">최근 30일 · '+total+'건 기준</span></h3>'+
  '<p class="share-rank">우리 회사 노출 <b>'+rank+'위</b> / '+rows.length+'개 회사</p>'+bars+'</div>';
}

// 두 비교는 점유율과 같은 최근 30일·회사 판정 기준을 사용합니다.
function recentExposureArticles(list){
 const since=kstDate(29),today=kstDate(0);
 return domesticExposureArticles(list).filter(function(a){return a.date>=since&&a.date<=today;});
}
function exposureCounts(list){
 return COMPANIES.map(function(c){return list.filter(function(a){return mentions(a,c);}).length;});
}
function topicExposureRows(list){
 const recent=recentExposureArticles(list);
 return ['CT','MRI','UL','VL/XR','AI','Vet'].map(function(topic){
  return {name:topic,counts:exposureCounts(recent.filter(function(a){return matchesTopic(a,topic);}))};
 });
}
function mediaExposureRows(list){
 const media=new Map();
 recentExposureArticles(list).forEach(function(a){
  const counts=exposureCounts([a]);
  if(!counts.some(function(n){return n>0;}))return;
  // 같은 매체의 직접 수집과 빙 검색을 한 줄로 합칩니다.
  const name=String(a.source||'').replace(/\s*\(빙 검색\)\s*$/,'').trim()||'매체 미확인';
  if(!media.has(name))media.set(name,{name:name,counts:COMPANIES.map(function(){return 0;}),competitorArticles:0});
  const row=media.get(name);
  counts.forEach(function(n,i){row.counts[i]+=n;});
  // 여러 경쟁사를 동시에 언급해도 매체의 경쟁사 기사 수는 한 건입니다.
  if(counts.some(function(n,i){return !COMPANIES[i].mine&&n>0;}))row.competitorArticles++;
 });
 return Array.from(media.values()).sort(function(a,b){
  return b.competitorArticles-a.competitorArticles||b.counts.reduce(function(s,n){return s+n;},0)-a.counts.reduce(function(s,n){return s+n;},0)||a.name.localeCompare(b.name,'ko');
 });
}
function exposureTable(rows,label){
 const order=COMPANIES.map(function(c,i){return {c:c,index:i,total:rows.reduce(function(sum,row){return sum+row.counts[i];},0)};}).sort(function(a,b){return b.total-a.total;});
 const head='<thead><tr><th scope="col">'+esc(label)+'</th>'+order.map(function(item){return '<th scope="col" class="num'+(item.c.mine?' exposure-mine':'')+'">'+esc(item.c.name)+'</th>';}).join('')+'</tr></thead>';
 const body=rows.map(function(row){
  const max=Math.max(1,...row.counts);
  return '<tr><th scope="row">'+esc(row.name)+'</th>'+order.map(function(item){
   const n=row.counts[item.index];
   return '<td class="num'+(item.c.mine?' exposure-mine':'')+'"><span class="exposure-count">'+n+'<span class="exposure-track" aria-hidden="true"><span style="width:'+Math.round(n/max*100)+'%"></span></span></span></td>';
  }).join('')+'</tr>';
 }).join('');
 return '<div class="exposure-scroll" tabindex="0" role="region" aria-label="'+esc(label)+'별 회사 언급 비교"><table class="trend-table exposure-table">'+head+'<tbody>'+body+'</tbody></table></div>';
}
function exposureComparisons(list){
 const topics=topicExposureRows(list),media=mediaExposureRows(list);
 const hasTopics=topics.some(function(row){return row.counts.some(function(n){return n>0;});});
 return '<div class="exposure-comparisons"><div class="stat-box"><h3>분야별 회사 비교</h3>'+
  (hasTopics?exposureTable(topics,'분야'):'<p class="muted">조건에 맞는 분야별 회사 언급 기사가 없습니다.</p>')+'</div>'+
  '<div class="stat-box"><h3>매체별 노출 비교</h3>'+
  (media.length?exposureTable(media,'매체'):'<p class="muted">조건에 맞는 국내 매체별 회사 언급 기사가 없습니다.</p>')+'</div></div>';
}
const MOVEMENT_COMPANIES=['Philips','GE','Siemens','Samsung Medison'];
function movementTopic(a){
 const title=a.title.toLowerCase();
 const topics=[['mna',/인수|합병|분사|분리|acquisition|merger|spin.off/],['approval',/허가|승인|인증|approval|clearance/],
  ['supply',/공급|계약|수주|납품|supply|contract/],['product',/출시|신제품|개발|launch|new\s+(?:product|system)|develop/],
  ['investment',/투자|공장|생산|증설|investment|factory|manufactur/],['financial',/실적|매출|영업이익|수익|revenue|earnings/]];
 return topics.find(function(topic){return topic[1].test(title);})?.[0]||'';
}
function selectMovementStories(groups){
 const candidates=groups.map(function(group){
  const members=[group.main,...group.others].sort(NewsRules.compareNewest);
  const a=members.find(function(a){return a.starred;})||group.main;
  return {a:a,others:members.filter(function(other){return other!==a;}),topic:movementTopic(a),priority:a.starred?2:movementTopic(a)?1:0};
 }).sort(function(a,b){return b.priority-a.priority||NewsRules.compareNewest(a.a,b.a);});
 const selected=[],topics=new Set();
 // 중요 기사 → 주요 사업 변화 → 그 외 순서로 채우되 같은 우선순위에서는 주제를 분산합니다.
 [2,1,0].forEach(function(priority){
  const band=candidates.filter(function(row){return row.priority===priority;});
  band.forEach(function(row){
   if(selected.length>=3||(row.topic&&topics.has(row.topic)))return;
   selected.push(row);if(row.topic)topics.add(row.topic);
  });
  band.forEach(function(row){if(selected.length<3&&!selected.includes(row))selected.push(row);});
 });
 return selected.sort(function(a,b){return NewsRules.compareNewest(a.a,b.a);});
}
// 최근 30일의 네 경쟁사만 중복 제거 후 회사별 최대 3건을 선별합니다.
function competitorMovementRows(list){
 const since=kstDate(29),today=kstDate(0),companies=new Map();
 list.filter(function(a){return !a.hidden&&a.category==='competitor'&&a.date>=since&&a.date<=today
  &&!RECALL_WORDS.some(function(word){return a.title.toLowerCase().includes(word);});}).forEach(function(a){
  const name=NewsRules.designatedCompany(a);
  if(!name)return;
  if(!companies.has(name))companies.set(name,[]);companies.get(name).push(a);
 });
 const rows=[];
 companies.forEach(function(items,name){
  const urls=new Set(),headlines=new Set();
  const unique=items.slice().sort(function(a,b){return Number(!!b.starred)-Number(!!a.starred)||NewsRules.compareNewest(a,b);}).filter(function(a){
   const headline=movementHeadline({company:name,a:a}).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}.]/gu,'');
   if(urls.has(a.url)||headlines.has(headline))return false;
   urls.add(a.url);headlines.add(headline);return true;
  });
  const groups=NewsRules.groupSameNews(unique).sort(function(a,b){return NewsRules.compareNewest(a.main,b.main);});
  selectMovementStories(groups).forEach(function(row){rows.push({company:name,a:row.a,others:row.others});});
 });
 return rows.sort(function(a,b){return NewsRules.compareNewest(a.a,b.a);});
}
function movementHeadline(row){
 // 카드 머리의 회사명을 제목 앞에서만 덜어내고 제품·규모·시점 등 원문 사실은 유지합니다.
 const company=COMPANIES.find(function(c){return c.name===row.company;});
 const names=(company?company.words.concat(company.tagWords||[]):[row.company])
  .concat(row.company==='Siemens'?['지멘스 헬시니어스','지멘스헬시니어스','Siemens Healthineers']:[])
  .sort(function(a,b){return b.length-a.length;});
 let title=String(row.a.title||'').trim();
 for(const name of names){
  if(title.toLowerCase().startsWith(name.toLowerCase())){
   const rest=title.slice(name.length);
   if(rest&&!/^[\s,，:：·…'’"“”‘「『]/.test(rest))continue;
   const clean=rest.replace(/^['’]s\b/i,'').replace(/^[\s,，:：·…'’"“”‘「『]+/,'').trim();
   if(clean.length>=8)title=clean;
   break;
  }
 }
 return title;
}
function movementStory(row){
 const a=row.a,headline=movementHeadline(row);
 const link=/^https?:\/\//i.test(a.url)?'<a class="movement-title" href="'+esc(a.url)+'" target="_blank" rel="noopener noreferrer" title="'+esc(a.title)+'">'+esc(headline)+'</a>':'<span class="movement-title">'+esc(headline)+'</span>';
 const source=/^https?:\/\//i.test(a.url)?'<a href="'+esc(a.url)+'" target="_blank" rel="noopener noreferrer" title="'+esc(a.source||'원문')+'">'+esc(a.source||'원문')+'</a>':'';
 return '<li class="movement-story">'+link+'<time datetime="'+esc(a.date)+'">'+esc(shortDate(a.date))+'</time><span class="movement-row-sources">'+source+'</span></li>';
}
function competitorMovements(list){
 const companies=new Map();
 competitorMovementRows(list).forEach(function(row){
  if(!companies.has(row.company))companies.set(row.company,[]);
  companies.get(row.company).push(row);
 });
 // 네 회사의 위치와 카드 높이를 고정해 한눈에 비교할 수 있게 합니다.
 const cards=MOVEMENT_COMPANIES.map(function(name){
  const rows=companies.get(name)||[];
  return '<article class="movement-card"><header class="movement-company"><h4>'+esc(name)+'</h4></header>'+
   (rows.length?'<ul class="movement-stories">'+rows.map(movementStory).join('')+'</ul>':'<p class="movement-empty">최근 30일의 선별 기사가 없습니다.</p>')+'</article>';
 });
 const body=cards.length?'<div class="movement-grid">'+cards.join('')+'</div>':'<p class="muted">최근 30일의 경쟁사 움직임 기사가 없습니다.</p>';
 return '<div class="stat-box wide"><h3>경쟁사 움직임</h3>'+body+'</div>';
}
// 회수·판매중지 현황: 경쟁사 이름과 회수·판매중지 단어가 함께 나온 기사
function recallList(list){
 const rows=[];
 list.forEach(function(a){
  const text=textOf(a);
  if(!RECALL_WORDS.some(function(w){return text.includes(w);}))return;
  const company=COMPANIES.find(function(c){return !c.mine&&mentions(a,c);});
  if(company)rows.push({a:a,company:company.name});
 });
 const body=rows.length?'<ul class="stat-list">'+rows.slice(0,10).map(function(r){
  return '<li><span class="list-date">'+shortDate(r.a.date)+'</span><span class="chip">'+esc(r.company)+'</span>'+linkOf(r.a)+' <span class="muted">'+esc(r.a.source)+'</span></li>';
 }).join('')+'</ul>':'<p class="muted">최근 90일 동안 언론에 나온 경쟁사 회수·판매중지 소식이 없습니다.</p>';
 return '<div class="stat-box"><h3>회수·판매중지 현황</h3>'+body+'</div>';
}

// ───── 2. 병원 ─────
// 기사 제목에서 병원 이름을 꺼냅니다. 예) "OO대학교병원, 암센터 신축" → "OO대학교병원"
// "병원"·"의료원"으로 끝나는 첫 이름과 뒤에 붙은 분원·캠퍼스를 씁니다. 못 찾으면 "–"
function hospitalNameOf(a){
 const title=a.title.normalize('NFKC');
 const m=title.match(/[가-힣A-Za-z0-9]+(?:대학교\s*병원|대\s*병원|병원|의료원)(?:\s+[가-힣A-Za-z0-9]*(?:분원|캠퍼스))?/);
 return m?m[0].replace(/\s+/g,' ').trim():'–';
}
// 약칭만 통일하고 지역·분원명은 남겨 서로 다른 병원이 합쳐지지 않게 합니다.
function hospitalKeyOf(name){
 return name.normalize('NFKC').replace(/\s+/g,'').replace(/대학(?:교)?병원/g,'대병원').toLowerCase();
}
// 착공·준공 등 진행 단계가 달라도 같은 시설이면 같은 사업입니다.
function hospitalProjectOf(a){
 const title=a.title.normalize('NFKC');
 const name=hospitalNameOf(a);
 const projectTitle=name==='–'?title:title.replace(name,' ');
 const targets=projectTitle.match(/[가-힣A-Za-z0-9]+센터|[가-힣A-Za-z0-9]*(?:별관|본관|신관|동관|서관|남관|북관)|제\d+병동/g)||[];
 return Array.from(new Set(targets)).sort().join(' · ')||'병원 전체';
}
// 기사에서 예상 시기(개원·준공 예정 시기)를 찾습니다. 못 찾으면 "–"
// 예) "2027년 3월 개원 예정" → "2027년 3월", "내년 상반기 준공" → "내년 상반기"
function openTimeOf(a){
 const text=[a.title,a.subtitle||'',a.summary||''].join(' ');
 const m=text.match(/(?:\d{4}년|내년|올해|연내)\s*(?:\d{1,2}월|상반기|하반기|초|말)?/);
 return m?m[0].trim():'–';
}
// 신설·증설 병원인지 확인합니다. 아래 3가지를 모두 만족해야 표에 넣습니다. (보수적으로 고름)
// 1) 병원 카테고리 기사  2) 제목에 개원·신설·증설 같은 단어가 있고, 예외 단어는 없음  3) 제목에 구체적인 병원 이름이 있음
function isNewHospitalNews(a){
 if(a.category!=='hospital')return false;
 if(!OPEN_WORDS.some(function(w){return a.title.includes(w);}))return false;
 if(OPEN_EXCLUDE.some(function(w){return a.title.includes(w);}))return false;
 const name=hospitalNameOf(a);
 return name!=='–'&&!GENERIC_HOSPITALS.includes(name);
}
// 병원명·사업별로 모으고 최신 기사를 대표로 씁니다. 원본 기사는 모두 보존합니다.
function hospitalProjects(list){
 const groups=new Map();
 list.filter(isNewHospitalNews).slice().sort(NewsRules.compareNewest).forEach(function(a){
  const name=hospitalNameOf(a),project=hospitalProjectOf(a);
  const key=hospitalKeyOf(name)+'|'+project;
  if(!groups.has(key))groups.set(key,{name:name,project:project,main:a,articles:[]});
  const group=groups.get(key);
  if(!group.articles.some(function(old){return old.url===a.url;}))group.articles.push(a);
 });
 return Array.from(groups.values());
}
// 신설·증설 병원: 사업당 한 줄, 추가 보도는 같은 줄의 출처로 표시합니다.
function newHospitals(list){
 const rows=hospitalProjects(list);
 const body=rows.length?'<div class="table-scroll"><table class="trend-table"><tr><th>병원명</th><th>사업</th><th>예상 시기</th><th>출처 기사</th></tr>'+rows.slice(0,15).map(function(group){
  const sources=group.articles.map(function(a){
   return '<a href="'+esc(a.url)+'" target="_blank" rel="noopener noreferrer">'+esc(a.source)+' · '+shortDate(a.date)+'</a>';
  });
  const source=sources[0]+(sources.length>1?'<details><summary>추가 출처 '+(sources.length-1)+'건</summary>'+sources.slice(1).join('<br>')+'</details>':'');
  return '<tr><td class="trend-name">'+esc(group.name)+'</td><td>'+esc(group.project)+'</td><td>'+esc(openTimeOf(group.main))+'</td><td class="trend-latest">'+source+'</td></tr>';
 }).join('')+'</table></div>':'<p class="muted">최근 90일 동안 개원·센터 신설 기사가 없습니다.</p>';
 return '<div class="stat-box wide"><h3>신설·증설 병원</h3>'+body+'</div>';
}

// ───── 3. 정책 ─────
// 기사 제목·부제목을 보고 정책 단계를 정합니다. 단계 단어가 없으면 빈 글자입니다.
function stageOf(a){
 const text=a.title+' '+(a.subtitle||'');
 const found=STAGES.find(function(s){return s.words.some(function(w){return text.includes(w);});});
 return found?found.name:'';
}
// 정책별로 관련 기사(최신순)와 현재 단계, 이번 주 시작 전 단계를 구합니다.
function policyStatus(list){
 const weekStart=mondayOf(kstDate(0));
 return TRACKED_POLICIES.map(function(p){
  const related=list.filter(function(a){
   const text=a.title+' '+(a.subtitle||'');
   return p.words.some(function(w){return text.includes(w);});
  }).sort(NewsRules.compareNewest);
  const staged=related.filter(function(a){return stageOf(a)!=='';});
  const latest=staged[0]||null;
  const beforeWeek=staged.find(function(a){return a.date<weekStart;})||null;
  const now=latest?stageOf(latest):'';
  const before=beforeWeek?stageOf(beforeWeek):'';
  // 이번 주에 새 기사가 나왔고 단계가 지난주까지와 다르면 "단계 변화"
  const changed=latest!==null&&latest.date>=weekStart&&now!==before;
  return {policy:p,related:related,latest:latest,now:now,before:before,changed:changed};
 });
}
// 발의 → 논의 → 확정 → 시행 단계 표시
function stageSteps(now){
 const index=STAGE_ORDER.indexOf(now);
 return '<ol class="steps">'+STAGE_ORDER.map(function(name,i){
  const cls=i<index?'done':i===index?'current':'';
  return '<li class="'+cls+'">'+name+'</li>';
 }).join('')+'</ol>';
}
function policyBoard(statuses){
 const rows=statuses.map(function(s){
  const latest=s.latest?linkOf(s.latest)+' <span class="muted">'+shortDate(s.latest.date)+'</span>':'<span class="muted">단계를 알 수 있는 기사가 아직 없습니다.</span>';
  return '<tr'+(s.changed?' class="changed-row"':'')+'><td class="trend-name">'+esc(s.policy.name)+(s.changed?' <span class="chip chip-notice">이번 주 변화</span>':'')+'</td>'+
   '<td>'+(s.now?stageSteps(s.now):'<span class="muted">–</span>')+'</td>'+
   '<td class="trend-latest">'+latest+'</td></tr>';
 }).join('');
 return '<div class="stat-box wide"><h3>정책 현황판</h3>'+
  '<div class="table-scroll"><table class="trend-table policy-table"><tr><th>정책</th><th>현재 단계</th><th>근거 기사</th></tr>'+rows+'</table></div></div>';
}
// 같은 기사·중복 보도는 한 번만 표시하되 정책마다 다른 이전 단계는 유지합니다.
function policyChangeGroups(statuses){
 const stages=new Map(),groups=[];
 statuses.filter(function(s){return s.changed&&s.latest;}).forEach(function(s){
  if(!stages.has(s.now))stages.set(s.now,[]);
  stages.get(s.now).push(s);
 });
 stages.forEach(function(changed){
  const articles=new Map();
  changed.slice().sort(function(a,b){return NewsRules.compareNewest(a.latest,b.latest);}).forEach(function(s){
   if(!articles.has(s.latest.url))articles.set(s.latest.url,s.latest);
  });
  NewsRules.groupSameNews(Array.from(articles.values())).forEach(function(story){
   const urls=new Set([story.main].concat(story.others).map(function(a){return a.url;})),seen=new Set();
   const changes=changed.filter(function(s){
    if(!urls.has(s.latest.url)||seen.has(s.policy.name))return false;
    seen.add(s.policy.name);return true;
   });
   groups.push({main:story.main,others:story.others,changes:changes});
  });
 });
 return groups.sort(function(a,b){return NewsRules.compareNewest(a.main,b.main);});
}
function policyChanges(statuses){
 const groups=policyChangeGroups(statuses);
 const body=groups.length?'<ul class="stat-list policy-changes">'+groups.map(function(group){
  const changes=group.changes.map(function(s){
   return '<div><b>'+esc(s.policy.name)+'</b> <span class="stage-move">'+esc(s.before||'처음 확인')+' → <b>'+esc(s.now)+'</b></span></div>';
  }).join('');
  const others=group.others.length?'<span class="policy-change-sources">추가 출처 '+group.others.length+'건 · '+group.others.map(function(a){
   return '<a href="'+esc(a.url)+'" target="_blank" rel="noopener noreferrer">'+esc(a.source||'원문')+'</a>';
  }).join(' · ')+'</span>':'';
  return '<li><div class="policy-change-stages">'+changes+'</div>'+linkOf(group.main)+others+'</li>';
 }).join('')+'</ul>':'<p class="muted">이번 주에 단계가 바뀐 정책이 없습니다.</p>';
 return '<div class="stat-box"><h3>이번 주 단계 변화</h3>'+body+'</div>';
}
// 시행 예정 일정: 기사에 날짜가 적혀 있는 경우만 찾아 보여줍니다.
// 예) "내년 1월 1일부터 시행" → 시행일, "12월 15일까지 의견을 받는다" → 의견수렴 마감
function policySchedule(list,statuses){
 const today=kstDate(0);
 const rows=[];
 const seen={};
 list.filter(function(a){
  return a.category==='policy'||statuses.some(function(s){return s.related.includes(a);});
 }).forEach(function(a){
  // 문장 단위로 나눠서, "시행"이나 "의견·마감·예고"가 들어간 문장에서 날짜를 찾습니다.
  [a.title,a.subtitle||'',a.summary||''].join('. ').split(/[.\n]/).forEach(function(sentence){
   let kind='';
   if(sentence.includes('까지')&&(sentence.includes('의견')||sentence.includes('마감')||sentence.includes('예고')))kind='의견수렴 마감';
   else if(sentence.includes('시행'))kind='시행일';
   if(!kind)return;
   // "2027년 1월 1일", "1월 1일", "내년 1월" 같은 날짜를 찾습니다. (일이 없으면 그 달 전체로 봅니다)
   const m=sentence.match(/(?:(\d{4})년\s*)?(\d{1,2})월(?:\s*(\d{1,2})일)?/);
   if(!m)return;
   const month=Number(m[2]);
   if(month<1||month>12)return;
   // 연도: 적혀 있으면 그대로, "내년"이면 기사 연도+1, 없으면 기사 연도 (기사 날짜보다 두 달 넘게 앞서면 다음 해)
   let year=m[1]?Number(m[1]):Number(a.date.slice(0,4));
   if(!m[1]&&sentence.includes('내년'))year=year+1;
   const onlyMonth=!m[3];
   let day=year+'-'+String(month).padStart(2,'0')+'-'+String(m[3]||1).padStart(2,'0');
   if(!m[1]&&!sentence.includes('내년')&&day<plusDays(a.date,-60))day=(year+1)+day.slice(4);
   // 이미 지난 날짜는 빼기 (월만 있으면 그 달이 끝나기 전까지는 보여줌)
   if(onlyMonth?day.slice(0,7)<today.slice(0,7):day<today)return;
   const key=day+kind+a.title;
   if(seen[key])return;
   seen[key]=true;
   const policy=statuses.find(function(s){return s.related.includes(a);});
   rows.push({day:day,onlyMonth:onlyMonth,kind:kind,a:a,policy:policy?policy.policy.name:''});
  });
 });
 rows.sort(function(x,y){return x.day.localeCompare(y.day);});
 const body=rows.length?'<ul class="stat-list">'+rows.slice(0,15).map(function(r){
  const left=Math.round((new Date(r.day)-new Date(today))/86400000);
  // 올해가 아니면 연도까지 보여줍니다. (예: 2027/03/01)
  let dayText=r.day.slice(0,4)===today.slice(0,4)?shortDate(r.day):r.day.replace(/-/g,'/');
  // 월만 적힌 기사는 "2027/01 중"처럼 보여주고 D-day는 붙이지 않습니다.
  if(r.onlyMonth)dayText=(r.day.slice(0,4)===today.slice(0,4)?Number(r.day.slice(5,7))+'월':r.day.slice(0,7).replace('-','/'))+' 중';
  const dday=r.onlyMonth?'':'<span class="d-day">'+(left===0?'D-day':'D-'+left)+'</span>';
  return '<li><span class="list-date">'+dayText+'</span><span class="chip'+(r.kind==='시행일'?' kind-start':'')+'">'+r.kind+'</span>'+dday+
   (r.policy?'<b>'+esc(r.policy)+'</b> · ':'')+linkOf(r.a)+'</li>';
 }).join('')+'</ul>':'<p class="muted">기사에 날짜가 적힌 시행·의견수렴 일정이 없습니다.</p>';
 return '<div class="stat-box"><h3>시행 예정 일정</h3>'+body+'</div>';
}

// ───── 업계 동향 탭 및 관리 → 노출 관리의 회사 통계 그리기 ─────
// articles.js의 render()가 기사 목록이 바뀔 때마다 부릅니다.
function renderStats(){
 const list=statsArticles();
 document.getElementById('stats-company').innerHTML='<div class="stat-grid company-comparison">'+companyTrend(list)+companyShare(list)+'</div>'+exposureComparisons(list);
 document.getElementById('stats-competitor').innerHTML=recallList(list);
 document.getElementById('stats-movements').innerHTML=competitorMovements(list);
 document.getElementById('stats-hospital').innerHTML='<div class="stat-grid">'+newHospitals(list)+'</div>';
 const statuses=policyStatus(list);
 document.getElementById('stats-policy').innerHTML='<div class="stat-grid">'+policyBoard(statuses)+policyChanges(statuses)+policySchedule(list,statuses)+'</div>';
}
// 주간/월간 버튼
document.getElementById('stats-company').addEventListener('click',function(event){
 const button=event.target.closest('button[data-stats-period]');
 if(!button)return;
 statsPeriod=button.getAttribute('data-stats-period');
 renderStats();
});
// 기사를 이미 불러왔다면 바로 그립니다.
if(articles.length)renderStats();
