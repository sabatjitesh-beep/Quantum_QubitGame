'use strict';
// Quantum Traitor: public multiplayer server. No dependencies, Node 18+.
// Serves the game page, streams updates over Server-Sent Events (/events)
// and receives player actions over POST (/act). Roles never leave the server.
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const PORT = +process.env.PORT || 3000;
const findIndex = () => [path.join(__dirname, 'public', 'index.html'), path.join(__dirname, 'index.html')].find(f => fs.existsSync(f));
process.on('uncaughtException', e => console.error('Unhandled error (server kept running):', e));
process.on('unhandledRejection', e => console.error('Unhandled rejection (server kept running):', e));
const AV = ['🧑‍🚀', '👩‍🔬', '🤖', '🦊', '🐙', '👾'];
const BN = ['Nova', 'Kai', 'Zed', 'Mira', 'Rex', 'Ada'];
const rooms = new Map();
const rnd = n => Math.floor(Math.random() * n);
const sh = a => [...a].sort(() => Math.random() - 0.5);
const uid = () => Math.random().toString(36).slice(2, 10);
const clean = (s, n) => String(s == null ? '' : s)
  .replace(/[\u0000-\u001f\u007f<>&"'`\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '').trim().slice(0, n);
const send = (res, ev, data) => { try { res.write('event: ' + ev + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch (e) {} };

// ---------- rooms ----------
function newRoom(code) {
  const R = { code, host: null, players: new Map(), G: null, chat: [], gid: 0, ts: Date.now() };
  rooms.set(code, R); return R;
}
const online = R => [...R.players.values()].filter(p => p.res);
function bcLobby(R) {
  const ps = [...R.players.values()];
  online(R).forEach(p => send(p.res, 'lobby', {
    code: R.code, you: p.u, host: R.host,
    players: ps.map((x, i) => ({ u: x.u, n: x.n, e: AV[i % 6] }))
  }));
}
// What one player may see. Pids and the traitor seat are never included.
function view(R, p) {
  const G = R.G, me = G.pl.findIndex(x => x.pid === p.pid);
  return {
    me, tr: me >= 0 && me === G.tr, it: me >= 0 && me === G.tr ? G.it : null,
    S: {
      id: G.id, ph: G.ph, rd: G.rd, tl: Math.max(0, G.dl - Date.now()), ov: G.ov, lg: G.lg,
      pl: G.pl.map(x => ({ i: x.i, n: x.n, e: x.e, h: !!x.pid, a: x.a, s: Math.round(x.s * 10) / 10 })),
      rt: G.rt.map(r => ({ s: r.s, r: r.r, d: r.d, n: r.n, er: r.er, b: r.b }))
    }
  };
}
const bc = R => { if (R.G) online(R).forEach(p => send(p.res, 'state', view(R, p))); };

// ---------- game engine ----------
function startGame(R) {
  const hs = sh([...R.players.values()]).slice(0, 6), seats = sh([0, 1, 2, 3, 4, 5]);
  const pl = Array.from({ length: 6 }, (_, i) => ({ i, n: BN[i], e: AV[i], pid: 0, a: 1, s: 0 }));
  hs.forEach((p, k) => { const s = pl[seats[k]]; s.n = p.n; s.pid = p.pid; });
  R.gid++;
  R.G = { id: R.gid, ph: 'tap', rd: 1, it: 0, ov: null, dl: 0, tr: rnd(6), pl, rt: [], votes: {}, lv: null,
    lg: [[-1, 'One traitor is tapping our quantum links.']] };
  hround(R);
}
function hround(R) {
  const G = R.G, a = G.pl.filter(p => p.a), tr = G.pl[G.tr], tk = rnd(3), pool = a.filter(p => p !== tr);
  G.rt = [0, 1, 2].map(k => {
    const r = k === tk ? tr : pool[rnd(pool.length)], [s, d] = sh(a.filter(p => p !== r));
    return { s: s.i, r: r.i, d: d.i, n: 0, er: 0, b: 0 };
  });
  G.ph = 'tap'; G.lv = null; G.votes = {}; G.dl = Date.now() + (tr.pid ? 20000 : 1500); bc(R);
}
function hcheck(R, lv) {
  const G = R.G; lv = [0, 1, 2].includes(lv) ? lv : 1; G.it += [0, 1, 3][lv];
  const N = i => G.pl[i].n;
  G.rt.forEach(r => {
    const q = .04 + (r.r === G.tr ? .25 * [0, .3, 1][lv] : 0); let b = 0, e = 0;
    for (let i = 0; i < 16; i++) if (Math.random() < q) { b |= 1 << i; e++; }
    r.b = b; r.n = 16; r.er = e;
    [[r.r, 1], [r.s, .3], [r.d, .3]].forEach(([i, w]) => { const y = G.pl[i]; y.s = Math.max(0, y.s + (e - 1.2) * w); });
    if (e >= 3) {
      const c = sh(G.pl.filter(y => y.a && !y.pid && y.i !== r.r))[0];
      if (c) G.lg.push([c.i, e + '/16 errors on ' + N(r.s) + '→' + N(r.r) + '→' + N(r.d) + '. That relay looks shady.']);
    } else G.lg.push([-1, N(r.s) + '→' + N(r.r) + '→' + N(r.d) + ': ' + e + '/16 errors. Clean.']);
  });
  G.lg = G.lg.slice(-9);
  if (G.it >= 10) return hend(R, 't', 'The traitor stole 10 data.');
  G.ph = 'vote'; G.dl = Date.now() + 30000; G.votes = {}; bc(R);
}
function hvote(R) {
  const G = R.G, al = G.pl.filter(p => p.a), tl = {}, c = k => tl[k] = (tl[k] || 0) + 1;
  al.forEach(b => {
    if (b.pid) { const v = G.votes[b.i]; c(v != null && v !== 's' && G.pl[v] && G.pl[v].a && v !== b.i ? v : 's'); }
    else if (b.i === G.tr) c(sh(al.filter(p => p !== b))[0].i);
    else {
      const y = al.filter(p => p !== b).map(p => [p, p.s + Math.random() * 1.5]).sort((x, z) => z[1] - x[1])[0];
      c(y[1] > 1.2 ? y[0].i : 's');
    }
  });
  const mx = Math.max(...Object.values(tl)), top = sh(Object.keys(tl).filter(k => tl[k] === mx))[0];
  G.lg.push([-1, 'Votes: ' + Object.entries(tl).map(([k, v]) => (k === 's' ? 'Skip' : G.pl[k].n) + ' ' + v).join(', ')]);
  if (top !== 's') {
    const p = G.pl[+top]; p.a = 0;
    if (+top === G.tr) return hend(R, 'a', p.n + ' was the traitor.');
    G.lg.push([-1, p.n + ' was innocent.']);
  }
  if (G.pl.filter(p => p.a).length <= 3 || G.rd >= 5) return hend(R, 't', G.pl[G.tr].n + ' survived.');
  G.rd++; G.pl.forEach(p => p.s *= .7); G.lg = G.lg.slice(-9); hround(R);
}
function hend(R, w, m) { const G = R.G; G.ov = { w, m, tr: G.tr }; G.ph = 'over'; G.lg = G.lg.slice(-9); bc(R); }
function tick(R) {
  const G = R.G; if (!G || G.ph === 'over') return; const now = Date.now();
  if (G.ph === 'tap') {
    const tr = G.pl[G.tr], hp = tr.pid && R.players.get(tr.pid), ok = hp && hp.res && G.lv != null;
    if (now < G.dl && !ok) return;
    hcheck(R, G.lv != null ? G.lv : (tr.pid ? 1 : (Math.random() < .8 ? 1 + rnd(2) : 0)));
  } else if (G.ph === 'vote') {
    const wait = G.pl.some(p => { if (!p.a || !p.pid) return false; const h = R.players.get(p.pid); return h && h.res && G.votes[p.i] == null; });
    if (now < G.dl && wait) return;
    hvote(R);
  }
}

// ---------- player actions ----------
function act(R, p, b) {
  const G = R.G, seat = G ? G.pl.findIndex(x => x.pid === p.pid) : -1;
  switch (b.a) {
    case 'start': if (R.host === p.u && (!G || G.ph === 'over')) startGame(R); break;
    case 'tap': if (G && G.ph === 'tap' && seat === G.tr && [0, 1, 2].includes(b.l)) G.lv = b.l; break;
    case 'vote':
      if (G && G.ph === 'vote' && seat >= 0 && G.pl[seat].a && G.votes[seat] == null &&
        (b.t === 's' || (Number.isInteger(b.t) && G.pl[b.t] && G.pl[b.t].a && b.t !== seat))) G.votes[seat] = b.t;
      break;
    case 'chat': {
      const t = clean(b.t, 140), now = Date.now();
      if (t && now - (p.lc || 0) > 500) {
        p.lc = now;
        const m = { u: p.u, n: p.n, e: seat >= 0 ? AV[seat] : '👀', t };
        R.chat.push(m); R.chat = R.chat.slice(-60);
        online(R).forEach(x => send(x.res, 'chat', m));
      }
      break;
    }
  }
}

// ---------- http ----------
const hits = new Map();
setInterval(() => hits.clear(), 10000);
function limited(req, kind, max) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const k = kind + ip, n = (hits.get(k) || 0) + 1; hits.set(k, n); return n > max;
}
function problem(res, m) { send(res, 'problem', { m }); res.end(); }
function events(req, res, u) {
  if (limited(req, 'e', 40)) { res.writeHead(429); return res.end('Too many requests'); }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
  const code = clean(u.searchParams.get('room'), 4).toLowerCase(), pid = clean(u.searchParams.get('pid'), 60);
  const create = u.searchParams.get('create') === '1', name = clean(u.searchParams.get('n'), 12) || 'Player';
  if (!/^[a-z0-9]{4}$/.test(code) || pid.length < 8) return problem(res, 'Invalid room code.');
  let R = rooms.get(code), p = R && R.players.get(pid);
  if (!R) {
    if (!create) return problem(res, 'No room with that code. Check it with your host.');
    if (rooms.size >= 300) return problem(res, 'Server is busy. Try again later.');
    R = newRoom(code);
  } else if (create && !p) return problem(res, 'That code is taken. Try hosting again.');
  if (!p) {
    if (R.players.size >= 6) return problem(res, 'Room is full (6 players).');
    if (R.G && R.G.ph !== 'over') return problem(res, 'That game has already started.');
    p = { pid, u: uid(), n: name, res: null, lc: 0 }; R.players.set(pid, p);
  } else if (p.res) { try { p.res.end(); } catch (e) {} }
  p.res = res; R.ts = Date.now();
  if (!R.host || ![...R.players.values()].some(x => x.u === R.host)) R.host = p.u;
  bcLobby(R);
  if (R.chat.length) send(res, 'hist', R.chat);
  if (R.G) send(res, 'state', view(R, p));
  req.on('close', () => {
    if (p.res !== res) return;
    p.res = null; R.ts = Date.now();
    if (!R.G || R.G.ph === 'over') R.players.delete(pid);
    if (R.host === p.u) { const nx = online(R)[0]; R.host = nx ? nx.u : null; }
    bcLobby(R);
  });
}
function post(req, res) {
  if (limited(req, 'a', 120)) { res.writeHead(429); return res.end(); }
  let body = '';
  req.on('data', d => { body += d; if (body.length > 2048) req.destroy(); });
  req.on('end', () => {
    try {
      const b = JSON.parse(body), R = rooms.get(clean(b.room, 4).toLowerCase()), p = R && R.players.get(clean(b.pid, 60));
      if (!p) { res.writeHead(404); return res.end(); }
      R.ts = Date.now(); act(R, p, b); res.writeHead(204); res.end();
    } catch (e) { res.writeHead(400); res.end(); }
  });
}
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:";
const server = http.createServer((req, res) => {
  req.on('error', () => {}); res.on('error', () => {});
  const u = new URL(req.url, 'http://x');
  if ((req.method === 'GET' || req.method === 'HEAD') && (u.pathname === '/' || u.pathname === '/index.html')) {
    return fs.readFile(findIndex() || '', (e, d) => {
      if (e) { res.writeHead(500, { 'Content-Type': 'text/plain' }); return res.end('index.html not found. Keep the "public" folder (with index.html inside) next to server.js.'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP });
      res.end(req.method === 'HEAD' ? undefined : d);
    });
  }
  if (u.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (u.pathname === '/events' && req.method === 'GET') return events(req, res, u);
  if (u.pathname === '/act' && req.method === 'POST') return post(req, res);
  res.writeHead(404); res.end('Not found');
});
setInterval(() => rooms.forEach(tick), 500);
setInterval(() => rooms.forEach(R => online(R).forEach(p => { try { p.res.write(': ping\n\n'); } catch (e) {} })), 15000);
setInterval(() => rooms.forEach((R, c) => { if (!online(R).length && Date.now() - R.ts > 10 * 60 * 1000) rooms.delete(c); }), 60000);
server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error('Port ' + PORT + ' is already in use. Close the other program, or run with a different port, for example: PORT=3001 node server.js');
  else console.error('Server error:', e.message);
  process.exit(1);
});
server.listen(PORT, '0.0.0.0', () => {
  console.log('Quantum Traitor is running.');
  console.log('  On this computer:  http://localhost:' + PORT);
  Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal)
    .forEach(i => console.log('  On your network:   http://' + i.address + ':' + PORT));
  if (!findIndex()) console.error('WARNING: public/index.html was not found. Keep the public folder next to server.js.');
});
