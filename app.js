'use strict';

const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = 'it.workouts.v7';
const LEGACY_KEYS = ['it.workouts.v6', 'it.workouts.v5', 'it.workouts.v3'];
const DEFAULT_WORKOUT = {name:'Tabata',prep:10,work:20,rest:10,rounds:8,series:1,brk:60,sound:'gym',volume:0.72,voice:false};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const numberFields = ['prep','work','rest','rounds','series','brk'];

function readWorkouts(){
  let raw = localStorage.getItem(STORAGE_KEY);
  if(!raw){
    for(const key of LEGACY_KEYS){ raw = localStorage.getItem(key); if(raw) break; }
  }
  try{
    const parsed = raw ? JSON.parse(raw) : null;
    if(Array.isArray(parsed) && parsed.length){
      return parsed.map(w => ({...DEFAULT_WORKOUT,...w,id:w.id||uid(),voice:w.voice===true,volume:Number(w.volume)||0.72}));
    }
  }catch(error){ console.warn('Impossibile leggere gli allenamenti salvati', error); }
  return [{...DEFAULT_WORKOUT,id:uid()}];
}

let workouts = readWorkouts();
let active = null;
let phase = 'ready';
let round = 1;
let series = 1;
let secondsLeft = 0;
let phaseEnd = 0;
let timerId = null;
let wakeLock = null;
let audioContext = null;
let masterGain = null;
let compressor = null;
let announced = new Set();
let started = false;
let voiceTimeouts = [];
let stopwatchId = null;
let stopwatchElapsed = 0;
let stopwatchStartedAt = 0;

const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(workouts));
const formatTime = (value) => {
  const n = Math.max(0, Math.ceil(Number(value)||0));
  const hours = Math.floor(n/3600);
  const minutes = Math.floor((n%3600)/60);
  const seconds = n%60;
  return hours ? `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}` : `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
};
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function totalDuration(w){
  return w.prep + (w.work*w.rounds*w.series) + (w.rest*Math.max(0,w.rounds-1)*w.series) + (w.brk*Math.max(0,w.series-1));
}

function render(){
  if(!workouts.length){ $('#list').innerHTML='<div class="empty">Nessun allenamento salvato.</div>'; return; }
  $('#list').innerHTML = workouts.map(w => `
    <article class="card">
      <div class="card-title">${escapeHtml(w.name)}</div>
      <small>${w.prep}s preparazione · ${w.work}s allenamento · ${w.rest}s riposo<br>${w.rounds} round · ${w.series} serie · ${w.brk}s tra serie · Totale ${formatTime(totalDuration(w))}<br>Suono: ${escapeHtml(soundLabel(w.sound))} (${volumeLabel(w.volume)}) · Voce: ${w.voice?'attiva':'disattiva'}</small>
      <div class="row"><button class="green play" data-id="${escapeHtml(w.id)}">Avvia</button><button class="edit" data-id="${escapeHtml(w.id)}">Modifica</button><button class="danger del" data-id="${escapeHtml(w.id)}">Elimina</button></div>
    </article>`).join('');
}

function soundLabel(key){ return ({gym:'Gym Buzzer',electronic:'Electronic Beep',horn:'Air Horn',military:'Military Timer',industrial:'Industrial Alarm'})[key] || 'Gym Buzzer'; }
function volumeLabel(value){ const n=Number(value); return n>=.95?'massimo':n>=.6?'forte':'medio'; }

function openEditor(workout={}){
  const value = {...DEFAULT_WORKOUT,...workout};
  $('#dialogTitle').textContent = workout.id ? 'Modifica allenamento' : 'Nuovo allenamento';
  $('#id').value = workout.id || '';
  $('#name').value = workout.name || '';
  for(const key of numberFields) $('#'+key).value = value[key];
  $('#sound').value = value.sound;
  $('#volume').value = String(value.volume);
  if(!$('#volume').value) $('#volume').value='0.72';
  $('#voice').checked = value.voice === true;
  $('#dlg').showModal();
  setTimeout(()=>$('#name').focus(),50);
}

$('#new').addEventListener('click',()=>openEditor());
$('#cancel').addEventListener('click',()=>$('#dlg').close());
$('#dlg').addEventListener('click',event=>{ if(event.target===$('#dlg')) $('#dlg').close(); });
$('#form').addEventListener('submit',event=>{
  event.preventDefault();
  const workout = {
    id: $('#id').value || uid(),
    name: $('#name').value.trim(),
    ...Object.fromEntries(numberFields.map(key=>[key,Number($('#'+key).value)])),
    sound: $('#sound').value,
    volume: Number($('#volume').value),
    voice: $('#voice').checked
  };
  if(!workout.name || workout.work<1 || workout.rounds<1 || workout.series<1) return;
  const index = workouts.findIndex(w=>w.id===workout.id);
  if(index<0) workouts.push(workout); else workouts[index]=workout;
  save(); render(); $('#dlg').close();
});

$('#list').addEventListener('click',event=>{
  const id = event.target.dataset.id;
  if(!id) return;
  const workout = workouts.find(w=>w.id===id);
  if(!workout) return;
  if(event.target.classList.contains('play')) openTimer(workout);
  if(event.target.classList.contains('edit')) openEditor(workout);
  if(event.target.classList.contains('del') && confirm(`Eliminare “${workout.name}”?`)){
    workouts = workouts.filter(w=>w.id!==id); save(); render();
  }
});

function ensureAudio(){
  if(!audioContext){
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if(!AudioCtx) return null;
    audioContext = new AudioCtx({latencyHint:'interactive'});
    masterGain = audioContext.createGain();
    compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value=-16; compressor.knee.value=12; compressor.ratio.value=5; compressor.attack.value=.003; compressor.release.value=.18;
    masterGain.connect(compressor).connect(audioContext.destination);
  }
  if(audioContext.state==='suspended') audioContext.resume();
  masterGain.gain.setTargetAtTime(Number(active?.volume || $('#volume')?.value || .72),audioContext.currentTime,.01);
  return audioContext;
}

function tone(frequency,start,duration,type='sine',gain=.7,endFrequency=null){
  const context=ensureAudio(); if(!context) return;
  const oscillator=context.createOscillator(); const envelope=context.createGain(); const at=context.currentTime+start;
  oscillator.type=type; oscillator.frequency.setValueAtTime(frequency,at);
  if(endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency,at+duration);
  envelope.gain.setValueAtTime(.0001,at); envelope.gain.exponentialRampToValueAtTime(Math.max(.001,gain),at+.008); envelope.gain.exponentialRampToValueAtTime(.0001,at+duration);
  oscillator.connect(envelope).connect(masterGain); oscillator.start(at); oscillator.stop(at+duration+.03);
}

function playSound(key){
  key = key || active?.sound || $('#sound')?.value || 'gym'; ensureAudio();
  if(key==='gym'){
    tone(165,0,.18,'square',.9,125); tone(110,.19,.38,'square',1,82);
  }else if(key==='electronic'){
    tone(880,0,.12,'sine',.9); tone(1175,.14,.17,'sine',.95); tone(1568,.33,.12,'sine',.8);
  }else if(key==='horn'){
    tone(210,0,.5,'sawtooth',.55,175); tone(264,0,.5,'sawtooth',.45,220); tone(315,.04,.44,'square',.18,270);
  }else if(key==='military'){
    tone(740,0,.09,'square',.75); tone(740,.13,.09,'square',.75); tone(980,.26,.18,'square',.9);
  }else{
    tone(520,0,.13,'sawtooth',.72,430); tone(390,.15,.13,'sawtooth',.78,320); tone(245,.31,.32,'sawtooth',.9,180);
  }
  if(navigator.vibrate) navigator.vibrate([50]);
}

$('#previewSound').addEventListener('click',()=>{
  active = {...DEFAULT_WORKOUT,sound:$('#sound').value,volume:Number($('#volume').value)};
  playSound(active.sound); active=null;
});

function clearVoice(){
  for(const timeout of voiceTimeouts) clearTimeout(timeout); voiceTimeouts=[];
  if('speechSynthesis' in window) speechSynthesis.cancel();
}
function speak(text,delay=0){
  if(!active?.voice || !('speechSynthesis' in window)) return;
  const timeout=setTimeout(()=>{
    const utterance=new SpeechSynthesisUtterance(text); utterance.lang='it-IT'; utterance.rate=.95; utterance.volume=.85; speechSynthesis.speak(utterance);
  },delay);
  voiceTimeouts.push(timeout);
}

async function keepAwake(){
  if(!('wakeLock' in navigator)){ $('#wake').textContent='Schermo sempre acceso non disponibile'; $('#wake').style.color='#ffb02e'; return; }
  try{
    if(!wakeLock) wakeLock=await navigator.wakeLock.request('screen');
    $('#wake').textContent='Schermo sempre acceso'; $('#wake').style.color='#20d65a';
    wakeLock.addEventListener('release',()=>{wakeLock=null;});
  }catch(error){ $('#wake').textContent='Schermo sempre acceso non disponibile'; $('#wake').style.color='#ffb02e'; }
}
async function releaseWakeLock(){ try{await wakeLock?.release();}catch{} wakeLock=null; }

function phaseDuration(value=phase){
  if(value==='prepare') return active.prep;
  if(value==='exercise') return active.work;
  if(value==='rest') return active.rest;
  if(value==='break') return active.brk;
  return 0;
}
function setPhase(value){ phase=value; secondsLeft=phaseDuration(); announced.clear(); draw(); }

function openTimer(workout){
  active=workout; phase=workout.prep>0?'prepare':'exercise'; round=1; series=1; secondsLeft=phaseDuration(); started=false; announced.clear();
  $('#home').classList.remove('active'); $('#timer').classList.add('active'); $('#go').textContent='Avvia'; $('#wake').textContent='Schermo attivo: da avviare'; $('#wake').style.color=''; draw();
}

function run(){
  ensureAudio(); keepAwake();
  if(!started){
    started=true;
    if(phase==='exercise'){playSound();speak('Go',250);} else if(phase==='prepare') speak('Prepara');
  }
  phaseEnd=Date.now()+secondsLeft*1000;
  clearInterval(timerId); timerId=setInterval(tick,100); $('#go').textContent='Pausa';
}

function tick(){
  secondsLeft=Math.max(0,(phaseEnd-Date.now())/1000);
  const whole=Math.ceil(secondsLeft);
  if(active.voice && whole>=1 && whole<=3 && !announced.has(whole)){ announced.add(whole); speak(String(whole)); }
  if(secondsLeft<=0){ clearInterval(timerId); timerId=null; advancePhase(); }
  draw();
}

function continueAutomatically(){ setTimeout(()=>{ if($('#timer').classList.contains('active')) run(); },180); }
function advancePhase(){
  if(phase==='prepare'){
    setPhase('exercise'); playSound(); speak('Go',250); continueAutomatically(); return;
  }
  if(phase==='exercise'){
    playSound(); speak('Stop',250);
    if(round<active.rounds){
      if(active.rest>0){ setPhase('rest'); continueAutomatically(); }
      else { round++; setPhase('exercise'); playSound(); speak('Go',250); continueAutomatically(); }
      return;
    }
    if(series<active.series){
      if(active.brk>0){ setPhase('break'); speak('Riposo tra serie',650); continueAutomatically(); }
      else { series++; round=1; setPhase('exercise'); playSound(); speak('Go',250); continueAutomatically(); }
      return;
    }
    finishWorkout(); return;
  }
  if(phase==='rest'){
    round++; setPhase('exercise'); playSound(); speak('Go',250); continueAutomatically(); return;
  }
  if(phase==='break'){
    series++; round=1; setPhase('exercise'); playSound(); speak('Go',250); continueAutomatically();
  }
}

function finishWorkout(){
  phase='finished'; secondsLeft=0; clearInterval(timerId); timerId=null; releaseWakeLock(); playSound('electronic'); speak('Allenamento completato',500); $('#go').textContent='Completato'; $('#go').disabled=true; draw();
}

function nextInfo(){
  if(phase==='prepare') return ['ALLENAMENTO',active.work,'exercise'];
  if(phase==='exercise'){
    if(round<active.rounds) return active.rest>0?['RIPOSO',active.rest,'rest']:['ALLENAMENTO',active.work,'exercise'];
    if(series<active.series) return active.brk>0?['RIPOSO TRA SERIE',active.brk,'break']:['ALLENAMENTO',active.work,'exercise'];
    return ['FINE ALLENAMENTO',0,'finished'];
  }
  if(phase==='rest'||phase==='break') return ['ALLENAMENTO',active.work,'exercise'];
  return ['COMPLETATO',0,'finished'];
}

function draw(){
  if(!active) return;
  const labels={prepare:'PREPARAZIONE',exercise:'ALLENAMENTO',rest:'RIPOSO',break:'RIPOSO TRA SERIE',finished:'COMPLETATO'};
  $('#title').textContent=active.name; $('#phase').textContent=labels[phase]; $('#clock').textContent=formatTime(secondsLeft); $('#current').className='current '+phase;
  $('#progress').textContent=phase==='finished'?'Ottimo lavoro!':`Serie ${series}/${active.series} · Round ${round}/${active.rounds}`;
  const next=nextInfo(); $('#nextPhase').textContent=next[0]; $('#nextTime').textContent=formatTime(next[1]); $('#nextBox').className='nextBox next-'+next[2];
  $('#roundsLeft').textContent=phase==='finished'?0:Math.max(0,active.rounds-round+1); $('#seriesLeft').textContent=phase==='finished'?0:Math.max(0,active.series-series+1); $('#nextBox').classList.toggle('hidden',phase==='finished');
}

$('#go').addEventListener('click',()=>{
  ensureAudio();
  if(timerId){ secondsLeft=Math.max(0,(phaseEnd-Date.now())/1000); clearInterval(timerId); timerId=null; $('#go').textContent='Riprendi'; }
  else run();
});
function resetTimer(){
  clearInterval(timerId); timerId=null; clearVoice(); releaseWakeLock(); phase=active.prep>0?'prepare':'exercise'; round=1; series=1; secondsLeft=phaseDuration(); started=false; announced.clear(); $('#go').disabled=false; $('#go').textContent='Avvia'; $('#wake').textContent='Schermo attivo: da avviare'; $('#wake').style.color=''; draw();
}
$('#reset').addEventListener('click',resetTimer);
$('#back').addEventListener('click',()=>{ resetTimer(); active=null; $('#timer').classList.remove('active'); $('#home').classList.add('active'); });

document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible' && timerId){ keepAwake(); tick(); } });
window.addEventListener('pagehide',()=>releaseWakeLock());

function setTab(intervalsVisible){
  $('#intervals').hidden=!intervalsVisible; $('#stopwatch').hidden=intervalsVisible; $('#tabI').classList.toggle('active',intervalsVisible); $('#tabS').classList.toggle('active',!intervalsVisible);
}
$('#tabI').addEventListener('click',()=>setTab(true)); $('#tabS').addEventListener('click',()=>setTab(false));
function drawStopwatch(){
  const elapsed=stopwatchId?Date.now()-stopwatchStartedAt+stopwatchElapsed:stopwatchElapsed;
  $('#swtime').textContent=`${String(Math.floor(elapsed/60000)).padStart(2,'0')}:${String(Math.floor(elapsed/1000)%60).padStart(2,'0')}.${String(Math.floor(elapsed/10)%100).padStart(2,'0')}`;
}
$('#swgo').addEventListener('click',()=>{
  if(stopwatchId){ stopwatchElapsed+=Date.now()-stopwatchStartedAt; clearInterval(stopwatchId); stopwatchId=null; $('#swgo').textContent='Avvia'; }
  else { stopwatchStartedAt=Date.now(); stopwatchId=setInterval(drawStopwatch,40); $('#swgo').textContent='Pausa'; }
  drawStopwatch();
});
$('#swreset').addEventListener('click',()=>{ clearInterval(stopwatchId); stopwatchId=null; stopwatchElapsed=0; $('#swgo').textContent='Avvia'; drawStopwatch(); });

save(); render();
if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.warn)); }
