"use strict";
const $=s=>document.querySelector(s);
const STORAGE="intervalTimer.workouts.v1";
const defaultWorkout={id:crypto.randomUUID(),name:"Tabata",work:20,rest:10,rounds:8,series:1,seriesBreak:60};
let workouts=JSON.parse(localStorage.getItem(STORAGE)||"null")||[defaultWorkout];
let active=null,timer=null,endAt=0,pausedRemaining=0,phase="ready",round=1,series=1;
let swTimer=null,swStart=0,swElapsed=0;
const save=()=>localStorage.setItem(STORAGE,JSON.stringify(workouts));
const fmt=s=>`${String(Math.floor(s/60)).padStart(2,"0")}:${String(Math.floor(s%60)).padStart(2,"0")}`;
const esc=s=>String(s).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
function render(){
  $("#workoutList").innerHTML=workouts.map(w=>`<article class="workout"><div class="workoutTop"><div><h3>${esc(w.name)}</h3><div class="summary">${w.work}s esercizio · ${w.rest}s riposo<br>${w.rounds} round · ${w.series} serie · ${w.seriesBreak}s pausa serie</div></div></div><div class="rowActions"><button class="small startWorkout" data-id="${w.id}">Avvia</button><button class="small edit" data-id="${w.id}">Modifica</button><button class="small delete" data-id="${w.id}">Elimina</button></div></article>`).join("")||"<p>Nessun allenamento salvato.</p>";
}
function openEditor(w){
  $("#editorTitle").textContent=w?"Modifica allenamento":"Nuovo allenamento";
  $("#workoutId").value=w?.id||""; $("#name").value=w?.name||""; $("#work").value=w?.work||30; $("#rest").value=w?.rest??15; $("#rounds").value=w?.rounds||8; $("#series").value=w?.series||1; $("#seriesBreak").value=w?.seriesBreak??60; $("#editorDialog").showModal();
}
$("#workoutForm").addEventListener("submit",e=>{e.preventDefault();const id=$("#workoutId").value||crypto.randomUUID();const w={id,name:$("#name").value.trim(),work:+$("#work").value,rest:+$("#rest").value,rounds:+$("#rounds").value,series:+$("#series").value,seriesBreak:+$("#seriesBreak").value};const i=workouts.findIndex(x=>x.id===id);i<0?workouts.push(w):workouts[i]=w;save();render();$("#editorDialog").close();});
$("#workoutList").addEventListener("click",e=>{const id=e.target.dataset.id;if(!id)return;const w=workouts.find(x=>x.id===id);if(e.target.classList.contains("startWorkout"))startWorkout(w);if(e.target.classList.contains("edit"))openEditor(w);if(e.target.classList.contains("delete")&&confirm(`Eliminare “${w.name}”?`)){workouts=workouts.filter(x=>x.id!==id);save();render();}});
$("#newWorkout").onclick=()=>openEditor(); $("#cancelEditor").onclick=()=>$("#editorDialog").close();
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===b));const sw=b.dataset.tab==="stopwatch";$("#workoutsPanel").hidden=sw;$("#stopwatchPanel").hidden=!sw;});
function startWorkout(w){active=w;phase="ready";round=1;series=1;pausedRemaining=w.work;stopTimer();$("#homeView").classList.remove("active");$("#timerView").classList.add("active");updateTimer();}
function duration(){return phase==="exercise"?active.work:phase==="rest"?active.rest:phase==="break"?active.seriesBreak:active.work}
function setPhase(p){phase=p;pausedRemaining=duration();beep();vibrate();updateTimer();}
function run(){if(phase==="ready"||phase==="finished")setPhase("exercise");endAt=Date.now()+pausedRemaining*1000;timer=setInterval(tick,100);$("#timerStart").textContent="Pausa";tick();}
function pause(){pausedRemaining=Math.max(0,(endAt-Date.now())/1000);stopTimer();updateTimer();}
function stopTimer(){clearInterval(timer);timer=null;$("#timerStart").textContent=phase==="finished"?"Ripeti":"Avvia";}
function tick(){pausedRemaining=Math.max(0,(endAt-Date.now())/1000);if(pausedRemaining<=0){stopTimer();advance();}updateTimer();}
function advance(){if(phase==="exercise"){if(round<active.rounds)setPhase("rest");else if(series<active.series)setPhase("break");else{phase="finished";pausedRemaining=0;beep(880,.35);vibrate([150,80,250]);updateTimer();return}}else if(phase==="rest"){round++;setPhase("exercise")}else if(phase==="break"){series++;round=1;setPhase("exercise")}if(phase!=="finished")run();}
function updateTimer(){if(!active)return;const names={ready:"PRONTO",exercise:"ESERCIZIO",rest:"RIPOSO",break:"PAUSA TRA LE SERIE",finished:"COMPLETATO"};const colors={ready:"#20d65a",exercise:"#20d65a",rest:"#ff3b30",break:"#168fff",finished:"#20d65a"};$("#timerName").textContent=active.name;$("#phaseText").textContent=names[phase];$("#phaseText").className=`phase ${phase}`;$("#timerTime").textContent=fmt(Math.ceil(pausedRemaining));const total=Math.max(duration(),1);$("#ring").style.setProperty("--progress",Math.min(1,pausedRemaining/total));$("#ring").style.setProperty("--phaseColor",colors[phase]);$("#counter").textContent=`Serie ${series}/${active.series} · Round ${round}/${active.rounds}`;}
function resetTimer(){stopTimer();phase="ready";round=1;series=1;pausedRemaining=active.work;updateTimer();}
$("#timerStart").onclick=()=>timer?pause():run(); $("#timerReset").onclick=resetTimer; $("#backHome").onclick=()=>{stopTimer();$("#timerView").classList.remove("active");$("#homeView").classList.add("active")};
function beep(freq=660,len=.12){try{const C=window.AudioContext||window.webkitAudioContext;const c=new C(),o=c.createOscillator(),g=c.createGain();o.frequency.value=freq;o.connect(g);g.connect(c.destination);g.gain.setValueAtTime(.12,c.currentTime);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+len);o.start();o.stop(c.currentTime+len)}catch{}}
function vibrate(pattern=100){navigator.vibrate?.(pattern)}
function swRender(){const t=swTimer?Date.now()-swStart+swElapsed:swElapsed;const m=Math.floor(t/60000),s=Math.floor(t/1000)%60,h=Math.floor(t/10)%100;$("#stopwatchTime").textContent=`${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(h).padStart(2,"0")}`}
$("#stopwatchStart").onclick=()=>{if(swTimer){swElapsed+=Date.now()-swStart;clearInterval(swTimer);swTimer=null;$("#stopwatchStart").textContent="Avvia"}else{swStart=Date.now();swTimer=setInterval(swRender,37);$("#stopwatchStart").textContent="Pausa"}swRender()};
$("#stopwatchReset").onclick=()=>{clearInterval(swTimer);swTimer=null;swElapsed=0;$("#stopwatchStart").textContent="Avvia";swRender()};
$("#installHelp").onclick=()=>$("#helpDialog").showModal();$("#closeHelp").onclick=()=>$("#helpDialog").close();
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
render(); swRender();
