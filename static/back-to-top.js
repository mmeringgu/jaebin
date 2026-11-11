// 모든 탭에서 사용하는 맨 위로 이동 버튼입니다.
(function(){
 const button=document.getElementById('back-to-top');
 function update(){button.hidden=window.scrollY<=240;}
 button.addEventListener('click',function(){
  window.scrollTo({top:0,left:0,behavior:'instant'});
  update();
 });
 window.addEventListener('scroll',update,{passive:true});
 window.addEventListener('resize',update);
 window.addEventListener('pageshow',update);
 update();
})();
