'use strict';

const el = id => document.getElementById(id);
const sides = { L: 'Izquierda', R: 'Derecha', U: 'Vuelta' };
const serviceId = '42aa0001-7331-4d61-b432-9b418a6297d1';
const commandId = '42aa0002-7331-4d61-b432-9b418a6297d1';
const storagePrefix = 'vira.prueba.v1.';
const links = { L: null, R: null };
const connecting = new Set();
const sessions = new Map();
const routeMap = createRouteMap();
let current = null;
let route = null;
let timer = 0;
let previousTick = 0;
let busy = false;
let coolingUntil = 0;
const manualNext = {L:0, R:0};
let message = '';

const connected = side => Boolean(links[side]?.device.gatt.connected);
const active = () => current && ['En curso', 'En pausa'].includes(current.state);
const usable = side => connected(side) && links[side].tested;
function ready() {
  const kind = el('kind').value;
  if (kind === 'trial') return Object.keys(links).every(usable);
  // Una ruta en pausa se reanuda con las mismas pulseras con que partió. Para iniciarla basta una.
  if (kind === 'route' && current?.kind === 'route' && current.state === 'En pausa' && current.sides) {
    return current.sides.every(usable);
  }
  return Object.keys(links).some(usable);
}
const supportsBle = () => window.isSecureContext && Boolean(navigator.bluetooth);
const timeLabel = t => new Date(t).toLocaleTimeString('es-CL');
const completed = e => e.result === 'Enviada' || e.result === 'Simulada';
function title(s) {
  if (s.kind === 'manual') return 'Control manual';
  if (s.kind === 'trial') return 'Prueba de tacto';
  return OSM_TRIPS[s.trip].name + ' · ' + s.profile;
}

function save(session) {
  try { localStorage.setItem(storagePrefix + session.id, JSON.stringify(session)); }
  catch { message = 'El navegador no pudo guardar la sesión. El registro está disponible mientras esta página siga abierta.'; }
}

function restore() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(storagePrefix)) continue;
      let s;
      try { s = JSON.parse(localStorage.getItem(key)); } catch { continue; }
      if (!s || key !== storagePrefix + s.id || !Array.isArray(s.events) || !OSM_TRIPS[s.trip]) continue;
      sessions.set(s.id, s);
    }
  } catch { message = 'El almacenamiento local no está disponible.'; }
}

function renderHistory() {
  const s = sessions.get(el('history').value);
  const list = el('events');
  list.replaceChildren();
  el('summary').textContent = s ? s.state + ' · ' + tally(s) : 'Aún no hay sesiones.';
  if (!s) return;
  for (const e of [...s.events].reverse()) {
    const item = document.createElement('li');
    const side = sides[e.side] || '';
    const answer = e.answer ? ' · respuesta: ' + (sides[e.answer] || 'Ninguno') : '';
    item.textContent = timeLabel(e.time) + ' · ' + (e.result === 'Pendiente' && !activeFor(s) ? 'Sin confirmar' : e.result) +
      (side ? ' · ' + side : '') + (e.detail ? ' · ' + e.detail : '') + answer;
    list.append(item);
  }
}

function activeFor(s) { return current === s && active(); }

function tally(s) {
  const signals = s.events.filter(e => e.type === 'signal');
  const ok = signals.filter(completed).length;
  const failed = signals.filter(e => e.result === 'Fallida').length;
  const unclear = signals.filter(e => ['Sin confirmar', 'Pendiente'].includes(e.result)).length;
  const absent = signals.filter(e => e.result === 'Sin pulsera').length;
  let text = ok + (s.mode === 'ble' ? ' enviadas por Bluetooth' : ' simuladas') + ' · ' + failed + ' fallidas';
  if (unclear) text += ' · ' + unclear + ' sin confirmar';
  if (absent) text += ' · ' + absent + ' sin pulsera';
  if (s.kind === 'trial') {
    const answered = signals.filter(e => e.answer);
    text += ' · ' + answered.filter(e => e.answer === e.side).length + ' aciertos de ' + answered.length + ' respuestas';
  }
  return text;
}

function addHistoryOption(s) {
  const date = new Date(s.started).toLocaleString('es-CL');
  const mode = s.mode === 'ble' ? 'Bluetooth' : 'simulación';
  el('history').prepend(new Option(date + ' · ' + title(s) + ' · ' + mode, s.id));
}

const screens = {pulseras:'bandsTitle', prueba:'pageTitle', historial:'historyTitle'};
function showScreen(focusHeading = false) {
  const requested = location.hash.slice(1);
  let screen = Object.hasOwn(screens, requested) ? requested : 'pulseras';
  if (screen === 'historial' && active() && current.kind === 'trial') {
    screen = 'prueba';
    window.history.replaceState(null, '', '#prueba');
  }
  for (const name of Object.keys(screens)) {
    el(name).hidden = name !== screen;
    const link = document.querySelector('.app-nav a[href="#' + name + '"]');
    if (name === screen) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (screen !== 'prueba') setExpanded(false);
  if (focusHeading) {
    el(screens[screen]).focus({preventScroll:true});
    window.scrollTo(0,0);
  }
}

function setExpanded(expanded) {
  if (el('prueba').classList.contains('expanded') === expanded) return;
  el('prueba').classList.toggle('expanded', expanded);
  el('presentRoute').setAttribute('aria-pressed', String(expanded));
  el('presentRoute').textContent = expanded ? 'Reducir mapa' : 'Ampliar mapa';
  const anchor = expanded ? el('routeMap').parentElement : el('sessionControls');
  anchor.before(el('routeCue'));
}

function render() {
  const locked = Boolean(active());
  const trial = el('kind').value === 'trial';
  const manual = el('kind').value === 'manual';
  const showingRoute = !manual && !trial;
  const confirmed = Object.keys(links).filter(usable).length;
  const paired = Object.keys(links).filter(connected).length;
  el('linkSummary').textContent = confirmed === 2 ? '2 pulseras listas' : confirmed ? '1 pulsera lista' : paired ? 'Falta probar el pulso' : 'Sin conexión';
  el('linkSummary').classList.toggle('ready', confirmed > 0);
  el('pairTitle').textContent = confirmed ? 'Tus conexiones' : 'Conecta tu pulsera';
  el('toExercise').textContent = active() ? 'Volver a la prueba →' : ready() ? 'Continuar a la prueba →' : showingRoute ? 'Ver la ruta antes de conectar →' : 'Ver la prueba →';
  el('connectNeeded').hidden = ready();
  el('connectNeeded').textContent = current?.state === 'En pausa' ? 'Revisar la conexión para reanudar →' : trial ? 'Preparar ambas pulseras para empezar →' : 'Preparar una pulsera para empezar →';
  el('presentRoute').hidden = !showingRoute;
  if (!showingRoute) setExpanded(false);
  el('pageTitle').textContent = manual ? 'Control manual' : trial ? 'Prueba de tacto' : 'Prueba de ruta';
  for (const id of ['routeView','routeCue','bandFeedback','routeHelp']) el(id).hidden = !showingRoute;
  if (showingRoute) {
    routeMap.select(el('trip').value, el('profile').value);
    routeMap.paint(route?.position || 0, true);
    el('mapState').textContent = current?.state || 'Vista previa';
  }
  el('historyLabel').hidden = !sessions.size;
  for (const id of ['kind','trip','profile']) el(id).disabled = locked || busy || connecting.size > 0;
  el('routeOptions').hidden = manual || trial;
  el('manualControls').hidden = !manual;
  el('trialHelp').hidden = !trial;
  for (const side of Object.keys(links)) {
    el('manual' + side).disabled = busy || connecting.size > 0 || current?.state === 'En pausa' ||
      !usable(side) || performance.now() < manualNext[side];
    el('connect' + side).hidden = connected(side);
    el('test' + side).hidden = !connected(side) || usable(side);
    el('test' + side).textContent = links[side]?.awaitingTouch ? 'Repetir pulso' : 'Probar ' + sides[side].toLowerCase();
    el('connect' + side).disabled = connected(side) || busy || connecting.size > 0 || !supportsBle();
    el('test' + side).disabled = !connected(side) || busy || (current?.state === 'En curso' && (!manual || usable(side)));
    el('confirm' + side).hidden = !links[side]?.awaitingTouch || busy;
    el('state' + side).textContent = connecting.has(side) ? 'Conectando…' : connected(side) ? (usable(side) ? 'Lista' : 'Conectada') : 'Sin conexión';
    el('state' + side).closest('.band').classList.toggle('ready', usable(side));
  }
  el('connectionHelp').textContent = !supportsBle() ? 'Este navegador no ofrece Bluetooth aquí. Abre la página HTTPS en Chrome para Android o en Edge de escritorio.' :
    trial ? 'La prueba de tacto requiere conectar las dos pulseras y confirmar el pulso de cada lado.' :
    confirmed ? 'Puedes continuar con las pulseras listas. Haz la prueba con el vehículo detenido.' :
    'Con el vehículo detenido, enciende una pulsera y elige su muñeca. Después prueba la vibración.';
  el('message').textContent = message;
  el('start').hidden = current?.state === 'En curso' || (manual && current?.state !== 'En pausa');
  el('start').disabled = busy || connecting.size > 0 || !ready();
  el('start').textContent = locked ? 'Reanudar' : trial ? 'Iniciar prueba de tacto' : 'Iniciar ruta';
  el('pause').hidden = current?.state !== 'En curso';
  el('finish').hidden = !locked;
  el('finish').disabled = busy;
  el('state').textContent = current ? current.state + ' · Prototipo Bluetooth' : ready() ? 'Lista para empezar.' : 'Esperando pulsera confirmada.';
  el('counts').textContent = current ? tally(current) : '';
  el('trialControls').hidden = !locked || !trial || current.state !== 'En curso';
  const waiting = current?.events.find(e => e.type === 'signal' && completed(e) && !e.answer);
  el('answers').hidden = !waiting || busy;
  el('signal').hidden = Boolean(waiting);
  el('signal').disabled = busy || !ready();
  // El operador registra primero la respuesta. Mostrar el lado antes arruinaría la prueba.
  el('records').hidden = locked && trial;
  el('historyNav').hidden = locked && trial;
  renderHistory();
}

function event(type, result, side = '', detail = '') {
  const entry = {time: Date.now(), type, result, side, detail};
  current.events.push(entry);
  save(current);
  return entry;
}

function pause(reason) {
  if (current?.state !== 'En curso') return;
  cancelAnimationFrame(timer);
  current.state = 'En pausa';
  event('state', 'Pausa', '', reason);
  el('instruction').textContent = reason;
  render();
}

async function connect(side) {
  if (!supportsBle() || busy || connecting.size || connected(side)) return;
  connecting.add(side);
  message = '';
  render();
  let device;
  try {
    device = await navigator.bluetooth.requestDevice({filters:[{name:'Vira-' + side}],optionalServices:[serviceId]});
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(serviceId);
    const command = await service.getCharacteristic(commandId);
    if (!command.properties.write || !command.writeValueWithResponse) throw Error('Característica sin escritura confirmada.');
    if (!device.gatt.connected) throw Error('Se perdió la conexión.');
    links[side] = {device, command, tested:false};
    device.addEventListener('gattserverdisconnected', () => {
      if (links[side]?.device !== device) return;
      links[side] = null;
      message = 'Pulsera ' + sides[side].toLowerCase() + ' desconectada. Conéctala y vuelve a probarla.';
      if (active() && (!current.sides || current.sides.includes(side))) {
        event('link','Desconexión',side);
        pause(message);
      }
      render();
    }, {once:true});
  } catch (err) {
    device?.gatt.disconnect();
    const name = 'Vira-' + side;
    if (!device && err.name === 'NotFoundError') {
      message = 'Enciende ' + name + ' y selecciónala en la lista Bluetooth del navegador.';
    } else if (err.name === 'SecurityError' || err.name === 'NotAllowedError') {
      message = 'El navegador bloqueó el acceso. Revisa el permiso de Bluetooth para este sitio y vuelve a conectar.';
    } else {
      message = 'No se pudo conectar con ' + name + '. Comprueba que esté encendida, libre de otra conexión y con el firmware de ese lado.';
    }
  } finally { connecting.delete(side); render(); }
}

async function send(side) {
  const link = links[side];
  if (!link?.device.gatt.connected) throw Error('Pulsera sin conexión');
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new DOMException('Sin respuesta de la pulsera', 'TimeoutError'));
      link.device.gatt.disconnect();
    }, 6000);
  });
  try {
    await Promise.race([link.command.writeValueWithResponse(new TextEncoder().encode(side)), deadline]);
  } finally { clearTimeout(timeout); }
}

async function testSide(side) {
  if (busy || !connected(side)) return;
  const link = links[side];
  busy = true;
  link.tested = false;
  link.awaitingTouch = false;
  try {
    render();
    await send(side);
    if (connected(side) && links[side] === link) {
      link.awaitingTouch = true;
      message = 'Confirma solo si sentiste el pulso en la muñeca ' + sides[side].toLowerCase() + '.';
      await new Promise(resolve => setTimeout(resolve, 1900));
    }
  } catch { link.tested = false; message = 'Falló la prueba de la pulsera ' + sides[side].toLowerCase() + '.'; }
  finally { busy = false; render(); }
}

async function emit(side, detail) {
  const entry = event('signal','Pendiente',side,detail);
  let signaled = [];
  busy = true;
  render();
  try {
    // Una vuelta requiere que ambos dispositivos acepten su orden.
    const wanted = side === 'U' ? ['L','R'] : [side];
    // Una ruta iniciada con una sola pulsera muestra los giros del otro lado sin enviarlos.
    const targets = current.sides ? wanted.filter(t => current.sides.includes(t)) : wanted;
    if (!targets.length) {
      entry.result = 'Sin pulsera';
      return entry;
    }
    if (targets.length < wanted.length) entry.detail += ' · solo ' + sides[targets[0]];
    const results = await Promise.allSettled(targets.map(send));
    const received = targets.filter((_,i) => results[i].status === 'fulfilled');
    signaled = received;
    if (received.length !== targets.length) {
      if (received.length) entry.detail += ' · escritura aceptada solo en ' + sides[received[0]];
      for (const target of targets.filter(t => !received.includes(t))) {
        if (links[target]) links[target].tested = false;
      }
      throw results.find(result => result.status === 'rejected' && result.reason?.name === 'TimeoutError')?.reason ||
        Error('Escritura fallida');
    }
    entry.result = 'Enviada';
    coolingUntil = performance.now() + 1900;
  } catch (err) {
    entry.result = err.name === 'TimeoutError' ? 'Sin confirmar' : 'Fallida';
    pause('No se confirmó la orden. Prueba las pulseras antes de reanudar.');
  } finally {
    busy = false;
    if (current.kind === 'route') routeMap.showSignal(entry, signaled);
    save(current);
    render();
  }
  return entry;
}

function finish(state) {
  cancelAnimationFrame(timer);
  current.state = state;
  event('state', state);
  el('instruction').textContent = state === 'Completada' ? (current.kind === 'trial' ? 'Diez respuestas registradas.' : 'Llegaste al destino.') : 'Prueba finalizada.';
  render();
}

async function advance() {
  if (current?.state !== 'En curso' || current.kind !== 'route') return;
  const now = performance.now();
  const elapsed = Math.min(500, now - previousTick);
  previousTick = now;
  route.position = Math.min(route.len, route.position + elapsed / 1000 * OSM_PROF[current.profile].kmh / 3.6 * OSM_SPEEDUP);
  routeMap.paint(route.position);
  const step = route.steps[route.next];
  if (step) {
    const distance = Math.max(0, Math.round(step.at - route.position));
    const name = step.name || 'la siguiente calle';
    if (distance <= OSM_PROF[current.profile].warn && now >= coolingUntil) {
      route.next++;
      await emit(step.side, name);
    }
  } else if (route.position >= route.len) {
    finish('Completada');
    return;
  }
  if (current.state === 'En curso') timer = requestAnimationFrame(advance);
}

function start() {
  if (busy || connecting.size || !ready() || current?.state === 'En curso') return;
  if (current?.state === 'En pausa') {
    current.state = 'En curso';
    event('state','Reanudada');
  } else {
    const kind = el('kind').value;
    const trip = el('trip').value, profile = el('profile').value;
    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,9);
    current = {id,started:Date.now(),mode:'ble',kind,trip,profile,state:'En curso',events:[]};
    sessions.set(id,current);
    if (kind === 'route') {
      const parsed = routeMap.select(trip, profile);
      route = {steps:parsed.steps,len:parsed.len,position:0,next:0};
      routeMap.showSignal(null);
      current.sides = Object.keys(links).filter(usable);
    } else if (kind === 'trial') {
      current.sequence = Array.from('LLLLLRRRRR');
      for (let i = 9; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [current.sequence[i],current.sequence[j]] = [current.sequence[j],current.sequence[i]];
      }
    }
    addHistoryOption(current);
    el('history').value = id;
    event('state','Iniciada');
  }
  message = '';
  if (current.sides?.length === 1) {
    message = 'Ruta con una sola pulsera: los giros a la ' + (current.sides[0] === 'L' ? 'derecha' : 'izquierda') + ' se muestran sin vibrar.';
  }
  previousTick = performance.now();
  el('instruction').textContent = '';
  render();
  if (current.kind === 'route') advance();
  else el('instruction').textContent = current.kind === 'manual' ? 'Elige el lado.' : 'El participante mantiene la vista fuera de la pantalla.';
}

async function manualSignal(side) {
  if (el('kind').value !== 'manual' || el('manual' + side).disabled) return;
  if (!active()) start();
  if (current?.kind !== 'manual' || current.state !== 'En curso') return;
  const entry = await emit(side, 'Botón manual');
  if (entry.result === 'Enviada') {
    manualNext[side] = performance.now() + 1900;
    setTimeout(render, 1900);
  }
  if (current.state === 'En curso') el('instruction').textContent = sides[side] + ' · ' + entry.result.toLowerCase();
  render();
}

async function trialSignal() {
  if (busy || current?.state !== 'En curso' || !ready()) return;
  if (current.events.some(e => completed(e) && !e.answer)) return;
  if (performance.now() < coolingUntil) { message = 'Espera a que termine el pulso anterior.'; render(); return; }
  message = '';
  const index = current.events.filter(e => e.answer).length;
  await emit(current.sequence[index], 'Ensayo ' + (index + 1));
}

for (const [key,t] of Object.entries(OSM_TRIPS)) el('trip').add(new Option(t.name,key));
restore();
for (const s of [...sessions.values()].sort((a,b) => a.started-b.started)) {
  if (['En curso','En pausa'].includes(s.state)) {
    // Otra pestaña puede seguir usando esta sesión. Mostrar su último registro sin reescribirlo.
    s.state = 'Último registro · sin cierre';
    for (const e of s.events) if (e.result === 'Pendiente') e.result = 'Sin confirmar';
  }
  addHistoryOption(s);
}
el('history').selectedIndex = 0;
el('history').onchange = renderHistory;
function resetPreview() {
  if (active()) return;
  current = null;
  route = null;
  routeMap.showSignal(null);
  el('instruction').textContent = '';
}
for (const id of ['trip','profile']) el(id).onchange = () => { resetPreview(); render(); };
for (const side of Object.keys(links)) {
  el('manual'+side).onclick = () => manualSignal(side);
  el('connect'+side).onclick = () => connect(side);
  el('test'+side).onclick = () => testSide(side);
  el('confirm'+side).onclick = () => {
    if (!connected(side) || !links[side].awaitingTouch) return;
    links[side].tested = true;
    links[side].awaitingTouch = false;
    message = 'Pulso confirmado en la muñeca ' + sides[side].toLowerCase() + '.';
    render();
  };
}
el('kind').onchange = () => {
  resetPreview();
  message = ''; render();
};
el('presentRoute').onclick = () => setExpanded(!el('prueba').classList.contains('expanded'));
window.addEventListener('hashchange', () => showScreen(true));
el('start').onclick = start;
el('pause').onclick = () => pause('Pausa manual.');
el('finish').onclick = () => { if (!busy && active()) finish('Finalizada'); };
el('signal').onclick = trialSignal;
el('answers').onclick = e => {
  const answer = e.target.dataset.answer;
  if (!answer || busy || current?.state !== 'En curso') return;
  const entry = current.events.find(e => completed(e) && !e.answer);
  if (!entry) return;
  entry.answer = answer;
  save(current);
  if (current.events.filter(e => e.answer).length === 10) finish('Completada');
  else render();
};
document.addEventListener('visibilitychange', () => { if (document.hidden) pause('Pausa al salir de la página.'); });
window.addEventListener('pagehide', () => pause('Página cerrada.'));
if (new URLSearchParams(location.search).get('modo') === 'manual') {
  el('kind').value = 'manual';
}
showScreen();
render();
