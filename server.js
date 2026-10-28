const express = require('express'), http = require('http'), { Server } = require('socket.io');
const app = express(), srv = http.createServer(app), io = new Server(srv);
app.use(express.static('public'));

const rooms = {}, R = 6371000, rad = x => x * Math.PI / 180;
const TAG_RANGE = 50, MAX_ACC = 40, STALE = 30000;
const validToken = token => typeof token === 'string' && /^[a-z0-9]{8,64}$/i.test(token);
const cleanName = name => typeof name === 'string' ? name.trim().slice(0, 16) : '';
const dist = (a, b) => {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const bearing = (a, b) => {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};
const fresh = p => p.pos && Date.now() - p.pos.t < STALE;
const pub = r => ({
  code: r.code, phase: r.phase, host: r.host, phaseEnd: r.phaseEnd, zone: r.zone, winner: r.winner,
  players: Object.values(r.players).map(p => ({ id: p.id, name: p.name, role: p.role, caught: p.caught, online: p.online, tags: p.tags }))
});
const push = r => io.to(r.code).emit('state', pub(r));
const uncaughtRunners = r => Object.values(r.players).filter(p => p.role === 'runner' && !p.caught);
function checkEnd(r) {
  if (r.phase !== 'hunt') return;
  if (!uncaughtRunners(r).length) { r.phase = 'ended'; r.winner = 'hunters'; push(r); }
}

io.on('connection', sock => {
  const room = () => rooms[sock.data.code];
  const me = () => room()?.players[sock.data.token];
  const isHost = () => room() && room().host === sock.data.token;
  const err = m => sock.emit('err', m);

  sock.on('create', payload => {
    const name = cleanName(payload?.name), token = payload?.token;
    if (!name) return err('Enter a name before hosting a game.');
    if (!validToken(token)) return err('Unable to create a room. Refresh and try again.');
    let code; do { code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random() * 24 | 0]).join(''); } while (rooms[code]);
    rooms[code] = { code, host: token, phase: 'lobby', players: Object.create(null), zone: null, phaseEnd: 0, winner: null, created: Date.now() };
    sock.emit('created', code);
  });
  sock.on('join', payload => {
    const code = typeof payload?.code === 'string' ? payload.code.toUpperCase().trim() : '';
    const name = cleanName(payload?.name), token = payload?.token;
    if (!validToken(token)) return err('Unable to join. Refresh the page and try again.');
    const r = rooms[code];
    if (!r) return err('Room not found. Check the code.');
    const previousRoom = room(), previousPlayer = me();
    if (previousRoom && previousRoom.code !== code) {
      sock.leave(previousRoom.code);
      if (previousPlayer?.sid === sock.id) {
        previousPlayer.online = false;
        previousPlayer.sid = null;
      }
      push(previousRoom);
    }
    let p = r.players[token];
    if (!p) {
      if (r.phase !== 'lobby') return err('Game already started.');
      if (!name) return err('Enter a name.');
      p = r.players[token] = { id: token, name, role: 'runner', caught: false, tags: 0, pos: null };
    }
    p.online = true; p.sid = sock.id;
    sock.data = { code, token }; sock.join(code); push(r);
  });
  sock.on('leave', () => {
    const r = room(), p = me();
    if (p?.sid === sock.id) {
      p.online = false;
      p.sid = null;
    }
    if (r) {
      sock.leave(r.code);
      push(r);
    }
    sock.data = {};
  });
  sock.on('setRole', ({ id, role }) => {
    const r = room(); if (!isHost() || r.phase !== 'lobby' || !r.players[id]) return;
    r.players[id].role = role === 'hunter' ? 'hunter' : 'runner'; push(r);
  });
  sock.on('randomize', n => {
    const r = room(); if (!isHost() || r.phase !== 'lobby') return;
    const ps = Object.values(r.players).sort(() => Math.random() - .5);
    const requested = Number(n);
    if (!Number.isInteger(requested) || requested < 1) return err('Choose at least one hunter.');
    ps.forEach((p, i) => p.role = i < Math.max(1, Math.min(requested, ps.length - 1)) ? 'hunter' : 'runner'); push(r);
  });
  sock.on('setZone', radius => {
    const r = room(), p = me(); if (!isHost() || r.phase !== 'lobby') return;
    if (!p.pos) return err('Host location not available yet. Allow GPS.');
    if (!Number.isInteger(radius) || radius < 50 || radius > 3000) return err('Zone radius must be between 50 and 3,000 metres.');
    r.zone = { lat: p.pos.lat, lon: p.pos.lon, r: radius }; push(r);
  });
  sock.on('start', payload => {
    const r = room(); if (!isHost() || r.phase !== 'lobby') return;
    const ps = Object.values(r.players);
    if (!ps.some(p => p.role === 'hunter') || !ps.some(p => p.role === 'runner')) return err('Need at least 1 hunter and 1 runner.');
    const head = Number(payload?.head), hunt = Number(payload?.hunt);
    if (!Number.isInteger(head) || head < 0 || head > 60 || !Number.isInteger(hunt) || hunt < 1 || hunt > 180) {
      return err('Head start must be 0–60 minutes and hunt duration 1–180 minutes.');
    }
    r.headMs = head * 60000; r.huntMs = hunt * 60000;
    r.phase = r.headMs ? 'head' : 'hunt'; r.phaseEnd = Date.now() + (r.headMs || r.huntMs); push(r);
  });
  sock.on('end', () => { const r = room(); if (!isHost() || r.phase === 'ended') return; r.phase = 'ended'; r.winner = 'host'; push(r); });
  sock.on('kick', id => {
    const r = room(); if (!isHost() || id === r.host) return;
    const p = r.players[id]; if (!p) return;
    if (p.sid) {
      const target = io.sockets.sockets.get(p.sid);
      if (target) { target.emit('kicked'); target.leave(r.code); target.data = {}; }
    }
    delete r.players[id]; push(r); checkEnd(r);
  });
  sock.on('loc', payload => {
    const { lat, lon, acc } = payload || {};
    const p = me(); if (!p || typeof lat !== 'number' || typeof lon !== 'number') return;
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) return;
    p.pos = { lat, lon, acc: Number.isFinite(acc) && acc >= 0 ? acc : 99, t: Date.now() };
  });
  sock.on('tag', () => {
    const r = room(), p = me();
    if (!r || !p || r.phase !== 'hunt' || p.role !== 'hunter' || !fresh(p)) return err('Cannot tag now.');
    if (p.pos.acc > MAX_ACC) return err('GPS too weak (' + Math.round(p.pos.acc) + ' m). Move to open sky.');
    let best = null, bd = 1e9;
    uncaughtRunners(r).filter(fresh).forEach(q => { const d = dist(p.pos, q.pos); if (d < bd) { bd = d; best = q; } });
    if (!best || bd > TAG_RANGE) return sock.emit('toast', 'Missed. Nobody within ' + TAG_RANGE + ' m.');
    best.caught = true; p.tags++;
    io.to(best.sid).emit('toast', 'You were tagged by ' + p.name + '!');
    io.to(r.code).emit('toast', p.name + ' tagged ' + best.name);
    checkEnd(r); push(r);
  });
  sock.on('disconnect', () => { const p = me(); if (p && p.sid === sock.id) { p.online = false; push(room()); } });
});

setInterval(() => {
  const now = Date.now();
  for (const r of Object.values(rooms)) {
    if (now - r.created > 6 * 3600e3) { delete rooms[r.code]; continue; }
    if (r.phase === 'head' && now >= r.phaseEnd) { r.phase = 'hunt'; r.phaseEnd = now + r.huntMs; push(r); }
    else if (r.phase === 'hunt' && now >= r.phaseEnd) { r.phase = 'ended'; r.winner = 'runners'; push(r); }
    const hunters = Object.values(r.players).filter(p => p.role === 'hunter' && fresh(p));
    for (const p of Object.values(r.players)) {
      if (!p.sid || !p.online) continue;
      const m = { outside: false, radar: null, danger: false };
      if (r.zone && fresh(p)) m.outside = dist(p.pos, r.zone) > r.zone.r;
      if (r.phase === 'hunt' && fresh(p)) {
        if (p.role === 'hunter') {
          let best = null, bd = 1e9;
          uncaughtRunners(r).filter(fresh).forEach(q => { const d = dist(p.pos, q.pos); if (d < bd) { bd = d; best = q; } });
          if (best) m.radar = { d: Math.round(bd / 5) * 5, b: Math.round(bearing(p.pos, best.pos)) };
        } else if (!p.caught) m.danger = hunters.some(h => dist(h.pos, p.pos) < 40);
      }
      io.to(p.sid).emit('me', m);
    }
  }
}, 2000);

srv.listen(process.env.PORT || 3000, () => console.log('Campus Hunt running'));
