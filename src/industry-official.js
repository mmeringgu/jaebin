// MFDS public records, independent of news articles and the article database.
export const MFDS_ORIGIN='https://emedi.mfds.go.kr';
export const APPROVAL_SOURCE=MFDS_ORIGIN+'/search/data/MNU20237';
export const RECALL_SOURCE=MFDS_ORIGIN+'/recall/MNU20265';
export const DEVICE_COMPANIES=Object.freeze({
 GE:['지이헬스케어코리아','한국지이초음파'], Siemens:['지멘스헬시니어스'],
 Philips:['필립스코리아'], 'Samsung Medison':['삼성메디슨']
});
const TTL=6*3600000,MAX_PAGES=15;
const memory=new Map(),pending=new Map();
export function legalName(value){return String(value||'').normalize('NFKC').replace(/주식회사|유한회사|\(주\)|\(유\)|\s+/g,'').toLowerCase();}
function ownedBy(name,company){return DEVICE_COMPANIES[company]?.some(alias=>legalName(alias)===legalName(name));}
function decode(value){return String(value||'').replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code<=0x10ffff?String.fromCodePoint(code):'';}).replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g,m=>({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '}[m]));}
const textOf=value=>decode(String(value||'').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
export function equipmentFamily(code,name=''){
 const clean=String(code||'').trim().toUpperCase(),item=String(name).replace(/\s+/g,'');
 if(clean){
  if(/^A11010\.(?:01|02|04|05)$/.test(clean))return 'CT';
  if(/^A12010\.(?:0[1-9]|1[0-2])$/.test(clean))return 'MRI';
  if(/^A11090\.0[1-4]$/.test(clean))return 'Angiography';
  if(/^A26380(?:\.0[1-8])?$/.test(clean))return '초음파';
  return '';
 }
 // Recall list pages expose official item names rather than classification codes.
 if(/프로브|소프트웨어|양전자|단일광자|치과|조영제/.test(item))return '';
 if(/자기공명전산화단층촬영장치/.test(item))return 'MRI';
 if(/전산화단층엑스선촬영장치/.test(item))return 'CT';
 if(/순환기용엑스선투시진단장치/.test(item))return 'Angiography';
 if(/초음파영상진단장치/.test(item))return '초음파';
 return '';
}
function validDate(value){
 const s=String(value||'').replace(/-/g,'');if(!/^\d{8}$/.test(s))return '';
 const iso=s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6),date=new Date(iso+'T00:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===iso?iso:'';
}
export function parseApprovalsPage(html){
 const marker=/\bvar\s+excelItemList\s*=\s*/.exec(html);
 const count=/id\s*=\s*["']totSearchCnt["'][^>]*value\s*=\s*["']([\d,]+)/.exec(html);
 if(!marker||!count)throw new Error('식약처 인허가 조회 형식이 변경되었습니다.');
 let depth=0,quoted=false,escape=false,end=-1,start=marker.index+marker[0].length;
 if(html[start]!=='[')throw new Error('식약처 인허가 목록을 확인하지 못했습니다.');
 for(let i=start;i<html.length;i++){
  const c=html[i];if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;continue;}
  if(c==='"')quoted=true;else if(c==='[')depth++;else if(c===']'&&!--depth){end=i+1;break;}
 }
 if(end<0)throw new Error('식약처 인허가 응답이 불완전합니다.');
 const rows=JSON.parse(html.slice(start,end));if(!Array.isArray(rows))throw new Error('인허가 목록 형식 오류');
 return {rows,total:Number(count[1].replace(/,/g,''))};
}
export function normalizeApproval(row,company){
 const family=equipmentFamily(row.MD_CLSF_NO,row.ITEM_NAME),date=validDate(row.PRDL_PRM_DT);
 if(!ownedBy(row.ENTP_NAME,company)||!family||!date||!row.ITEM_NO_FULLNAME||!row.MEDDEV_ITEM_SEQ)return null;
 if(row.ITEM_STATE!=='정상'||row.CANCEL_YN==='Y'||row.RTRCN_WDRW_DT||row.XPRTPP_YN==='Y')return null;
 const url=new URL(APPROVAL_SOURCE);url.searchParams.set('itemNoFullname',String(row.ITEM_NO_FULLNAME).replace(/\s+/g,''));
 return {id:String(row.MEDDEV_ITEM_SEQ),company,family,item_name:String(row.ITEM_NAME||''),
  model:String(row.TYPE_NAME||''),permit:String(row.ITEM_NO_FULLNAME),date,status:'정상',url:url.href};
}
export function parseRecallPage(html,company){
 const count=/총\s*<b[^>]*>([\d,]+)<\/b>/.exec(html);
 if(!count||!/<tbody\b/i.test(html))throw new Error('식약처 회수 조회 형식이 변경되었습니다.');
 const rows=[],rawIds=[];
 for(const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells=Array.from(match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi),m=>textOf(m[1]));
  if(cells.length!==7||!validDate(cells[6]))continue;
  const href=/href\s*=\s*["']([^"']*deptReceiptNo=[^"']*)["']/.exec(match[1]);if(!href)continue;
  const url=new URL(decode(href[1]),MFDS_ORIGIN);if(url.origin!==MFDS_ORIGIN||url.pathname!=='/recall/view/MNU20265')continue;
  const id=url.searchParams.get('deptReceiptNo');if(!/^\d+$/.test(id||''))continue;
  rawIds.push(id);
  const family=equipmentFamily('',cells[2]);
  if(!ownedBy(cells[1],company)||!family||cells[5]!=='진행중')continue;
  // Retain the source notice identifier: the same permit can have several distinct recalls.
  const link=new URL('/recall/view/MNU20265',MFDS_ORIGIN);link.searchParams.set('deptReceiptNo',id);
  rows.push({id,company,family,item_name:cells[2],permit:cells[3],action:cells[4],status:cells[5],date:cells[6],url:link.href});
 }
 const total=Number(count[1].replace(/,/g,''));
 if(total>0&&!rawIds.length)throw new Error('식약처 회수 목록을 읽지 못했습니다.');
 return {rows,rawIds,total};
}
async function post(path,params,referer){
 const response=await fetch(MFDS_ORIGIN+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Referer':referer,'User-Agent':'SMDNewsClipping/1.0'},body:new URLSearchParams(params).toString(),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('식약처 공식자료 조회에 실패했습니다.');
 const html=await response.text();if(html.length>4000000)throw new Error('식약처 응답 크기를 확인해 주세요.');return html;
}
function kstDay(now){return new Date(now+9*3600000).toISOString().slice(0,10);}
async function collect(kind,company,now){
 const today=kstDay(now),since=kstDay(now-364*86400000),records=[],keys=new Set();let partial=false;
 const searches=DEVICE_COMPANIES[company].flatMap(name=>kind==='approvals'?[{name,item:''}]:['전산화','초음파','순환기'].map(item=>({name,item})));
 for(const {name,item} of searches){
  let sourceTotal=0;const sourceIds=new Set();
  const pageLimit=kind==='recalls'?7:MAX_PAGES;
  for(let page=1;page<=pageLimit;page++){
   const params=kind==='approvals'?{chkList:'1',chkGroup:'GROUP_BY_FIELD_01',pageNum:String(page),nowPageNum:String(page),tabGubun:'1',searchYn:page===1?'true':'',searchOn:'Y',grade:'0',indtyCd:'1|2|21|22',entpName:name,prdlPrmDtFrom:since,prdlPrmDtTo:today}:
    {mid:'MNU20265',pageNum:String(page),searchYn:page===1?'true':'',entpName:name,itemName:item};
   const html=await post(kind==='approvals'?'/search/data/list':'/recall/list/MNU20265',params,kind==='approvals'?APPROVAL_SOURCE:RECALL_SOURCE);
   const parsed=kind==='approvals'?parseApprovalsPage(html):parseRecallPage(html,company);
   const rawIds=kind==='approvals'?parsed.rows.map(row=>String(row.DOCID||row.MEDDEV_ITEM_SEQ||row.ITEM_NO_FULLNAME)):parsed.rawIds;
   sourceTotal=parsed.total;
   if(sourceTotal>0&&!rawIds.length)throw new Error('식약처 목록이 불완전합니다.');
   let fresh=0;for(const id of rawIds){if(!sourceIds.has(id)){sourceIds.add(id);fresh++;}}
   const normalized=kind==='approvals'?parsed.rows.map(row=>normalizeApproval(row,company)).filter(Boolean):parsed.rows;
   for(const row of normalized){
    if(kind==='approvals'&&(row.date<since||row.date>today))continue;
    const key=kind==='approvals'?row.company+'|'+row.permit.replace(/\s+/g,'')+'|'+row.family:row.id;
    if(!keys.has(key)){keys.add(key);records.push(row);}
   }
   if(sourceIds.size>=sourceTotal)break;
   if(!fresh||page===pageLimit){partial=true;break;}
  }
 }
 records.sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));
 return {kind,company,records,partial,source:'식품의약품안전처',source_url:kind==='approvals'?APPROVAL_SOURCE:RECALL_SOURCE,
  fetched_at:new Date(now).toISOString(),since:kind==='approvals'?since:null,until:today,stale:false};
}
export async function officialIndustry(kind,company,now=Date.now()){
 if(!['recalls','approvals'].includes(kind)||!Object.hasOwn(DEVICE_COMPANIES,company)){
  const error=new Error('조회할 자료와 회사를 확인해 주세요.');error.status=400;throw error;
 }
 const id=kind+'|'+company,key=new Request('https://industry-cache.local/v1/'+kind+'/'+encodeURIComponent(company));
 const cached=memory.get(id);if(cached&&now-cached.at<TTL)return cached.data;
 if(pending.has(id))return pending.get(id);
 const work=(async()=>{
  let previous=cached?.data;
  try{
   const hit=await globalThis.caches?.default?.match(key);
   if(hit){previous=await hit.json();const at=Date.parse(previous.fetched_at);if(now-at<TTL){memory.set(id,{at,data:previous});return previous;}}
  }catch{/* A cache failure does not prevent a source lookup. */}
  try{
   const data=await collect(kind,company,now);memory.set(id,{at:now,data});
   try{await globalThis.caches?.default?.put(key,new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json','Cache-Control':'public,max-age=604800'}}));}catch{}
   return data;
  }catch(error){
   if(previous)return {...previous,stale:true};
   const unavailable=new Error(error.message);unavailable.status=503;throw unavailable;
  }
 })();pending.set(id,work);try{return await work;}finally{pending.delete(id);}
}

// Enrich visible notices only; a notice may cover several item permits and models.
export async function officialRecallDetail(id,permit,now=Date.now()){
 if(!/^\d{8,20}$/.test(id||'')||!permit||permit.length>80){const error=new Error('회수 공지와 허가번호를 확인해 주세요.');error.status=400;throw error;}
 const key='recall-detail|'+id+'|'+permit.replace(/\s+/g,''),cached=memory.get(key);
 if(cached&&now-cached.at<TTL)return cached.data;if(pending.has(key))return pending.get(key);
 const work=(async()=>{
  const url=new URL('/recall/view/MNU20265',MFDS_ORIGIN);url.searchParams.set('deptReceiptNo',id);
  const response=await fetch(url,{headers:{Accept:'text/html'},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('회수 상세자료 조회 실패');
  const html=await response.text();if(html.length>4000000)throw new Error('회수 상세자료 크기 초과');
  let itemSeq='';
  for(const tr of html.matchAll(/<tr\b[^>]*recallSeq=["'](\d+)["'][^>]*>([\s\S]*?)<\/tr>/gi)){
   if(textOf(tr[2]).replace(/\s+/g,'').includes(permit.replace(/\s+/g,''))){itemSeq=tr[1];break;}
  }
  if(!itemSeq)throw new Error('회수 대상 품목을 확인하지 못했습니다.');
  const modelURL=new URL('/recall/view/model',MFDS_ORIGIN);modelURL.search=new URLSearchParams({deptReceiptNo:id,recallItemSeq:itemSeq}).toString();
  const modelResponse=await fetch(modelURL,{headers:{Accept:'application/json','X-Requested-With':'XMLHttpRequest',Referer:url.href},signal:AbortSignal.timeout(15000)});
  if(!modelResponse.ok)throw new Error('회수 모델 조회 실패');
  const body=await modelResponse.json();if(!Array.isArray(body.recallModel))throw new Error('회수 모델 응답 형식 오류');
  const models=[...new Set(body.recallModel.filter(r=>String(r.deptReceiptNo)===id&&String(r.recallItemSeq)===itemSeq).map(r=>String(r.typeName||'').trim()).filter(Boolean))];
  const reason=/<th\b[^>]*>\s*회수사유\s*<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/i.exec(html);
  const data={id,model:models[0]?(models[0]+(models.length>1?' 외 '+(models.length-1)+'종':'')):'',reason:reason?textOf(reason[1]).slice(0,1500):'',url:url.href,fetched_at:new Date(now).toISOString()};
  memory.set(key,{at:now,data});return data;
 })();pending.set(key,work);try{return await work;}finally{pending.delete(key);}
}
