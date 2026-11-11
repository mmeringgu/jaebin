// Shared title classification and duplicate grouping for browser and Worker.
(function(root){
function guessImpact(a){
 const title=a.title||'';
 if(/검토|추진|논의|계획|예정|가능성|전망|우려|취소|중단|철회|보류|실패|무산|않|못|아니|아닌|없|여부|반대|해제|오보|부인/.test(title))return '';
 const device=/(?:\bCT\b|\bMRI\b|CT(?=[가-힣])|MRI(?=[가-힣])|초음파|엑스레이|엑스선|X-ray|혈관조영|영상진단장비|의료영상장비)/i.test(title);
 if(a.category==='company'||a.category==='competitor'){
  if(!device||/협력|협약|MOU|공동|제휴/i.test(title))return '';
  const growth=/출시|판매\s*허가|품목\s*허가|공급\s*계약|수주|납품|설치|도입/.test(title);
  const setback=/리콜|판매\s*중지|판매\s*금지|제품\s*회수/.test(title);
  if(growth===setback)return '';
  return (a.category==='company'?growth:setback)?'기회':'위협';
 }
 if(a.category==='hospital'){
  if(!/병원|의료원|검진센터|의대/.test(title)||/폐쇄|폐원|축소|감축/.test(title))return '';
  return /개원|개소|신설\s*확정|증설|증축|신축|착공|준공|확충/.test(title)||(device&&/도입|설치|구매/.test(title))?'기회':'';
 }
 if(a.category==='policy'&&device){
  const good=/수가(?:를|가|는)?\s*(?:\d+(?:\.\d+)?%?\s*)?인상/.test(title);
  const bad=/(?:수가|급여(?:\s*대상)?)(?:를|가|는)?\s*(?:\d+(?:\.\d+)?%?\s*)?(?:인하|삭감|축소|폐지)/.test(title);
  if(good!==bad)return good?'기회':'위협';
 }
 return '';
}

function impactOf(a){
 return ['기회','위협'].includes(a.impact_override)?a.impact_override:guessImpact(a);
}

function compareNewest(a,b){
 return b.date.localeCompare(a.date)||String(b.saved_at||'').localeCompare(String(a.saved_at||''))||Number(b.id||0)-Number(a.id||0);
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
const SAME_DAY_LEVEL=0.15;   // 같은 날짜에는 제목 조각의 겹침이 적어도 중복으로 묶습니다.
// 두 기사가 같은 소식인지 봅니다. 같은 날이면 기준을 낮추고, 3일 넘게 떨어져 있으면 다른 소식입니다.
function isSameNews(m,a,pieces){
 const days=daysBetween(m.date,a.date);
 if(days>3)return false;
 const level=days===0?SAME_DAY_LEVEL:SAME_NEWS_LEVEL;
 return similarity(m.pieces,pieces)>=level;
}
// 묶음 안의 기사 "하나라도" 제목이 비슷하면 같은 묶음에 넣습니다.
// (예전에는 묶음의 첫 기사하고만 비교해서, 제목이 조금 다른 매체 기사가 따로 나오곤 했습니다)
function groupSameNews(rows){
 const groups=[];
 // 화면 정렬(관련도·별표)과 관계없이 최신 기사를 대표로 선택합니다.
 rows.slice().sort(compareNewest).forEach(function(a){
  const pieces=titlePieces(a.title);
  const matching=groups.filter(function(g){
   return g.members.some(function(m){return isSameNews(m,a,pieces);});
  });
  if(matching.length){
   const found=matching[0];
   found.others.push(a);found.members.push({date:a.date,pieces:pieces});
   // 한 기사가 여러 묶음에 겹치면 그 묶음들도 합쳐 대표 카드가 둘 남지 않게 합니다.
   matching.slice(1).forEach(function(g){
    found.others.push(g.main,...g.others);found.members.push(...g.members);
    groups.splice(groups.indexOf(g),1);
   });
   found.others.sort(compareNewest);
  }
  else groups.push({main:a,others:[],members:[{date:a.date,pieces:pieces}]});
 });
 return groups;
}

root.NewsRules=Object.freeze({guessImpact,impactOf,compareNewest,titlePieces,similarity,groupSameNews});
})(globalThis);
