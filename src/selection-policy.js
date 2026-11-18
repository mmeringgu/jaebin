// 뉴스·통계·내보내기·리포트에서 함께 사용하는 업무 관련성 기준입니다.
import { keywordMatch, selectionLevel, hasWord } from "./rules.js";

const imaging = (text) => globalThis.NewsRules.isMri(text) || /영상\s*(?:의학|진단|판독|분석|검사|장비|센터)|의료영상|초음파|핵의학|조영술|엑스(?:레이|선)|자기공명|컴퓨터단층|전산화단층|画像診断|超音波|磁気共鳴|(?:^|[^a-z0-9])(?:CT|MRI?|PET|CBCT|Angio|X[- ]?ray|ultrasound|radiology|angiography|diagnostic imaging)(?=$|[^a-z0-9])/i.test(text);
const medical = (text) => imaging(text) || /의료|메디칼|메디컬|헬스케어|헬시니어스|병원|의학|호흡기|인공호흡|환자감시|医療|メディカル|医用|病院|medical|health\s*care|healthineers|clinical/i.test(text);
const policyChange = /인하|인상|개편|개정|개선|조정|지원|보상|예산|재정|투입|지정|전환|육성|설치|기준|허가|인증|법안|법률|규제|시행|적용|신설|제도|수가|급여|상대가치|환산지수/;
const hospitalChange = /개원|개소|증설|증축|신축|착공|준공|확충|확장\s*(?:이전|개소)|부채|적자|흑자|구조조정|투자|인수|(?<!종)합병(?!원)/;
const deviceChange = /도입|구매|설치|가동|개발|연구|임상|협력|협약|인증|지침|학술|학회|심포지엄|취임|선임|임명|회장/;
const names = { company: "캐논 뉴스", competitor: "경쟁사", policy: "정책", hospital: "병원·학회" };

export function assessArticle(title, source, excerpt = {}) {
  title = String(title || "").normalize("NFKC");
  const groups = keywordMatch(title, source, excerpt);
  const reject = (reason) => ({ selected: false, level: selectionLevel(groups), groups, reasons: [reason] });
  if (!groups.length) return reject("제목의 유효한 수집 키워드·정보원 조건과 일치하지 않습니다.");
  if (/채용|면접|기출문제|자기소개서|취업|경력직|구인|求人|recruitment|job vacancy/i.test(title)) return reject("채용·취업 준비 콘텐츠입니다.");
  if (/\[(?:부고|부음|동정|신간)\]|김장|헌혈|기부자|기부|후원|모금|기념음악회|갤러리|표창|수상|워크숍|수료식|수료…|아카데미|Academy/i.test(title)) return reject("일반 행사·기부·인사·교육·수상 소식입니다.");
  if (/주가|주식시장|상승\s*마감|하락\s*마감|강세\s*마감|약세\s*마감/.test(title)) return reject("주가 등락 중심 기사입니다.");

  const category = groups[0].category;
  const lead = [excerpt.subtitle, excerpt.first_paragraph].filter(Boolean).join(" ").slice(0, 1600);
  const titleImaging = imaging(title);
  // 제목의 주요 사업·기술 소식을 설명하는 첫 문장만 보완 근거로 사용합니다.
  // 본문 뒤에서 CT·MRI를 비교 사례로 언급하는 것은 선별 근거가 아닙니다.
  const firstSentence = lead.split(/(?<=[.!?。])\s+|\n/)[0] || "";
  const leadImaging = !/예를\s*들|예컨대|달리|처럼|비교하면|비교할\s*때/.test(firstSentence) && imaging(firstSentence);
  const titleMedical = medical(title);
  let reason = "";

  if (category === "company" || category === "competitor") {
    if (/산업용|산업재|자동화|전력기기|반도체|ASML|카메라|프린터|화장품|기미|에어로스페이스|항공|데이터센터/i.test(title) && !/의료기기|의료사업|의료 사업|헬시니어스|healthineers/i.test(title) && !titleImaging) return reject("의료 사업과 관계없는 산업·소비재 기사입니다.");
    const medicalName = groups.some((g) => (g.exact_names || []).some((word) => hasWord(title, word)))
      || groups.some((g) => g.id === "K001") || source.kind === "canon_official"
      || (source.kind === "competitor_official" && ["ge", "siemens", "philips"].includes(source.official_variant));
    if (source.kind === "competitor_official" && source.official_variant === "philips"
      && /toothbrush|shaver|grooming|hair\s*care|coffee|kitchen|air\s*purifier|sonicare|consumer\s*(?:care|products)|personal\s*health/i.test(title)
      && !titleImaging) return reject("의료 사업과 관계없는 필립스 소비재 기사입니다.");
    const businessSubject = /사업|자회사|분사|분리|인수|합병|실적|매출|영업이익|공급|출시|제품|허가|조직|대표|책임자|협력|협약|투자|생산|공장|개발|business|launch|supply|approval|research|partnership|発売|供給|承認|開発|導入/i.test(title);
    if (!medicalName && !titleMedical && !(businessSubject && medical(firstSentence))) return reject("회사명 외에 의료 사업과 연결되는 근거가 부족합니다.");
    reason = "의료 사업의 제품·공급·투자·조직·실적 또는 관련 활동";
  } else if (category === "policy") {
    if (/의약품|약제|신약|치료제|임신중지약|비만주사|GLP.?1/i.test(title) && !titleImaging && !/의료기기|디지털의료/.test(title)) return reject("영상의료·의료기기와 관계없는 개별 의약품·급여 기사입니다.");
    const corePolicy = /검사\s*수가|검체검사|수가\s*(?:체계|개편)|상대가치|환산지수|관리급여|비급여\s*(?:관리|법|항목)|특수의료장비|병상공동활용|공동활용병상|상급종합병원/.test(title);
    const systemPolicy = /필수의료|국립대병원|국립대학교병원|의료전달체계|의료\s*전달체계/.test(title) && policyChange.test(title);
    const devicePolicy = /의료기기법|디지털의료제품법|신의료기술평가|의료기기\s*(?:허가|인증)|혁신의료기술/.test(title);
    const imagingTechnology = titleImaging && /AI|인공지능/i.test(title) && /솔루션|장비|제품|기술/.test(title) && /개발|공급|도입|임상|허가/.test(title);
    if (!(corePolicy && policyChange.test(title)) && !systemPolicy && !devicePolicy && !imagingTechnology && !(titleImaging && policyChange.test(title)) && !(leadImaging && /검사|진단|판독|의료기기|영상|수가|급여|규제/.test(title) && policyChange.test(title))) return reject("영상의료 제도·검사 수가·병원 지정 등 핵심 정책 변화와 관련성이 부족합니다.");
    if (/다짐|기념|홍보|유공|표창/.test(title)) return reject("정책 변화보다 기관 홍보·행사에 해당합니다.");
    reason = imagingTechnology ? "의료영상 AI 기술의 개발·공급·임상 적용" : "영상의료 제도·검사 수가 또는 의료체계·병원 지정 변화";
  } else {
    const vet = globalThis.NewsRules.isVeterinaryImaging(title, lead);
    const genuineOpening = hospitalChange.test(title) && !/개원가|개원의|주년|기념|신설\s*(?:요구|촉구)|수가\s*신설/.test(title);
    const imagingNews = (titleImaging || (leadImaging && /진단|판독|영상|장비|검사/.test(title))) && deviceChange.test(title);
    const institution = /[가-힣A-Za-z0-9]+(?:병원|의료원)|영상\s*센터|의대/.test(title);
    if (!vet && !(genuineOpening && institution) && !imagingNews) return reject("병원명·일반 AI만 일치하며 장비·시설·경영 변화나 영상의료 관련성이 부족합니다.");
    if (/경영/.test(title) && /교육|수료|신간|매니지먼트/.test(title) && !titleImaging) return reject("병원 투자·경영 변화가 아닌 교육·출판 소식입니다.");
    reason = vet ? "수의 영상진단·장비 관련 소식" : genuineOpening ? "병원 시설·투자·경영 변화" : "영상의학·장비·검사·관련 학회 소식";
  }
  return { selected: true, level: selectionLevel(groups), groups, reasons: [names[category] + " · " + reason,
    ...groups.map((g) => g.id + " · " + [...g.mainMatches, ...g.auxiliaryMatches].join(", "))] };
}
