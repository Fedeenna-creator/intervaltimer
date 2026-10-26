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
let webAudioGain = null;
let audioKeepAlive = null;
let selectedTimerPlayer = null;
let audioUnlocked = false;
const soundBuffers = new Map();
const rawSoundData = new Map();
const activeSoundSources = new Set();
const SOUND_FILES = Object.freeze({
  gym:'sound-gym.wav',
  electronic:'sound-electronic.wav',
  horn:'sound-horn.wav',
  military:'sound-military.wav',
  industrial:'sound-industrial.wav'
});
const SOUND_URLS = Object.freeze(Object.fromEntries(
  Object.entries(SOUND_FILES).map(([key,file])=>[key,new URL(`./${file}`,document.baseURI).href])
));
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

function configureShortSoundSession(){
  try{
    // “transient” è destinato ai segnali brevi e favorisce la sovrapposizione alla musica.
    if(navigator.audioSession&&'type' in navigator.audioSession) navigator.audioSession.type='transient';
  }catch(error){console.debug('Audio Session API non disponibile',error);}
}

function playerFor(key){
  const player=document.querySelector(`#audio-${key}`);
  if(!player) throw new Error(`Elemento #audio-${key} non trovato`);
  const expected=SOUND_URLS[key];
  if(!expected) throw new Error(`Suono sconosciuto: ${key}`);
  if(player.src!==expected) player.src=expected;
  player.preload='auto';
  player.playsInline=true;
  player.defaultMuted=false;
  player.muted=false;
  player.loop=false;
  player.playbackRate=1;
  player.setAttribute('playsinline','');
  player.setAttribute('webkit-playsinline','');
  return player;
}

function stopOtherPlayers(except=null){
  for(const key of Object.keys(SOUND_FILES)){
    const player=playerFor(key);
    if(player!==except){
      try{player.pause();player.currentTime=0;}catch{}
    }
  }
}

function mediaErrorText(player){
  const error=player.error;
  if(!error) return `nessun MediaError (readyState=${player.readyState}, networkState=${player.networkState}, paused=${player.paused}, currentTime=${Number(player.currentTime||0).toFixed(3)})`;
  const labels={1:'MEDIA_ERR_ABORTED',2:'MEDIA_ERR_NETWORK',3:'MEDIA_ERR_DECODE',4:'MEDIA_ERR_SRC_NOT_SUPPORTED'};
  return `${labels[error.code]||`MediaError ${error.code}`}${error.message?`: ${error.message}`:''}`;
}

function getAudioContext(){
  if(audioContext) return audioContext;
  const AudioCtx=window.AudioContext||window.webkitAudioContext;
  if(!AudioCtx) return null;
  try{
    audioContext=new AudioCtx();
    webAudioGain=audioContext.createGain();
    webAudioGain.gain.value=1;
    webAudioGain.connect(audioContext.destination);
    return audioContext;
  }catch(error){console.warn('Creazione AudioContext non riuscita',error);return null;}
}

function silentWebAudioPulse(context){
  if(!context) return;
  try{
    const buffer=context.createBuffer(1,1,context.sampleRate||44100);
    const source=context.createBufferSource();
    source.buffer=buffer;source.connect(context.destination);source.start(0);
  }catch(error){console.debug('Silent pulse non disponibile',error);}
}

function activateWebAudioFromGesture(){
  configureShortSoundSession();
  const context=getAudioContext();
  if(!context) return Promise.reject(new Error('Web Audio API non disponibile'));
  silentWebAudioPulse(context);
  const resume=context.state==='suspended'?context.resume():Promise.resolve();
  resume.then(()=>{audioUnlocked=context.state==='running';silentWebAudioPulse(context);}).catch(error=>console.warn('AudioContext.resume() non riuscito',error));
  return resume;
}

function decodeAudio(context,arrayBuffer){
  return new Promise((resolve,reject)=>{
    let settled=false;
    const ok=value=>{if(!settled){settled=true;resolve(value)}};
    const fail=error=>{if(!settled){settled=true;reject(error)}};
    try{
      const result=context.decodeAudioData(arrayBuffer.slice(0),ok,fail);
      if(result&&typeof result.then==='function') result.then(ok,fail);
    }catch(error){fail(error);}
  });
}

async function preloadSoundFiles(){
  await Promise.all(Object.entries(SOUND_URLS).map(async([key,url])=>{
    const player=playerFor(key);
    player.load();
    try{
      const response=await fetch(url,{cache:'force-cache'});
      if(!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      rawSoundData.set(key,await response.arrayBuffer());
    }catch(error){console.warn(`Precaricamento ${SOUND_FILES[key]} non riuscito`,error);}
  }));
}

async function ensureSoundBuffer(key){
  if(soundBuffers.has(key)) return soundBuffers.get(key);
  const context=getAudioContext();
  if(!context) throw new Error('Web Audio API non disponibile');
  if(!rawSoundData.has(key)){
    const response=await fetch(SOUND_URLS[key],{cache:'reload'});
    if(!response.ok) throw new Error(`${SOUND_FILES[key]}: HTTP ${response.status}`);
    rawSoundData.set(key,await response.arrayBuffer());
  }
  const buffer=await decodeAudio(context,rawSoundData.get(key));
  if(!buffer||!buffer.duration) throw new Error(`Decodifica vuota per ${SOUND_FILES[key]}`);
  soundBuffers.set(key,buffer);
  return buffer;
}

function waitForActualPlayback(player,timeoutMs=1800){
  let cancel=()=>{};
  const promise=new Promise((resolve,reject)=>{
    let settled=false;
    const cleanup=()=>{
      clearTimeout(timer);
      player.removeEventListener('playing',onPlaying);
      player.removeEventListener('timeupdate',onTimeUpdate);
      player.removeEventListener('error',onError);
      player.removeEventListener('abort',onAbort);
    };
    const success=event=>{if(settled)return;settled=true;cleanup();resolve(event.type)};
    const failure=error=>{if(settled)return;settled=true;cleanup();reject(error)};
    const onPlaying=event=>success(event);
    const onTimeUpdate=event=>{if(!player.paused&&Number(player.currentTime)>0.015)success(event)};
    const onError=()=>failure(new Error(mediaErrorText(player)));
    const onAbort=()=>failure(new Error(`riproduzione interrotta: ${mediaErrorText(player)}`));
    player.addEventListener('playing',onPlaying,{once:true});
    player.addEventListener('timeupdate',onTimeUpdate);
    player.addEventListener('error',onError,{once:true});
    player.addEventListener('abort',onAbort,{once:true});
    const timer=setTimeout(()=>failure(new Error(`timeout attesa evento playing: ${mediaErrorText(player)}`)),timeoutMs);
    cancel=()=>{if(!settled){settled=true;cleanup();}};
  });
  return {promise,cancel};
}

async function playHtmlCue(key,volume){
  const player=playerFor(key);
  selectedTimerPlayer=player;
  stopOtherPlayers(player);
  const level=Math.max(.05,Math.min(1,Number(volume)||.72));
  player.pause();
  player.muted=false;
  player.defaultMuted=false;
  player.volume=level;
  player.playbackRate=1;
  player.loop=false;
  try{player.currentTime=0;}catch(error){console.debug('Reset currentTime rimandato',error);}
  const actualPlayback=waitForActualPlayback(player);
  let playPromise;
  try{
    // Deve essere eseguita prima del primo await: nel pulsante anteprima è ancora dentro la gesture utente.
    playPromise=player.play();
  }catch(error){
    throw new Error(`${error.name||'Errore play sincrono'}: ${error.message||error}`);
  }
  try{
    if(playPromise&&typeof playPromise.then==='function') await playPromise;
    const evidence=await actualPlayback.promise;
    audioUnlocked=true;
    return {player,evidence};
  }catch(error){
    actualPlayback.cancel();
    try{player.pause();}catch{}
    throw new Error(`${error.name||'HTMLAudioError'}: ${error.message||error}`);
  }
}

async function playWebAudioFallback(key,volume){
  configureShortSoundSession();
  const context=getAudioContext();
  if(!context) throw new Error('Web Audio API non disponibile');
  if(context.state==='suspended') await context.resume();
  if(context.state!=='running') throw new Error(`AudioContext non attivo: ${context.state}`);
  const buffer=await ensureSoundBuffer(key);
  const source=context.createBufferSource();
  const gain=context.createGain();
  gain.gain.value=Math.max(.12,Math.min(1.15,Number(volume)||.72));
  source.buffer=buffer;
  source.connect(gain).connect(webAudioGain);
  source.addEventListener?.('ended',()=>activeSoundSources.delete(source));
  activeSoundSources.add(source);
  source.start(0);
  return true;
}

async function playCue(key=active?.sound||'gym',volume=active?.volume||.72,{preview=false}={}){
  configureShortSoundSession();
  try{
    const result=await playHtmlCue(key,volume);
    if(preview) setAudioStatus(`Suono avviato: ${soundLabel(key)} (${result.evidence})`);
    if(navigator.vibrate) navigator.vibrate(50);
    return true;
  }catch(htmlError){
    console.warn(`HTMLAudio non riuscito per ${SOUND_FILES[key]}`,htmlError);
    try{
      await playWebAudioFallback(key,volume);
      if(preview) setAudioStatus(`HTMLAudio: ${htmlError.message}. Fallback Web Audio avviato.`);
      if(navigator.vibrate) navigator.vibrate(50);
      return true;
    }catch(webError){
      console.error('Anche il fallback Web Audio non è riuscito',webError);
      if(preview) setAudioStatus(`Errore HTMLAudio: ${htmlError.message} | Errore Web Audio: ${webError.message}`,false);
      return false;
    }
  }
}

function startAudioKeepAlive(){
  const context=getAudioContext();
  if(!context||audioKeepAlive) return;
  try{
    const buffer=context.createBuffer(1,Math.max(1,Math.round(context.sampleRate*.25)),context.sampleRate);
    const source=context.createBufferSource();
    const gain=context.createGain();
    gain.gain.value=.00001;
    source.buffer=buffer;source.loop=true;source.connect(gain).connect(context.destination);source.start(0);
    audioKeepAlive={source,gain};
  }catch(error){console.debug('Keep-alive Web Audio non disponibile',error);}
}

function stopAudioKeepAlive(){
  try{audioKeepAlive?.source.stop();}catch{}
  audioKeepAlive=null;
}

$('#previewSound').addEventListener('click',async()=>{
  const key=$('#sound').value;
  const volume=Number($('#volume').value);
  setAudioStatus(`Avvio ${soundLabel(key)}…`);
  // resume() e play() vengono avviati nello stesso click; playCue attende sia play() sia l'evento playing/timeupdate.
  activateWebAudioFromGesture().catch(error=>console.warn('Pre-attivazione Web Audio non riuscita',error));
  await playCue(key,volume,{preview:true});
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
    // Il primo cue parte nello stesso click su Avvia: sblocca il player persistente anche quando c'è la preparazione.
    playCue();
    if(phase==='exercise') speak('Go',250); else if(phase==='prepare') speak('Prepara');
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

$('#go').addEventListener('click',()=>{
  if(timerId){
    secondsLeft=Math.max(0,(phaseEnd-Date.now())/1000); clearInterval(timerId); timerId=null; $('#go').textContent='Riprendi';
  }else{
    // Sblocco sincrono; run() riproduce subito il primo cue nello stesso gesto dell'utente.
    activateWebAudioFromGesture().catch(error=>console.warn('Attivazione Web Audio non riuscita',error));
    run();
  }
});
function resetTimer(){
  clearInterval(timerId); timerId=null; clearVoice(); stopOtherPlayers(); stopAudioKeepAlive(); releaseWakeLock(); phase=active.prep>0?'prepare':'exercise'; round=1; series=1; secondsLeft=phaseDuration(); started=false; announced.clear(); $('#go').disabled=false; $('#go').textContent='Avvia'; $('#wake').textContent='Schermo attivo: da avviare'; $('#wake').style.color=''; draw();
}
$('#reset').addEventListener('click',resetTimer);
$('#back').addEventListener('click',()=>{ resetTimer(); active=null; $('#timer').classList.remove('active'); $('#home').classList.add('active'); });

document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&timerId){
    configureShortSoundSession();
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
if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js?v=15.3').catch(console.warn)); }
