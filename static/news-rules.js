// Shared title classification and duplicate grouping for browser and Worker.
(function(root){
// 뉴스 수집 대상은 넓게 유지하고, 월간 요약·업계 동향에는 지정 경쟁사만 반영합니다.
const designatedCompanies=Object.freeze([
 {name:'GE',pattern:/(?:지이\s*헬스\s*케어|(?<![a-z0-9])ge(?:\s*health\s*care)?(?:\s*헬스\s*케어)?(?![a-z0-9]))/gi},
 {name:'Siemens',pattern:/(?:지멘스(?:\s*헬시니어스)?|\bsiemens(?:[\s-]+healthineers)?\b)/gi},
 {name:'Philips',pattern:/(?:필립스|\bphilips(?:\s*healthcare)?\b)/gi},
 {name:'Samsung Medison',pattern:/(?:삼성\s*메디슨|\bsamsung\s*medison\b)/gi}
]);
function companyLabel(value){
 let label=String(value??'');
 designatedCompanies.forEach(function(company){label=label.replace(company.pattern,company.name);});
 return label;
}
function designatedCompany(a){
 const value=String(a.entity||a.title||'').normalize('NFKC');
 const company=designatedCompanies.find(function(company){company.pattern.lastIndex=0;return company.pattern.test(value);});
 return company?company.name:'';
}
function isDesignatedArticle(a){return a.category!=='competitor'||!!designatedCompany(a);}
// 제목의 언어나 번역 여부가 아닌 발행처 도메인으로 국내 언론 여부를 확인합니다.
const domesticMediaHosts=new Set([
 'docdocdoc.co.kr','whosaeng.com','medigatenews.com','khanews.com','medicaltimes.com','doctorsnews.co.kr','etnews.com','bosa.co.kr','rapportian.com','doctorstimes.com','dailypharm.com','medipana.com','monews.co.kr','yakup.com','yna.co.kr',
 'chosun.com','donga.com','hankyung.com','sedaily.com','fnnews.com','joongang.co.kr','hani.co.kr','khan.co.kr','mk.co.kr','mt.co.kr','edaily.co.kr','asiae.co.kr','newsis.com','news1.kr','newspim.com','gukjenews.com',
 'ytn.co.kr','kbs.co.kr','imbc.com','sbs.co.kr','koreaherald.com','koreatimes.co.kr','bizwatch.co.kr','businesspost.co.kr','medifonews.com','medworld.co.kr','healthinnews.co.kr','dailymedi.com'
]);
function isDomesticMedia(a){
 if(typeof a.domestic_media==='boolean')return a.domestic_media;
 if(['canon_official','mohw','mfds','hira','nhis','kha','snuh','sev','amc','cmc'].includes(a.source_kind))return false;
 let host;try{host=new URL(a.url).hostname.toLowerCase().replace(/^www\./,'');}catch{return false;}
 const belongs=function(domain){return host===domain||host.endsWith('.'+domain);};
 if(['canon','canon.com','canon.co.kr','canon.kr','medical.canon','yahoo.com','msn.com','newswire.ca','prnewswire.com','businesswire.com','globenewswire.com','reuters.com','bloomberg.com','note.com','nikkei.com'].some(belongs))return false;
 if([...domesticMediaHosts].some(belongs))return true;
 // 추가 빙 검색 매체는 국내 도메인과 언론사 표기를 모두 요구합니다. 기관·개인 글은 제외합니다.
 const name=String(a.source||'').replace(/\s*\(빙 검색\)\s*$/,'').trim();
 return host.endsWith('.kr')&&!/\.(?:go|ac|or|re)\.kr$/.test(host)&&!/공식|보도자료|병원|의료원|협회|학회|공단|진흥원|로이터|블룸버그|야후|Reuters|Bloomberg/i.test(name)&&/뉴스|신문|일보|투데이|데일리|타임[스즈]|저널|프레스|미디어|방송|^KBS$|^MBC$|^SBS$|^YTN$|^KNN$/i.test(name);
}
// 한글 번역 여부와 무관하게 발행처를 기준으로 국내·글로벌 뉴스를 구분합니다.
// 국내 기관·기업 공식 사이트는 언론 노출 집계 대상과는 별도로 국내에 포함합니다.
function newsRegion(a){
 if(isDomesticMedia(a))return 'domestic';
 try{
  const host=new URL(a.url).hostname.toLowerCase();
  return host.endsWith('.kr')||host==='kr'?'domestic':'global';
 }catch{return 'global';}
}
// 수의 맥락과 영상진단 맥락이 제목에 함께 있어야 Vet 분야로 봅니다.
// MRI의 한글·영문 이름과 띄어쓰기 변형을 수집·선별·화면에서 함께 판정합니다.
function isMri(value,includeMr=true){
 const text=String(value||'').normalize('NFKC');
 if(/자기\s*공명|磁気\s*共鳴|(?:^|[^a-z0-9])(?:MRI|magnetic[\s-]+resonance)(?=$|[^a-z0-9])/i.test(text))return true;
 return includeMr&&/(?:^|[^a-z0-9])MR(?=$|[^a-z0-9])/i.test(text);
}
function isVeterinaryImaging(title,context=''){
 const text=String(title||'').normalize('NFKC');
 // '필수의료' 안의 '수의'는 수의학 맥락이 아닙니다. 실제 동물·수의 표현은 따로 판정합니다.
 const veterinary=/(?<!필)수의(?!\s*계약)|동물|반려견|반려묘|강아지|고양이|(?:^|[^a-z0-9])(?:veterinary|veterinarian|vet|animal|canine|feline)(?=$|[^a-z0-9])/i.test(text);
 const imaging=/수의\s*영상|초음파|영상\s*(?:진단|판독|분석|검사|의학|장비)|진단\s*영상|엑스(?:레이|선)|방사선\s*(?:촬영|검사|진단)|자기공명|컴퓨터단층|전산화단층|(?:^|[^a-z0-9])(?:CT|MRI?|CBCT|PET|XR|x[- ]?ray|x[- ]?선|ultrasound|radiology|radiography)(?=$|[^a-z0-9])/i;
 const hasImaging=function(value){return isMri(value)||imaging.test(value);};
 if(veterinary&&hasImaging(text))return true;
 const lead=String(context||'').normalize('NFKC').slice(0,600);
 // 제목에서 빠진 정보는 실제 장비 도입·운영을 설명하는 첫 부분으로만 보완합니다.
 if(/예를\s*들|예컨대|비교하면|비교할\s*때/.test(lead))return false;
 const institution=/동물\s*(?:병원|의료\s*센터|메디[컬칼]\s*센터)|수의(?:대|과대학)/i.test(lead);
 const adoption=/도입|설치|교체|증설|확충|가동|운영|보유|장비/.test(text+' '+lead);
 return (hasImaging(text)||hasImaging(lead))&&adoption&&(veterinary||institution);
}
function compareNewest(a,b){
 return b.date.localeCompare(a.date)||String(b.saved_at||'').localeCompare(String(a.saved_at||''))||Number(b.id||0)-Number(a.id||0);
}
// 같은 소식 묶기: 제목을 두 글자씩 잘라(예: "캐논메디칼" → 캐논, 논메, 메디 …) 겹치는 비율을 봅니다.
function titlePieces(title){
 const text=title.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();
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
 // 화면 정렬(관련도·중요 표시)과 관계없이 최신 기사를 대표로 선택합니다.
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

// 월간 표와 AI는 기회·위협을 선택한 중요 기사만 같은 중복 제거 기준으로 사용합니다.
function monthlyArticles(rows,since,until){
 const urls=new Set();
 const eligible=rows.filter(function(a){return a.starred&&!a.hidden&&a.category!=='hospital'&&isDesignatedArticle(a)&&a.date>=since&&a.date<=until;}).slice().sort(compareNewest)
  .filter(function(a){if(urls.has(a.url))return false;urls.add(a.url);return true;});
 return groupSameNews(eligible).flatMap(function(group){
  const members=[group.main,...group.others].sort(compareNewest);
  const chosen=members.find(function(a){return ['기회','위협'].includes(a.impact_override);});
  return chosen?[{...chosen,duplicate_count:members.length}]:[];
 }).sort(compareNewest);
}
root.NewsRules=Object.freeze({compareNewest,titlePieces,similarity,groupSameNews,monthlyArticles,isMri,isVeterinaryImaging,isDomesticMedia,companyLabel,designatedCompany,isDesignatedArticle,newsRegion});
})(globalThis);
