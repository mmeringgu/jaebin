(function(){
 const header=document.querySelector('.topbar');if(!header)return;
 let atTop=window.scrollY<=4,compact=window.scrollY>96,frame=0;
 header.classList.toggle('is-compact',compact);
 function update(){
  frame=0;
  const nextTop=window.scrollY<=4;
  // 52〜71px의 높이 변화로 스크롤 위치가 보정돼도 반복 확대되지 않게 여유를 둡니다.
  if(window.scrollY>96)compact=true;else if(nextTop)compact=false;
  header.classList.toggle('is-compact',compact);
  if(nextTop&&!atTop)window.dispatchEvent(new CustomEvent('header-top'));
  atTop=nextTop;
 }
 window.addEventListener('scroll',function(){if(!frame)frame=requestAnimationFrame(update);},{passive:true});
})();
