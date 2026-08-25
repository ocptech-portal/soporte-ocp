// Flujo restaurado: inicializa y registra al cargar la pagina, igual que la version que llamaba.
// Cambio minimo: usa getWebexConfig/getCallingConfig de app.js, donde se renueva el access token si hace falta.
let calling;
let callingClient;
let line;
let call;
let incomingCall;
let localAudioStream;
let localVideoStream;
let isLineRegistered = false;

const callNotifyEvent = new CustomEvent('line:incoming_call', {
  detail: { callObject: call },
});

function setButtonEnabled(enabled) {
  const button = document.getElementById('clickToCallBtn') || document.querySelector('.call-support-btn');
  if (!button) return;
  button.disabled = !enabled;
  button.setAttribute('aria-busy', enabled ? 'false' : 'true');
}

function updateStatus(config, auth, lineState, message) {
  if (typeof updateAuthIndicator === 'function') {
    updateAuthIndicator({ config, auth, line: lineState, message });
  } else if (typeof setClickToCallStatus === 'function') {
    setClickToCallStatus(message);
  }
}

async function initCalling(userType) {
  try {
    setButtonEnabled(false);
    isLineRegistered = false;
    updateStatus('ok', 'working', 'pending', 'Autenticando y generando call token...');

    const webexConfig = await getWebexConfig(userType);
    const callingConfig = await getCallingConfig();

    updateStatus('ok', 'ok', 'working', 'SDK inicializado. Esperando evento ready...');
    calling = await Calling.init({ webexConfig, callingConfig });

    calling.on('ready', () => {
      updateStatus('ok', 'ok', 'working', 'SDK listo. Registrando Webex Calling...');

      calling.register().then(async () => {
        callingClient = window.callingClient = calling.callingClient;
        line = Object.values(callingClient?.getLines() || {})[0];

        if (!line) {
          updateStatus('ok', 'ok', 'error', 'No se pudo obtener la linea de Webex Calling.');
          setButtonEnabled(false);
          return;
        }

        setupLineListeners();
        await line.register();
      }).catch((err) => {
        console.error('[Click to Call] Error en calling.register()', err);
        updateStatus('ok', 'ok', 'error', 'No se pudo registrar Webex Calling. Revisa consola.');
        setButtonEnabled(false);
      });
    });
  } catch (err) {
    console.error('[Click to Call] Error en initCalling()', err);
    updateStatus('error', 'error', 'error', err?.message || 'No se pudo inicializar Webex Calling.');
    setButtonEnabled(false);
  }
}

function setupLineListeners() {
  try {
    line.on('registered', (lineInfo) => {
      line = lineInfo;
      isLineRegistered = true;
      updateAvailability();
      updateStatus('ok', 'ok', 'ok', 'Autenticado y listo para llamar.');
      setButtonEnabled(true);
    });

    line.on('line:incoming_call', (callObj) => {
      openCallNotification(callObj);
      incomingCall = callObj;
    });
  } catch (err) {
    console.error('[Click to Call] Failed while setting up line listeners', err);
    updateStatus('ok', 'ok', 'error', 'No se pudieron configurar los listeners de la linea.');
  }
}

async function getMediaStreams() {
  const localAudioElem = document.getElementById('local-audio');
  const localVideoElem = document.getElementById('local-video');

  // Mantiene el flujo original de audio que ya funcionaba.
  localAudioStream = await Calling.createMicrophoneStream({ audio: true });
  if (localAudioElem) {
    localAudioElem.srcObject = localAudioStream.outputStream;
  }

  // Agrega preview local de video sin romper audio si el navegador o SDK no entregan camara.
  try {
    if (Calling && typeof Calling.createCameraStream === 'function') {
      localVideoStream = await Calling.createCameraStream({ video: true });
      if (localVideoElem && localVideoStream?.outputStream) {
        localVideoElem.srcObject = localVideoStream.outputStream;
      }
    } else if (navigator.mediaDevices?.getUserMedia) {
      const browserVideoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      localVideoStream = browserVideoStream;
      if (localVideoElem) {
        localVideoElem.srcObject = browserVideoStream;
      }
    }
  } catch (videoError) {
    console.warn('[Click to Call] No se pudo iniciar video local. La llamada continuara solo con audio.', videoError);
    localVideoStream = undefined;
  }
}

function setVideoElementStream(elementId, streamOrTrack) {
  const videoElement = document.getElementById(elementId);
  if (!videoElement || !streamOrTrack) return;

  if (streamOrTrack instanceof MediaStream) {
    videoElement.srcObject = streamOrTrack;
    return;
  }

  if (streamOrTrack.outputStream instanceof MediaStream) {
    videoElement.srcObject = streamOrTrack.outputStream;
    return;
  }

  if (streamOrTrack instanceof MediaStreamTrack) {
    videoElement.srcObject = new MediaStream([streamOrTrack]);
  }
}

async function initiateCall(number) {
  try {
    if (!isLineRegistered || !line) {
      updateStatus('ok', 'ok', 'working', 'La linea aun no esta registrada. Espera a que indique listo.');
      return;
    }

    setButtonEnabled(false);
    updateStatus('ok', 'ok', 'ok', 'Iniciando llamada...');

    await getMediaStreams();

    if (number) {
      openCallWindow(number);
      call = line.makeCall({
        type: 'uri',
        address: number,
      });
    } else {
      openCallWindow();
      call = line.makeCall();
    }

    call.on('progress', () => {
      updateStatus('ok', 'ok', 'ok', 'Llamada en progreso...');
    });

    call.on('connect', () => {
      updateStatus('ok', 'ok', 'ok', 'Llamada conectada.');
      if (number === '5007' && typeof secondCallNotification !== 'undefined') {
        secondCallNotification.startTimer();
        secondCallNotification.enableCompleteTransfer();
      } else if (callNotification) {
        callNotification.startTimer();
      }
    });

    call.on('remote_media', (track) => {
      const remoteAudio = document.getElementById('customer-remote-audio');
      if (remoteAudio) remoteAudio.srcObject = new MediaStream([track]);
    });

    // Eventos de video descritos por el sample de Cisco/Webex.
    call.on('media:local_video', (stream) => {
      setVideoElementStream('local-video', stream);
    });

    call.on('media:remote_video', (stream) => {
      setVideoElementStream('remote-video', stream);
    });

    call.on('disconnect', () => {
      closeCallWindow();
      cleanupVideoElements();
      setButtonEnabled(true);
      updateStatus('ok', 'ok', 'ok', 'Llamada finalizada. Listo para llamar nuevamente.');
    });

    call.on('error', (err) => {
      console.error('[Click to Call] Call error', err);
      closeCallWindow();
      cleanupVideoElements();
      setButtonEnabled(true);
      updateStatus('ok', 'ok', 'error', 'No se pudo realizar la llamada. Revisa consola.');
    });

    await call.dial(localAudioStream);
  } catch (err) {
    console.error('[Click to Call] Failed in initiating call', err);
    closeCallWindow();
    cleanupVideoElements();
    setButtonEnabled(true);
    updateStatus('ok', 'ok', 'error', err?.message || 'No se pudo realizar la llamada.');
  }
}

function openCallWindow() {
  if (callNotification) callNotification.toggle();
}

function closeCallWindow() {
  if (callNotification) callNotification.toggle('close');
}

function cleanupVideoElements() {
  ['local-video', 'remote-video'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.srcObject = null;
  });
}

function disconnectCall() {
  try {
    if (call) call.end();
    closeCallWindow();
    cleanupVideoElements();
    setButtonEnabled(true);
    updateStatus('ok', 'ok', 'ok', 'Llamada finalizada.');
  } catch (err) {
    console.error('[Click to Call] failed to disconnect the call', err);
  }
}

function answerCall() {}
function holdResume() {}
function initiateTransfer() {}
function commitConsultTransfer() {}
function toggleMute() {}
