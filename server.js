// Pop Quiz Party: zero-dependency multiplayer trivia server (Node 18+)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const rooms = new Map();
const rid = () => crypto.randomBytes(8).toString('hex');
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const newCode = () => { let c; do { c = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random() * 24 | 0]).join(''); } while (rooms.has(c)); return c; };
const clean = (s, n) => String(s || '').trim().slice(0, n);

function newRoom() {
  const r = { code: newCode(), token: rid(), qs: [], players: new Map(), clients: new Set(), status: 'idle',
    cur: null, t0: 0, limit: 20, deck: [], timer: null, seen: Date.now(), feed: [] };
  rooms.set(r.code, r); return r;
}
const say = (r, o) => { r.feed.push(o); if (r.feed.length > 40) r.feed.shift(); };
function addPlayer(r, name) {
  const id = rid(); r.players.set(id, { name: clean(name, 20) || 'Player', score: 0, got: 0, on: 0 }); return id;
}
function view(r, host, pid) {
  const q = r.cur != null ? r.qs.find(x => x.id === r.cur) : null;
  const o = {
    code: r.code, status: r.status, limit: r.limit, count: r.qs.length, host, me: pid, feed: r.feed,
    left: r.status === 'q' ? Math.max(0, r.limit * 1000 - (Date.now() - r.t0)) : 0,
    q: q ? { p: q.p, img: q.buf ? `/img/${r.code}/${q.id}` : null } : null,
    answer: r.status === 'reveal' && q ? q.a[0] : null,
    players: [...r.players.entries()].map(([id, p]) => ({ id, name: p.name, score: p.score, got: p.got, on: p.on > 0 }))
  };
  if (host) o.qs = r.qs.map(x => ({ id: x.id, p: x.p, a: x.a, img: !!x.buf }));
  return o;
}
function push(r) {
  for (const c of r.clients) c.res.write(`data: ${JSON.stringify(view(r, c.host, c.pid))}\n\n`);
}
function reveal(r) {
  if (r.status !== 'q') return;
  clearTimeout(r.timer); r.status = 'reveal'; say(r, { s: 'Round over' }); push(r);
}
function nextQ(r) {
  if (!r.qs.length) return;
  if (!r.deck.length) { r.deck = r.qs.map(q => q.id); for (let i = r.deck.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [r.deck[i], r.deck[j]] = [r.deck[j], r.deck[i]]; } }
  r.cur = r.deck.pop(); r.status = 'q'; r.t0 = Date.now();
  for (const p of r.players.values()) p.got = 0;
  say(r, { s: 'New question!' });
  clearTimeout(r.timer); r.timer = setTimeout(() => reveal(r), r.limit * 1000); push(r);
}

const body = req => new Promise((ok, no) => {
  let n = 0; const b = [];
  req.on('data', d => { n += d.length; if (n > 4e6) { no(new Error('Too large')); req.destroy(); } else b.push(d); });
  req.on('end', () => { try { ok(JSON.parse(Buffer.concat(b).toString() || '{}')); } catch (e) { no(new Error('Bad JSON')); } });
});
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

const actions = {
  add(r, b) {
    if (r.qs.length >= 200) throw new Error('Question limit reached (200)');
    const a = (Array.isArray(b.a) ? b.a : []).map(s => clean(s, 80)).filter(Boolean).slice(0, 10);
    const p = clean(b.p, 300);
    if (!a.length) throw new Error('Add at least one accepted answer');
    const q = { id: rid().slice(0, 8), p, a };
    if (b.image) {
      const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(b.image);
      if (!m) throw new Error('Unsupported image');
      q.type = m[1]; q.buf = Buffer.from(m[2], 'base64');
      if (q.buf.length > 3e6) throw new Error('Image too big');
    } else if (!p) throw new Error('Add a prompt');
    r.qs.push(q); r.deck = []; push(r);
  },
  del(r, b) { r.qs = r.qs.filter(q => q.id !== b.id); r.deck = []; push(r); },
  next(r) { nextQ(r); },
  reveal(r) { reveal(r); },
  limit(r, b) { r.limit = Math.min(60, Math.max(5, parseInt(b.n, 10) || 20)); push(r); },
  reset(r) { clearTimeout(r.timer); r.status = 'idle'; r.cur = null; for (const p of r.players.values()) { p.score = 0; p.got = 0; } push(r); }
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && u.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
    }
    if (req.method === 'GET' && u.pathname.startsWith('/img/')) {
      const [, , code, id] = u.pathname.split('/'); const r = rooms.get(code); const q = r && r.qs.find(x => x.id === id);
      if (!q || !q.buf) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': q.type, 'Cache-Control': 'max-age=3600' }); return res.end(q.buf);
    }
    if (req.method === 'GET' && u.pathname === '/api/events') {
      const r = rooms.get(u.searchParams.get('code')), pid = u.searchParams.get('pid');
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      if (!r || !r.players.has(pid)) { res.write('event: gone\ndata: {}\n\n'); return res.end(); }
      const c = { res, pid, host: u.searchParams.get('token') === r.token };
      r.clients.add(c); r.players.get(pid).on++; r.seen = Date.now(); push(r);
      const hb = setInterval(() => res.write(': hb\n\n'), 20000);
      req.on('close', () => { clearInterval(hb); r.clients.delete(c); const p = r.players.get(pid); if (p) p.on--; push(r); });
      return;
    }
    if (req.method === 'POST' && u.pathname.startsWith('/api/')) {
      const b = await body(req), act = u.pathname.slice(5);
      if (act === 'create') { const r = newRoom(); const pid = addPlayer(r, b.name); return send(res, 200, { code: r.code, pid, token: r.token }); }
      const r = rooms.get(clean(b.code, 8).toUpperCase());
      if (!r) return send(res, 404, { error: 'Room not found' });
      r.seen = Date.now();
      if (act === 'join') return send(res, 200, { pid: addPlayer(r, b.name) });
      if (act === 'guess') {
        const p = r.players.get(b.pid), q = r.qs.find(x => x.id === r.cur);
        if (p && q && r.status === 'q' && !p.got && clean(b.text, 60) && !q.a.some(a => norm(a) === norm(b.text))) { say(r, { n: p.name, t: clean(b.text, 60) }); push(r); }
        else if (p && q && r.status === 'q' && !p.got && clean(b.text, 60)) {
          const el = Math.min(r.limit, (Date.now() - r.t0) / 1000);
          p.got = Math.max(10, Math.round(100 * (1 - el / r.limit))); p.score += p.got; say(r, { n: p.name, ok: p.got });
          const online = [...r.players.values()].filter(x => x.on > 0);
          if (online.length && online.every(x => x.got)) reveal(r); else push(r);
        }
        return send(res, 200, {});
      }
      if (act === 'host') {
        if (b.token !== r.token) return send(res, 403, { error: 'Not the host' });
        if (!actions[b.action]) return send(res, 400, { error: 'Unknown action' });
        actions[b.action](r, b); return send(res, 200, {});
      }
    }
    res.writeHead(404); res.end();
  } catch (e) { send(res, 400, { error: e.message }); }
});
setInterval(() => { for (const [c, r] of rooms) if (!r.clients.size && Date.now() - r.seen > 6 * 36e5) rooms.delete(c); }, 6e5);
server.listen(PORT, () => console.log('Pop Quiz Party on port ' + PORT));
