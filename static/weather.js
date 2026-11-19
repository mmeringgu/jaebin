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
 let last=null,lastReceived=0,busy=false;
 try{root.classList.toggle('paused',localStorage.getItem('weather-paused')==='true');}catch{}
 function updatePause(){
  const paused=root.classList.contains('paused');button.textContent=paused?'▶':'Ⅱ';button.setAttribute('aria-pressed',String(paused));
  button.setAttribute('aria-label',paused?'날씨 애니메이션 재생':'날씨 애니메이션 일시 정지');
 }
 button.addEventListener('click',function(){root.classList.toggle('paused');updatePause();try{localStorage.setItem('weather-paused',String(root.classList.contains('paused')));}catch{}});
 updatePause();
 function render(data,stale){
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
   last=data;lastReceived=Date.now();render(data,data.stale);
  }catch{
   if(last&&Date.now()-lastReceived<3*3600000)render(last,true);
   else{root.dataset.weather='unavailable';reading.textContent='강남구 · 날씨 확인 불가';root.querySelector('.smd-landscape').setAttribute('aria-label','날씨 정보를 불러올 수 없습니다.');}
  }finally{busy=false;}
 }
 refresh();
 setInterval(function(){if(!document.hidden)refresh();},20*60*1000);
 document.addEventListener('visibilitychange',function(){if(!document.hidden&&Date.now()-lastReceived>20*60*1000)refresh();});
})();
