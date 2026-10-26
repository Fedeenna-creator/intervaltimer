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
let audioKeepAlive = null;
let fallbackAudio = null;
let fallbackPrimed = false;
let fallbackPrimePromise = null;
let audioUnlockPromise = null;
const soundBuffers = new Map();
const rawSoundData = new Map();
const activeSoundSources = new Set();
const SOUND_FILES = {
  gym:'sound-gym.wav',
  electronic:'sound-electronic.wav',
  horn:'sound-horn.wav',
  military:'sound-military.wav',
  industrial:'sound-industrial.wav'
};
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

function setAudioStatus(message,ok=true){
  const element=$('#audioStatus');
  if(!element) return;
  element.textContent=message;
  element.style.color=ok?'#20d65a':'#ffb02e';
}

function configureAmbientAudio(){
  try{
    if(navigator.audioSession && 'type' in navigator.audioSession) navigator.audioSession.type='ambient';
  }catch(error){ console.debug('Audio session ambient non disponibile',error); }
}

function getAudioContext(){
  if(audioContext) return audioContext;
  const AudioCtx=window.AudioContext||window.webkitAudioContext;
  if(!AudioCtx) return null;
  try{
    // Nessuna opzione nel costruttore: maggiore compatibilità con le versioni di Safari/iOS.
    audioContext=new AudioCtx();
    masterGain=audioContext.createGain();
    masterGain.gain.value=.72;
    masterGain.connect(audioContext.destination);
    audioContext.addEventListener?.('statechange',()=>{
      if(audioContext.state==='running') setAudioStatus('Audio pronto');
    });
    return audioContext;
  }catch(error){
    console.warn('Web Audio non disponibile',error);
    return null;
  }
}

function getFallbackAudio(){
  if(fallbackAudio) return fallbackAudio;
  fallbackAudio=new Audio();
  fallbackAudio.preload='auto';
  fallbackAudio.playsInline=true;
  fallbackAudio.setAttribute('playsinline','');
  fallbackAudio.setAttribute('webkit-playsinline','');
  return fallbackAudio;
}

function primeFallbackAudio(){
  if(fallbackPrimed) return Promise.resolve();
  if(fallbackPrimePromise) return fallbackPrimePromise;
  const player=getFallbackAudio();
  player.src='silence.wav';
  player.volume=.01;
  player.load();
  const attempt=player.play();
  if(!attempt){ fallbackPrimed=true; return Promise.resolve(); }
  fallbackPrimePromise=attempt.then(()=>{
    fallbackPrimed=true;
    player.pause();
    player.currentTime=0;
  }).catch(error=>{
    console.debug('Sblocco audio HTML rimandato',error);
  }).finally(()=>{fallbackPrimePromise=null;});
  return fallbackPrimePromise;
}

function createSilentPulse(context){
  try{
    const buffer=context.createBuffer(1,1,22050);
    const source=context.createBufferSource();
    source.buffer=buffer;
    source.connect(context.destination);
    source.start(0);
  }catch(error){ console.debug('Silent pulse non disponibile',error); }
}

function decodeAudio(context,arrayBuffer){
  return new Promise((resolve,reject)=>{
    let settled=false;
    const ok=value=>{if(!settled){settled=true;resolve(value)}};
    const fail=error=>{if(!settled){settled=true;reject(error)}};
    try{
      const result=context.decodeAudioData(arrayBuffer.slice(0),ok,fail);
      if(result&&typeof result.then==='function') result.then(ok,fail);
    }catch(error){ fail(error); }
  });
}

async function preloadSoundFiles(){
  await Promise.all(Object.entries(SOUND_FILES).map(async([key,file])=>{
    try{
      const response=await fetch(file,{cache:'force-cache'});
      if(!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      rawSoundData.set(key,await response.arrayBuffer());
    }catch(error){ console.warn(`Precaricamento ${file} non riuscito`,error); }
  }));
}

async function ensureSoundBuffer(key){
  if(soundBuffers.has(key)) return soundBuffers.get(key);
  const context=getAudioContext();
  if(!context) return null;
  if(!rawSoundData.has(key)){
    const response=await fetch(SOUND_FILES[key],{cache:'force-cache'});
    if(!response.ok) throw new Error(`Audio ${key} non disponibile`);
    rawSoundData.set(key,await response.arrayBuffer());
  }
  const buffer=await decodeAudio(context,rawSoundData.get(key));
  soundBuffers.set(key,buffer);
  return buffer;
}

function decodeAllSounds(){
  return Promise.all(Object.keys(SOUND_FILES).map(key=>ensureSoundBuffer(key).catch(error=>{
    console.warn(`Decodifica ${key} non riuscita`,error);
    return null;
  })));
}

function unlockAudioFromGesture(){
  configureAmbientAudio();
  const context=getAudioContext();
  // play() e resume() vengono invocati subito nel gesto dell'utente: requisito di iOS/Safari.
  const fallbackPromise=primeFallbackAudio();
  if(!context){
    audioUnlockPromise=fallbackPromise;
    return audioUnlockPromise;
  }
  createSilentPulse(context);
  const resumePromise=context.state==='suspended' ? context.resume() : Promise.resolve();
  audioUnlockPromise=Promise.allSettled([resumePromise,fallbackPromise]).then(()=>{
    createSilentPulse(context);
    return decodeAllSounds();
  });
  return audioUnlockPromise;
}

function startAudioKeepAlive(){
  const context=getAudioContext();
  if(!context||audioKeepAlive) return;
  try{
    const buffer=context.createBuffer(1,Math.max(1,Math.round(context.sampleRate*.25)),context.sampleRate);
    const source=context.createBufferSource();
    const gain=context.createGain();
    gain.gain.value=.00001;
    source.buffer=buffer; source.loop=true; source.connect(gain).connect(context.destination); source.start(0);
    audioKeepAlive={source,gain};
  }catch(error){ console.debug('Keep-alive audio non disponibile',error); }
}

function stopAudioKeepAlive(){
  try{audioKeepAlive?.source.stop();}catch{}
  audioKeepAlive=null;
}

async function playFallback(key,volume){
  try{
    const player=getFallbackAudio();
    player.pause();
    player.src=SOUND_FILES[key];
    player.volume=Math.max(.01,Math.min(1,Number(volume)||.72));
    player.currentTime=0;
    await player.play();
    fallbackPrimed=true;
    setAudioStatus('Audio pronto');
    return true;
  }catch(error){
    console.warn('Riproduzione audio di riserva non riuscita',error);
    setAudioStatus('Tocca di nuovo: iOS non ha ancora autorizzato l’audio',false);
    return false;
  }
}

async function playCue(key=active?.sound||'gym',volume=active?.volume||.72){
  configureAmbientAudio();
  const context=getAudioContext();
  try{
    if(context){
      if(context.state==='suspended') await context.resume();
      if(audioUnlockPromise) await audioUnlockPromise;
      const buffer=await ensureSoundBuffer(key);
      if(buffer&&context.state==='running'){
        const source=context.createBufferSource();
        const gain=context.createGain();
        gain.gain.value=Math.max(.01,Math.min(1,Number(volume)||.72));
        source.buffer=buffer;
        source.connect(gain).connect(masterGain);
        source.addEventListener?.('ended',()=>activeSoundSources.delete(source));
        activeSoundSources.add(source);
        source.start(0);
        setAudioStatus('Audio pronto');
        if(navigator.vibrate) navigator.vibrate(50);
        return true;
      }
    }
  }catch(error){ console.warn('Web Audio non riuscito; uso il fallback',error); }
  return playFallback(key,volume);
}

$('#previewSound').addEventListener('pointerdown',unlockAudioFromGesture);
$('#previewSound').addEventListener('touchstart',unlockAudioFromGesture,{passive:true});
$('#previewSound').addEventListener('click',async()=>{
  setAudioStatus('Attivazione audio…');
  await unlockAudioFromGesture();
  await playCue($('#sound').value,Number($('#volume').value));
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
  keepAwake(); startAudioKeepAlive();
  if(!started){
    started=true;
    if(phase==='exercise'){playCue();speak('Go',250);} else if(phase==='prepare') speak('Prepara');
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
    setPhase('exercise'); playCue(); speak('Go',250); continueAutomatically(); return;
  }
  if(phase==='exercise'){
    if(round<active.rounds){
      playCue(); speak('Stop',250);
      if(active.rest>0){ setPhase('rest'); continueAutomatically(); }
      else { round++; setPhase('exercise'); speak('Go',250); continueAutomatically(); }
      return;
    }
    if(series<active.series){
      playCue(); speak('Stop',250);
      if(active.brk>0){ setPhase('break'); speak('Riposo tra serie',650); continueAutomatically(); }
      else { series++; round=1; setPhase('exercise'); speak('Go',250); continueAutomatically(); }
      return;
    }
    finishWorkout(); return;
  }
  if(phase==='rest'){
    round++; setPhase('exercise'); playCue(); speak('Go',250); continueAutomatically(); return;
  }
  if(phase==='break'){
    series++; round=1; setPhase('exercise'); playCue(); speak('Go',250); continueAutomatically();
  }
}

function finishWorkout(){
  phase='finished'; secondsLeft=0; clearInterval(timerId); timerId=null; releaseWakeLock(); playCue(); stopAudioKeepAlive(); speak('Allenamento completato',500); $('#go').textContent='Completato'; $('#go').disabled=true; draw();
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

$('#go').addEventListener('pointerdown',unlockAudioFromGesture);
$('#go').addEventListener('touchstart',unlockAudioFromGesture,{passive:true});
$('#go').addEventListener('click',async()=>{
  await unlockAudioFromGesture();
  if(timerId){ secondsLeft=Math.max(0,(phaseEnd-Date.now())/1000); clearInterval(timerId); timerId=null; $('#go').textContent='Riprendi'; }
  else run();
});
function resetTimer(){
  clearInterval(timerId); timerId=null; clearVoice(); stopAudioKeepAlive(); releaseWakeLock(); phase=active.prep>0?'prepare':'exercise'; round=1; series=1; secondsLeft=phaseDuration(); started=false; announced.clear(); $('#go').disabled=false; $('#go').textContent='Avvia'; $('#wake').textContent='Schermo attivo: da avviare'; $('#wake').style.color=''; draw();
}
$('#reset').addEventListener('click',resetTimer);
$('#back').addEventListener('click',()=>{ resetTimer(); active=null; $('#timer').classList.remove('active'); $('#home').classList.add('active'); });

document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&timerId){
    configureAmbientAudio();
    audioContext?.resume().catch(()=>{});
    keepAwake(); startAudioKeepAlive(); tick();
  }
});
window.addEventListener('pagehide',()=>{stopAudioKeepAlive();releaseWakeLock();});

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

save(); render(); preloadSoundFiles();
if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.warn)); }
