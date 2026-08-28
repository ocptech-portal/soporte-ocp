
const CLICK_TO_CALL_CALLED_NUMBER = '88888';
const CLICK_TO_CALL_GUEST_NAME = 'Soporte clic-to-call';
const WEBEX_DISCOVERY_REGION = 'US-EAST';
const WEBEX_DISCOVERY_COUNTRY = 'AR';
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


const WEBEX_TOKEN_STORAGE_KEY = 'webex_click_to_call_service_app_tokens';

function getStoredServiceAppTokens() {
  try {
    const stored = window.localStorage.getItem(WEBEX_TOKEN_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.warn('[Click to Call] No se pudo leer localStorage:', error);
    return {};
  }
}

function saveStoredServiceAppTokens(tokens) {
  try {
    const current = getStoredServiceAppTokens();
    window.localStorage.setItem(WEBEX_TOKEN_STORAGE_KEY, JSON.stringify({
      ...current,
      ...tokens,
      updatedAt: new Date().toISOString(),
    }));
  } catch (error) {
    console.warn('[Click to Call] No se pudo guardar tokens en localStorage:', error);
  }
}

function getStoredServiceAppAccessToken() {
  const stored = getStoredServiceAppTokens();
  return stored.accessToken || service_app_token;
}

function getStoredServiceAppRefreshToken() {
  const stored = getStoredServiceAppTokens();
  return stored.refreshToken || service_app_refresh_token;
}

function updateInMemoryServiceAppTokens({ accessToken, refreshToken }) {
  if (accessToken) service_app_token = accessToken;
  if (refreshToken) service_app_refresh_token = refreshToken;
  saveStoredServiceAppTokens({
    accessToken: accessToken || service_app_token,
    refreshToken: refreshToken || service_app_refresh_token,
  });
}

function maskToken(token) {
  if (!token) return 'vacío';
  if (token.length <= 12) return `${token.slice(0, 4)}...`;
  return `${token.slice(0, 6)}...${token.slice(-6)}`;
}

async function refreshServiceAppAccessToken() {
  const config = getClickToCallConfig();
  if (!config.refreshToken) {
    throw new Error('No hay service_app_refresh_token configurado para renovar el access token.');
  }
  if (!config.clientId || !config.clientSecret) {
    throw new Error('Para renovar el access token configura service_app_client_id y service_app_client_secret.');
  }

  updateAuthIndicator({ config: 'ok', auth: 'working', line: 'pending', message: 'Renovando access token con refresh token.' });

  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('client_id', config.clientId);
  body.set('client_secret', config.clientSecret);
  body.set('refresh_token', config.refreshToken);

  const response = await fetch('https://webexapis.com/v1/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const data = await readJsonResponse(response);
  if (!response.ok || !data.access_token) {
    throw new Error(`No se pudo renovar el access token (${response.status}): ${JSON.stringify(data)}`);
  }

  updateInMemoryServiceAppTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token || config.refreshToken,
  });

  logClickToCall('Access token renovado', {
    accessToken: maskToken(data.access_token),
    refreshToken: maskToken(data.refresh_token || config.refreshToken),
    expiresIn: data.expires_in,
  });

  updateAuthIndicator({ config: 'ok', auth: 'ok', line: 'pending', message: 'Access token renovado.' });
  return data.access_token;
}

async function fetchWithServiceAppAuth(url, options = {}, retryOnUnauthorized = true) {
  let token = getStoredServiceAppAccessToken();

  if (!token && getStoredServiceAppRefreshToken()) {
    token = await refreshServiceAppAccessToken();
  }

  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if ((response.status === 401 || response.status === 403) && retryOnUnauthorized && getStoredServiceAppRefreshToken()) {
    const errorBody = await readJsonResponse(response);
    logClickToCall(`Access token rechazado (${response.status}). Intentando renovar.`, errorBody);
    const freshToken = await refreshServiceAppAccessToken();
    const retryHeaders = new Headers(options.headers || {});
    retryHeaders.set('Authorization', `Bearer ${freshToken}`);
    return fetch(url, {
      ...options,
      headers: retryHeaders,
    });
  }

  return response;
}

function getClickToCallConfig() {
  return {
    serviceAppToken: getStoredServiceAppAccessToken(),
    refreshToken: getStoredServiceAppRefreshToken(),
    clientId: service_app_client_id,
    clientSecret: service_app_client_secret,
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
  if (!config.serviceAppToken && !config.refreshToken) missing.push('service_app_token o service_app_refresh_token');
  if (config.refreshToken && !config.clientId) missing.push('service_app_client_id');
  if (config.refreshToken && !config.clientSecret) missing.push('service_app_client_secret');
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
  if (!config.serviceAppToken && !config.refreshToken) throw new Error('Configura service_app_token o service_app_refresh_token en js/app.js.');

  updateAuthIndicator({ config: 'ok', auth: 'working', line: 'pending', message: 'Solicitando guest token.' });

  const response = await fetchWithServiceAppAuth('https://webexapis.com/v1/guests/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subject: 'Webex Click To Call Demo',
      displayName: config.guestName,
    }),
    redirect: 'follow',
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
  if (!config.serviceAppToken && !config.refreshToken) throw new Error('Configura service_app_token o service_app_refresh_token en js/app.js.');
  if (!config.calledNumber) throw new Error('Configura CLICK_TO_CALL_CALLED_NUMBER en js/app.js.');

  updateAuthIndicator({ config: 'ok', auth: 'working', line: 'pending', message: 'Generando call token fresco.' });

  const response = await fetchWithServiceAppAuth('https://webexapis.com/v1/telephony/click2call/callToken', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      calledNumber: config.calledNumber,
      guestName: config.guestName,
    }),
    redirect: 'follow',
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
