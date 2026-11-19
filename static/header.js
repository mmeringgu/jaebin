(function(){
 const header=document.querySelector('.topbar');if(!header)return;
 const compactAt=4;
 let atTop=window.scrollY<=4,compact=window.scrollY>compactAt,frame=0;
 const page=document.documentElement;
 let anchorTimer=0,previousAnchor,returningUp=false,touchY=null;
 function pauseAnchoring(){
  if(!anchorTimer)previousAnchor=page.style.overflowAnchor;
  page.style.overflowAnchor='none';
  window.clearTimeout(anchorTimer);
  // 배너 높이가 바뀌는 동안만 브라우저의 스크롤 위치 자동 보정을 멈춥니다.
  anchorTimer=window.setTimeout(function(){page.style.overflowAnchor=previousAnchor;anchorTimer=0;},350);
 }
 if(compact)pauseAnchoring();
 header.classList.toggle('is-compact',compact);
 function update(){
  frame=0;
  const nextTop=window.scrollY<=4;
  // 짧은 페이지에서 높이 감소로 스크롤이 0으로 제한된 경우에는 다시 펼치지 않습니다.
  if(nextTop&&compact&&anchorTimer&&!returningUp)return;
  returningUp=false;
  const nextCompact=window.scrollY>compactAt;
  if(nextCompact!==compact){pauseAnchoring();compact=nextCompact;}
  header.classList.toggle('is-compact',compact);
  if(nextTop&&!atTop)window.dispatchEvent(new CustomEvent('header-top'));
  atTop=nextTop;
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(update);}
 function upward(){returningUp=true;if(window.scrollY<=4)schedule();}
 window.addEventListener('scroll',schedule,{passive:true});
 window.addEventListener('wheel',function(event){if(event.deltaY<0)upward();else returningUp=false;},{passive:true});
 window.addEventListener('keydown',function(event){if(['ArrowUp','PageUp','Home'].includes(event.key)||(event.key===' '&&event.shiftKey))upward();});
 window.addEventListener('touchstart',function(event){touchY=event.touches[0]?.clientY??null;},{passive:true});
 window.addEventListener('touchmove',function(event){const y=event.touches[0]?.clientY;if(touchY!==null&&y>touchY)upward();else returningUp=false;touchY=y??null;},{passive:true});
})();
