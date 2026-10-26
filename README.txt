IntervalTimer v15.2 — player audio iPhone/Safari/PWA corretto

Diagnosi della v15.1
- il pulsante “Ascolta il suono” attendeva operazioni asincrone prima della riproduzione effettiva; su iPhone/Safari questo poteva far perdere la user activation richiesta da play();
- lo stato “Audio pronto” indicava soltanto che AudioContext era in stato running, non che un file WAV fosse realmente in riproduzione;
- il fallback HTMLAudio veniva usato soltanto dopo un errore Web Audio esplicito; un AudioContext running ma senza uscita udibile non generava errore e quindi non attivava il fallback;
- i WAV della v15.1 erano validi, ma il motore non garantiva che il medesimo elemento audio autorizzato dal gesto fosse riutilizzato nelle transizioni automatiche.

Correzioni v15.2
- motore principale HTMLAudio con cinque elementi persistenti, uno per ciascun WAV;
- play() del suono selezionato invocato immediatamente e senza await nel click su “Ascolta il suono”;
- primo suono riprodotto direttamente nel click su “Avvia”, così lo stesso player rimane autorizzato e viene riutilizzato durante tutte le transizioni;
- gestione esplicita della Promise restituita da play(), con messaggio di errore reale e fallback Web Audio in caso di rifiuto;
- AudioContext resume() eseguito nel gesto utente e fallback tramite AudioBuffer;
- Audio Session impostata a “transient” quando disponibile: è il tipo previsto per brevi notifiche e normalmente si sovrappone alla musica invece di sostituirla;
- percorsi costruiti rispetto a document.baseURI, quindi corretti anche su GitHub Pages pubblicato in una sottocartella/repository;
- nomi dei file tutti minuscoli e identici in HTML, JavaScript, service worker e ZIP;
- nuovi WAV PCM stereo 44,1 kHz/16 bit con frequenze più udibili dagli altoparlanti di iPhone;
- cache incrementata a intervaltimer-v15-2-audio-player-2;
- app.js e service worker registrati con versione v15.2 per evitare il riuso della v15.1;
- strategia network-first per HTML/JavaScript e cache-first per i WAV;
- tutti e cinque i WAV disponibili offline.

File audio inclusi
- sound-gym.wav
- sound-electronic.wav
- sound-horn.wav
- sound-military.wav
- sound-industrial.wav

Funzioni mantenute
- più allenamenti personalizzabili e salvati sul dispositivo;
- preparazione, allenamento, riposo round, round, serie e riposo tra serie;
- volume Medio/Forte/Massimo;
- annunci vocali e countdown opzionali, disattivati per impostazione predefinita;
- timer grande, colori, fase successiva, round e serie mancanti;
- gestione delle durate di riposo impostate a zero;
- cronometro separato, Wake Lock, funzionamento offline, manifest, icone e migrazione dei dati precedenti.

Pubblicazione su GitHub Pages
1. Eliminare o sostituire tutti i file della versione precedente nella stessa cartella pubblicata.
2. Caricare tutti i 12 file presenti nello ZIP mantenendo esattamente nomi e minuscole/maiuscole.
3. Verificare che i cinque URL WAV rispondano direttamente, per esempio: https://DOMINIO/PERCORSO/sound-gym.wav
4. Aprire il sito una volta online e controllare che nell'intestazione compaia v15.2.
5. Su iPhone chiudere completamente la PWA. Se compare ancora v15.1, rimuoverla dalla schermata Home, aprire il sito in Safari e aggiungerla nuovamente tramite Condividi > Aggiungi alla schermata Home.

Musica e limitazioni iOS
La sessione “transient” è richiesta per riprodurre brevi segnali sopra la musica per quanto consentito da iOS. Il sistema operativo conserva comunque il controllo finale su volume, modalità Silenzioso, dispositivi Bluetooth, Focus e interazioni con Spotify/Apple Music. Gli annunci vocali restano disattivati di default perché speechSynthesis può abbassare o interrompere maggiormente la musica.
