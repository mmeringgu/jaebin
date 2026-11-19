(function(){
 const header=document.querySelector('.topbar');if(!header)return;
 const compactAt=160;
 let atTop=window.scrollY<=4,compact=window.scrollY>compactAt,frame=0;
 header.classList.toggle('is-compact',compact);
 function update(){
  frame=0;
  const nextTop=window.scrollY<=4;
  // 배너가 108px 줄어들어 스크롤 위치가 보정돼도 최상단으로 돌아가지 않도록 여유를 둡니다.
  if(window.scrollY>compactAt)compact=true;else if(nextTop)compact=false;
  header.classList.toggle('is-compact',compact);
  if(nextTop&&!atTop)window.dispatchEvent(new CustomEvent('header-top'));
  atTop=nextTop;
 }
 window.addEventListener('scroll',function(){if(!frame)frame=requestAnimationFrame(update);},{passive:true});
})();
