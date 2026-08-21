// Render migration: Service App credentials are NEVER stored in browser JavaScript.
// The backend refreshes the Service App OAuth token and requests Webex guest/call tokens.
const CLICK_TO_CALL_CALLED_NUMBER = '9605';
const CLICK_TO_CALL_GUEST_NAME = 'Unidos por la colaboración';
const WEBEX_DISCOVERY_REGION = 'US-EAST';
const WEBEX_DISCOVERY_COUNTRY = 'US';

let callNotification;

class SimpleCallTimer {
  constructor(timerElement) {
    this.timerElement = timerElement;
    this.intervalId = null;
    this.elapsedSeconds = 0;
  }

  start() {
    this.stop();
    this.elapsedSeconds = 0;
    this.render();
    this.intervalId = window.setInterval(() => {
      this.elapsedSeconds += 1;
      this.render();
    }, 1000);
  }

  stop() {
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.elapsedSeconds = 0;
    this.render();
  }

  render() {
    if (!this.timerElement) return;
    const minutes = String(Math.floor(this.elapsedSeconds / 60)).padStart(2, '0');
    const seconds = String(this.elapsedSeconds % 60).padStart(2, '0');
    this.timerElement.textContent = `${minutes}:${seconds}`;
  }
}

class CallNotificationElement {
  constructor(element, timerElement) {
    this.callNotification = element;
    this.callNotificationTimer = new SimpleCallTimer(timerElement);
  }

  toggle(action) {
    if (!this.callNotification) return this.callNotificationTimer;
    if (action === 'close' || this.callNotification.classList.contains('show-notification')) {
      this.callNotification.classList.remove('show-notification');
      this.callNotificationTimer.stop();
    } else {
      this.callNotification.classList.add('show-notification');
    }
    return this.callNotificationTimer;
  }

  startTimer() {
    if (!this.callNotification) return this.callNotificationTimer;
    this.callNotification.classList.add('timestate', 'show-notification');
    this.callNotificationTimer.start();
    return this.callNotificationTimer;
  }
}

const callNotificationElem = document.getElementById('callNotification');
const callTimer = document.querySelector('#callNotification #timer');
const profileOnline = document.querySelector('.dropbtn #availability');

if (callNotificationElem) {
  callNotification = new CallNotificationElement(callNotificationElem, callTimer);
}


function getClickToCallConfig() {
  return {
    calledNumber: CLICK_TO_CALL_CALLED_NUMBER,
    guestName: CLICK_TO_CALL_GUEST_NAME,
    region: WEBEX_DISCOVERY_REGION,
    country: WEBEX_DISCOVERY_COUNTRY,
  };
}

function logClickToCall(message, data) {
  if (data !== undefined) {
    console.log(`[Click to Call] ${message}`, data);
  } else {
    console.log(`[Click to Call] ${message}`);
  }
}

function setStatusText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setStatusState(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.dataset.state = state;
}

function setClickToCallStatus(message) {
  const statusElement = document.getElementById('clickToCallStatus');
  if (statusElement) statusElement.textContent = message || '';
  logClickToCall(message || '');
}

function updateAuthIndicator({ config = 'pending', auth = 'pending', line = 'pending', message = '' } = {}) {
  const labels = {
    pending: 'Pendiente',
    working: 'En progreso',
    ok: 'OK',
    error: 'Error',
  };

  setStatusText('configStatusValue', labels[config] || config);
  setStatusState('configStatusItem', config);
  setStatusText('authStatusValue', labels[auth] || auth);
  setStatusState('authStatusItem', auth);
  setStatusText('lineStatusValue', labels[line] || line);
  setStatusState('lineStatusItem', line);

  if (message) setClickToCallStatus(message);
}

function validateClickToCallConfig() {
  const config = getClickToCallConfig();
  const missing = [];
  if (!config.calledNumber) missing.push('CLICK_TO_CALL_CALLED_NUMBER');
  return missing;
}

function setClickToCallButtonReady(isReady, statusMessage) {
  const button = document.getElementById('clickToCallBtn') || document.querySelector('.call-support-btn');
  if (button) {
    button.disabled = !isReady;
    button.setAttribute('aria-busy', isReady ? 'false' : 'true');
  }
  if (statusMessage) setClickToCallStatus(statusMessage);
}

function prepareClickToCall() {
  const missing = validateClickToCallConfig();
  if (missing.length > 0) {
    updateAuthIndicator({
      config: 'error',
      auth: 'pending',
      line: 'pending',
      message: `Falta configurar: ${missing.join(', ')}`,
    });
    setClickToCallButtonReady(false);
    return;
  }

  updateAuthIndicator({
    config: 'ok',
    auth: 'pending',
    line: 'pending',
    message: 'Configuración lista. Inicializando Webex Calling...',
  });
  setClickToCallButtonReady(false);
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (error) {
    return { raw: text };
  }
}

async function getGuestToken() {
  const config = getClickToCallConfig();
  updateAuthIndicator({ config: 'ok', auth: 'working', line: 'pending', message: 'Solicitando guest token.' });

  const response = await fetch('/api/guest-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await readJsonResponse(response);
  if (!response.ok || !data.accessToken) {
    throw new Error(`No se pudo obtener el guest token (${response.status}): ${JSON.stringify(data)}`);
  }
  updateAuthIndicator({ config: 'ok', auth: 'ok', line: 'pending', message: 'Guest token obtenido.' });
  return data.accessToken;
}

async function getJweToken() {
  const config = getClickToCallConfig();
  if (!config.calledNumber) throw new Error('No hay número de destino configurado.');

  updateAuthIndicator({ config: 'ok', auth: 'working', line: 'pending', message: 'Generando call token fresco.' });
  const response = await fetch('/api/call-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      calledNumber: config.calledNumber,
      guestName: config.guestName,
    }),
  });
  const data = await readJsonResponse(response);
  if (!response.ok || !data.callToken) {
    throw new Error(`No se pudo obtener el call token (${response.status}): ${JSON.stringify(data)}`);
  }
  updateAuthIndicator({ config: 'ok', auth: 'ok', line: 'pending', message: 'Call token fresco obtenido.' });
  return data.callToken;
}

async function getWebexConfig() {
  const guestToken = await getGuestToken();
  return {
    config: {
      logger: { level: 'debug' },
      meetings: {
        reconnection: { enabled: true },
        enableRtx: true,
      },
      encryption: {
        kmsInitialTimeout: 8000,
        kmsMaxTimeout: 40000,
        batcherMaxCalls: 30,
        caroots: null,
      },
      dss: {},
    },
    credentials: {
      access_token: guestToken,
    },
  };
}

async function getCallingConfig() {
  const config = getClickToCallConfig();
  const jweToken = await getJweToken();
  const loggerConfig = { level: 'info' };
  return {
    clientConfig: {
      calling: true,
      video: true,
      callHistory: false,
    },
    callingClientConfig: {
      logger: loggerConfig,
      discovery: {
        region: config.region,
        country: config.country,
      },
      serviceData: {
        indicator: 'guestcalling',
        domain: '',
        guestName: config.guestName,
      },
      jwe: jweToken,
    },
    logger: loggerConfig,
  };
}

function openCallNotification() {
  if (callNotification) callNotification.toggle();
}

function updateAvailability() {
  if (profileOnline) profileOnline.classList.add('online');
}
