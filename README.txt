IntervalTimer v15.1 — correzione audio iPhone/Safari/PWA

Questa versione mantiene tutte le funzioni della v15 e corregge integralmente la riproduzione dei suoni.

Correzioni audio
- inclusi nel pacchetto cinque file WAV PCM mono compatibili con Safari/iPhone;
- riproduzione principale tramite Web Audio con AudioBuffer, più affidabile nelle PWA iOS;
- sblocco esplicito dell'audio all'interno del tocco dell'utente su “Ascolta il suono” e “Avvia”;
- AudioContext creato senza opzioni non supportate dalle versioni meno recenti di Safari;
- fallback tramite un unico elemento HTMLAudio persistente, sbloccato dallo stesso gesto;
- mantenimento della sessione Web Audio durante il timer per consentire i suoni nelle transizioni automatiche;
- i cinque suoni funzionano nell'anteprima, all'avvio, a ogni fine fase/transizione e al completamento;
- tutti i file audio sono inclusi nella cache offline della PWA;
- richiesta della modalità audio “ambient” quando disponibile, per favorire la coesistenza con Spotify/Apple Music.

Funzioni mantenute
- più allenamenti personalizzabili e salvati sul dispositivo;
- preparazione, allenamento, riposo round, round, serie e riposo tra serie;
- cinque suoni selezionabili e volume Medio/Forte/Massimo;
- annunci vocali e countdown 3-2-1 opzionali, disattivati per impostazione predefinita;
- timer grande, colori delle fasi, fase successiva, round e serie mancanti;
- gestione delle pause impostate a zero;
- cronometro separato;
- Wake Lock quando supportato;
- funzionamento offline, manifest e icone;
- migrazione automatica degli allenamenti delle versioni precedenti.

Installazione/aggiornamento
1. Sostituire sul server tutti i file con quelli contenuti in questo ZIP, inclusi i sei file WAV.
2. Aprire l'app online almeno una volta per installare la nuova cache intervaltimer-v15-audiofix-1.
3. Su iPhone chiudere completamente la PWA e riaprirla.
4. Se continua a comparire la vecchia versione, rimuovere l'app dalla schermata Home, aprire il sito in Safari e usare Condividi > Aggiungi alla schermata Home.
5. Verificare che il volume multimediale dell'iPhone non sia a zero. In base alla versione iOS e alla configurazione del dispositivo, l'interruttore Silenzioso/Focus può influire sull'audio web.

Musica in riproduzione
L'app richiede la modalità audio ambient quando l'API è disponibile e usa Web Audio come canale principale. iOS mantiene comunque il controllo finale della sessione audio: gli effetti vengono configurati per mescolarsi alla musica per quanto consentito dal sistema. Gli annunci vocali possono abbassare o interrompere la musica e restano quindi opzionali e disattivati di default.
