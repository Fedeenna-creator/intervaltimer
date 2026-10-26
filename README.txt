IntervalTimer v15.3 — correzione concreta player audio iPhone/Safari/PWA

Causa individuata nella v15.2
- i cinque elementi <audio> erano contenuti in un <div hidden>. Su iPhone/PWA questo può lasciare play() formalmente risolta senza una riproduzione affidabile/udibile;
- il messaggio di successo veniva mostrato appena la Promise di play() si risolveva, senza verificare l'evento playing o l'avanzamento di currentTime;
- quindi “Riproduzione HTML audio” non provava che il file avesse realmente iniziato a scorrere;
- il fallback Web Audio partiva soltanto in caso di rigetto di play(), non quando play() si risolveva senza un effettivo evento di riproduzione.

Correzioni v15.3
- rimosso l'attributo hidden dal contenitore dei player; la banca audio rimane presente nel layout in un'area tecnica di 1×1 px, non muta e non display:none;
- cinque Audio element persistenti, precaricati e riutilizzati sia nell'anteprima sia nelle transizioni;
- prima di ogni suono: pause(), muted=false, defaultMuted=false, volume impostato, playbackRate=1, loop=false e currentTime=0;
- il click “Ascolta il suono” attende la Promise restituita da play() e poi attende una prova effettiva: evento playing oppure timeupdate con currentTime > 0,015 secondi;
- il messaggio di successo viene mostrato soltanto dopo questa prova reale;
- se play() viene rifiutata o non arriva playing entro 1,8 secondi, viene mostrato l'errore effettivo con nome, messaggio, readyState e networkState disponibili;
- fallback Web Audio attivato nello stesso gesto utente: AudioContext.resume(), decodifica del medesimo WAV e AudioBufferSource udibile;
- stesso metodo playCue() usato per anteprima, avvio, tutte le transizioni e completamento;
- Audio Session richiesta come transient quando disponibile, per sovrapporre brevi segnali alla musica per quanto consentito da iOS;
- cache incrementata a intervaltimer-v15-3-audio-verified-1;
- app.js e service worker versionati con v15.3.

WAV verificati e inclusi
- sound-gym.wav — PCM signed 16-bit little-endian, stereo, 44.100 Hz, circa 0,70 s;
- sound-electronic.wav — PCM signed 16-bit little-endian, stereo, 44.100 Hz, 0,58 s;
- sound-horn.wav — PCM signed 16-bit little-endian, stereo, 44.100 Hz, 0,78 s;
- sound-military.wav — PCM signed 16-bit little-endian, stereo, 44.100 Hz, 0,56 s;
- sound-industrial.wav — PCM signed 16-bit little-endian, stereo, 44.100 Hz, 0,76 s.

I file sono non silenziosi e sono stati verificati anche tramite misura RMS/peak. Nomi e maiuscole/minuscole coincidono esattamente in index.html, app.js, sw.js e ZIP.

Funzioni mantenute
- allenamenti multipli personalizzabili e salvati sul dispositivo;
- preparazione, allenamento, riposo round, round, serie e riposo tra serie;
- cinque suoni e volume Medio/Forte/Massimo;
- annunci vocali e countdown opzionali;
- timer, colori delle fasi, fase successiva, round e serie mancanti;
- gestione delle durate di riposo a zero;
- cronometro, Wake Lock, uso offline, manifest, icone e migrazione dei dati precedenti.

Pubblicazione su GitHub Pages
1. Sostituire tutti i file pubblicati con i 12 file contenuti nello ZIP.
2. Conservare esattamente i nomi minuscoli dei cinque WAV.
3. Aprire direttamente almeno sound-gym.wav dall'URL GitHub Pages per verificare una risposta HTTP 200.
4. Aprire il sito online e controllare che nell'intestazione compaia v15.3.
5. Su iPhone eliminare la precedente PWA dalla schermata Home e aggiungerla nuovamente da Safari. Questo è necessario se iOS continua a usare i file/cache della v15.2.

Nota musica/iOS
La modalità transient è adatta a segnali brevi e viene richiesta per ridurre l'impatto sulla musica. iOS mantiene comunque il controllo finale su routing audio, interruttore Silenzioso, Bluetooth, Focus e altre applicazioni. Gli annunci vocali restano opzionali perché speechSynthesis può abbassare o interrompere la musica più dei cue brevi.
