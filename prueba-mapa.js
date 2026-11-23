'use strict';

// La distancia acumulada de prepRoute gobierna tanto los avisos como el dibujo.
function createRouteMap() {
  const get = id => document.getElementById(id);
  const svg = get('routeMap');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let model, cacheKey, points, lengths;
  let position = 0, lastPaint = -Infinity, maneuver = -1, signal;
  const arrows = {L: '↰', R: '↱', U: '↶'};
  const names = {L: 'Izquierda', R: 'Derecha', U: 'Vuelta'};
  function put(id, value) {
    if (get(id).textContent !== value) get(id).textContent = value;
  }

  function frame(distance) {
    const cum = model.cum;
    let i = 1;
    while (i < cum.length - 1 && cum[i] <= distance) i++;
    const t = (distance - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    return {x: ax + (bx - ax) * t, y: ay + (by - ay) * t,
      angle: Math.atan2(bx - ax, ay - by) * 180 / Math.PI,
      length: lengths[i - 1] + (lengths[i] - lengths[i - 1]) * t};
  }

  function paint(distance, force = false) {
    position = Math.max(0, Math.min(model.len, distance));
    if (!points) return;
    const now = performance.now();
    if (!force && reduced.matches && now - lastPaint < 1000) return;
    lastPaint = now;
    const p = frame(position);
    get('mapRider').setAttribute('transform', 'translate(' + p.x + ' ' + p.y + ')');
    get('mapHeading').setAttribute('transform', 'rotate(' + p.angle + ')');
    get('mapDone').style.strokeDasharray = p.length + ' ' + (lengths.at(-1) + 1);
    get('mapDone').style.visibility = position ? 'visible' : 'hidden';
    get('routeProgress').value = position / model.len * 100;
    put('travelled', km(position));
    const next = model.steps.findIndex(step => step.at > position);
    const step = model.steps[next];
    const arrived = position >= model.len;
    const cue = arrived ? 'Destino alcanzado' : step ? names[step.side] + ' en ' + Math.ceil((step.at - position) / 10) * 10 + ' m' : 'Continúa hasta el destino';
    put('turnText', cue);
    put('turnArrow', arrived ? '✓' : step ? arrows[step.side] : '↑');
    put('cueLabel', step ? step.name || 'Próximo giro' : 'Llegada');
    if (next !== maneuver || force) {
      maneuver = next;
      svg.setAttribute('aria-label', get('tripTitle').textContent + '. ' + cue);
    }
  }

  function fit() {
    if (!model || !svg.clientWidth || !svg.clientHeight) return;
    const w = svg.clientWidth, h = svg.clientHeight;
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    const [lon, lat] = model.g[0];
    const cos = Math.cos(lat * Math.PI / 180);
    const xy = model.g.map(([x,y]) => [(x - lon) * cos, lat - y]);
    const xs = xy.map(p => p[0]), ys = xy.map(p => p[1]);
    const left = Math.min(...xs), top = Math.min(...ys);
    const dx = Math.max(...xs) - left, dy = Math.max(...ys) - top;
    const scale = Math.min((w - 70) / (dx || 1e-9), (h - 50) / (dy || 1e-9));
    const screenX = x => (w - dx * scale) / 2 + (x - left) * scale;
    const screenY = y => (h - dy * scale) / 2 + (y - top) * scale;
    points = xy.map(([x,y]) => [screenX(x), screenY(y)]);
    // Extensión geográfica de la imagen de calles, derivada de las teselas locales de Santiago.
    const west = -70.695, east = -70.565, north = -33.412, south = -33.486;
    const streets = get('mapStreets');
    streets.setAttribute('x', screenX((west - lon) * cos));
    streets.setAttribute('y', screenY(lat - north));
    streets.setAttribute('width', (east - west) * cos * scale);
    streets.setAttribute('height', (north - south) * scale);
    lengths = [0];
    points.slice(1).forEach(([x,y],i) => lengths.push(lengths[i] + Math.hypot(x - points[i][0], y - points[i][1])));
    const path = 'M' + points.map(p => p.join(' ')).join(' L');
    get('mapTrack').setAttribute('d', path);
    get('mapDone').setAttribute('d', path);
    const dots = model.steps.map(step => {
      const p = frame(step.at);
      const dot = document.createElementNS(svg.namespaceURI, 'circle');
      dot.setAttribute('cx', p.x);
      dot.setAttribute('cy', p.y);
      dot.setAttribute('r', 3.3);
      dot.setAttribute('fill', '#e6eaff');
      dot.setAttribute('stroke', '#334365');
      return dot;
    });
    get('mapTurns').replaceChildren(...dots);
    get('mapEnd').setAttribute('transform','translate(' + points.at(-1).join(' ') + ')');
    for (const [id, [x,y]] of [['originLabel', points[0]], ['endLabel', points.at(-1)]]) {
      get(id).setAttribute('x', x);
      get(id).setAttribute('y', y - 14);
      get(id).setAttribute('text-anchor', 'middle');
    }
    paint(position, true);
  }

  function select(trip, profile) {
    const key = trip + '_' + profile;
    if (key !== cacheKey) {
      cacheKey = key;
      model = prepRoute(OSM_CACHE[key]);
      model.steps = model.steps.filter(s => s.side);
      position = 0;
      put('tripTitle', OSM_TRIPS[trip].name);
      put('mapTitle', 'Ruta de ' + OSM_TRIPS[trip].name);
      put('totalDistance', km(model.len));
      put('turnCount', String(model.steps.length));
      fit();
    }
    return model;
  }

  function showSignal(entry, targets = []) {
    if (entry === signal) return;
    signal = entry;
    for (const side of ['L','R']) {
      const wrist = get('wrist' + side);
      wrist.classList.remove('lit');
      if (targets.includes(side)) {
        // Dos giros seguidos al mismo lado también producen dos secuencias visuales.
        void wrist.offsetWidth;
        wrist.classList.add('lit');
      }
    }
    put('pulseResult', entry ? (names[entry.side] + ' · ' + entry.result.toLowerCase()) : 'Sin avisos');
  }
  new ResizeObserver(fit).observe(svg);
  return {select, paint, showSignal};
}
