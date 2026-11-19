(function(){
 const root=document.getElementById('header-weather'),reading=document.getElementById('weather-reading');
 if(!root||!reading)return;
 const labels={sunny:'맑음',cloudy:'구름 많음',overcast:'흐림',windy:'바람',rainy:'비',thunder:'천둥·번개',snowy:'눈',foggy:'안개'};
 root.innerHTML='<div class="smd-landscape" role="img" aria-label="강남구 날씨 확인 중">'+
  '<div class="sky-glow"></div><div class="stars"><i></i><i></i><i></i></div>'+
  '<div class="sun"><div class="sun-rays"></div><div class="sun-disc"><i></i><i></i><b></b></div></div><div class="moon"></div>'+
  '<div class="cloud cloud-back"></div><div class="cloud cloud-front"></div>'+
  '<div class="distant-buildings"><i></i><i></i><i></i><i></i><i></i><i></i></div>'+
  '<div class="hill hill-back"></div><div class="hill hill-front"></div>'+
  '<div class="tree tree-left"><div class="trunk"></div><div class="crown"></div></div><div class="tree tree-right"><div class="trunk"></div><div class="crown"></div></div>'+
  '<div class="bush bush-one"></div><div class="bush bush-two"></div>'+
  '<div class="season-flowers"><i></i><i></i><i></i></div><div class="fallen-leaves"><i></i><i></i><i></i><i></i></div>'+
  '<div class="snowman"><div class="snowman-arm arm-left"></div><div class="snowman-arm arm-right"></div><div class="snowman-body"><i></i><i></i></div><div class="snowman-head"><i></i><i></i><b></b></div><div class="scarf"><i></i></div></div>'+
  '<div class="wind wind-one"></div><div class="wind wind-two"></div><div class="wind wind-three"></div>'+
  '<div class="leaf leaf-one"></div><div class="leaf leaf-two"></div><div class="leaf leaf-three"></div>'+
  '<div class="precipitation" aria-hidden="true"></div><div class="puddle"></div><div class="lightning"></div>'+
  '<div class="fog fog-one"></div><div class="fog fog-two"></div><div class="fog fog-three"></div></div>'+
  '<button type="button" class="weather-pause" aria-label="날씨 애니메이션 일시 정지" aria-pressed="false">Ⅱ</button>';
 const precipitation=root.querySelector('.precipitation'),button=root.querySelector('.weather-pause');
 for(let i=0;i<24;i++){
  const drop=document.createElement('i');drop.className='drop';drop.style.left=(8+(i*17)%84)+'%';drop.style.animationDelay=(-i*.37)+'s';precipitation.append(drop);
 }
 let last=null,lastReceived=0,busy=false,stopTimer=null,manuallyPaused=false;
 const motion=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):null;
 try{manuallyPaused=localStorage.getItem('weather-paused')==='true';}catch{}
 function seasonAt(now){
  const date=new Date(now+9*3600000),month=date.getUTCMonth()+1,day=date.getUTCDate();
  if(month>=3&&month<=5)return 'spring';
  if(month>=6&&month<=8)return 'summer';
  if(month>=9&&(month<=10||month===11&&day<15))return 'autumn';
  return 'winter';
 }
 function updateSeason(){root.dataset.season=seasonAt(Date.now());}
 updateSeason();root.classList.toggle('paused',true);
 function updatePause(){
  const paused=root.classList.contains('paused');button.textContent=paused?'▶':'Ⅱ';button.setAttribute('aria-pressed',String(paused));
  button.setAttribute('aria-label',paused?'날씨 애니메이션 재생':'날씨 애니메이션 일시 정지');
 }
 function pause(){clearTimeout(stopTimer);stopTimer=null;root.classList.toggle('paused',true);updatePause();}
 function play(){
  updateSeason();clearTimeout(stopTimer);
  if(manuallyPaused||motion?.matches){pause();return;}
  root.classList.toggle('paused',false);
  const scene=root.querySelector('.smd-landscape');
  if(scene.getAnimations)scene.getAnimations({subtree:true}).forEach(function(animation){animation.currentTime=0;});
  updatePause();stopTimer=setTimeout(pause,6000);
 }
 button.addEventListener('click',function(){
  manuallyPaused=!root.classList.contains('paused');
  if(manuallyPaused)pause();else play();
  try{localStorage.setItem('weather-paused',String(manuallyPaused));}catch{}
 });
 if(typeof window!=='undefined')window.addEventListener('header-top',function(){if(last)play();});
 motion?.addEventListener('change',function(){if(motion.matches)pause();});
 updatePause();
 function render(data,stale){
  updateSeason();
  root.dataset.weather=data.scene;root.classList.toggle('night',!!data.night);root.classList.toggle('blustery',!!data.windy);
  root.classList.toggle('heavy',!!data.heavy);root.classList.toggle('mixed',!!data.mixed);
  const text='강남구 · '+(data.mixed?'진눈깨비':labels[data.scene])+' '+Math.round(data.temperature)+'°';
  reading.textContent=text+(stale?' · 갱신 지연':'');
  root.querySelector('.smd-landscape').setAttribute('aria-label',text+(data.night?' · 밤':' · 낮'));
  reading.title='강남구 대표 지점 예보 · '+new Date(data.forecast_time).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' · 풍속 '+data.wind+'m/s';
 }
 async function refresh(){
  if(busy)return;busy=true;
  try{
   const response=await fetch('/api/weather',{signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw new Error('weather unavailable');
   const data=await response.json();
   if(!labels[data.scene]||!Number.isFinite(data.temperature)||!Number.isFinite(Date.parse(data.forecast_time)))throw new Error('invalid weather');
   const first=!last;last=data;lastReceived=Date.now();render(data,data.stale);if(first)play();
  }catch{
   if(last&&Date.now()-lastReceived<3*3600000)render(last,true);
   else{root.dataset.weather='unavailable';reading.textContent='강남구 · 날씨 확인 불가';root.querySelector('.smd-landscape').setAttribute('aria-label','날씨 정보를 불러올 수 없습니다.');}
  }finally{busy=false;}
 }
 refresh();
 setInterval(function(){if(!document.hidden)refresh();},20*60*1000);
 document.addEventListener('visibilitychange',function(){if(!document.hidden&&Date.now()-lastReceived>20*60*1000)refresh();});
})();
