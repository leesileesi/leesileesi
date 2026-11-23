// Folio — a social network where your feed is a book.
// Zero dependencies: run with `node server.js`.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.FOLIO_DATA || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_POST = 600;
const MAX_NOTE = 280;

// ---------- storage ----------

let db;

function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } else {
    db = require('./seed')(hashPassword);
    saveDb();
  }
}

let saveTimer = null;
function saveDb() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, DB_FILE);
  }, 50);
}

function id() {
  return crypto.randomBytes(8).toString('hex');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

// ---------- helpers ----------

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 20000) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function currentUser(req) {
  const token = parseCookies(req).folio_session;
  if (!token) return null;
  const session = db.sessions[token];
  if (!session) return null;
  return db.users.find((u) => u.id === session.userId) || null;
}

function publicUser(u, viewer) {
  return {
    username: u.username,
    name: u.name,
    bio: u.bio || '',
    joined: u.joined,
    followers: db.users.filter((x) => x.following.includes(u.id)).length,
    following: u.following.length,
    passages: db.posts.filter((p) => p.authorId === u.id).length,
    isFollowing: viewer ? viewer.following.includes(u.id) : false,
    isMe: viewer ? viewer.id === u.id : false,
  };
}

function publicPost(p, viewer) {
  const author = db.users.find((u) => u.id === p.authorId);
  return {
    id: p.id,
    text: p.text,
    created: p.created,
    author: { username: author.username, name: author.name },
    dogears: p.dogears.length,
    dogeared: viewer ? p.dogears.includes(viewer.id) : false,
    notes: p.notes.map((n) => {
      const a = db.users.find((u) => u.id === n.authorId);
      return { id: n.id, text: n.text, created: n.created, author: { username: a.username, name: a.name } };
    }),
  };
}

function cleanText(s, max) {
  if (typeof s !== 'string') return '';
  return s.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

// ---------- API ----------

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp(
    '^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$'
  );
  routes.push({ method, re, keys, handler });
}

route('GET', '/api/me', (req, res, { user }) => {
  send(res, 200, { user: user ? publicUser(user, user) : null });
});

route('POST', '/api/signup', async (req, res) => {
  const body = await readBody(req);
  const username = String(body.username || '').trim().toLowerCase();
  const name = cleanText(body.name, 40) || username;
  const password = String(body.password || '');
  if (!/^[a-z0-9_]{3,20}$/.test(username))
    return send(res, 400, { error: 'Pen names must be 3–20 letters, numbers or underscores.' });
  if (password.length < 6) return send(res, 400, { error: 'Passwords need at least 6 characters.' });
  if (db.users.some((u) => u.username === username))
    return send(res, 409, { error: 'That pen name is already taken.' });
  const user = {
    id: id(),
    username,
    name,
    bio: cleanText(body.bio, 160),
    password: hashPassword(password),
    joined: new Date().toISOString(),
    following: [],
  };
  // New readers start with a few authors on their shelf so their book isn't blank.
  user.following = db.users.slice(0, 4).map((u) => u.id);
  db.users.push(user);
  startSession(res, user, 201);
});

route('POST', '/api/login', async (req, res) => {
  const body = await readBody(req);
  const user = db.users.find((u) => u.username === String(body.username || '').trim().toLowerCase());
  if (!user || !checkPassword(String(body.password || ''), user.password))
    return send(res, 401, { error: 'That pen name and password don’t match.' });
  startSession(res, user, 200);
});

function startSession(res, user, status) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { userId: user.id, created: Date.now() };
  saveDb();
  send(res, status, { user: publicUser(user, user) }, {
    'Set-Cookie': `folio_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`,
  });
}

route('POST', '/api/logout', (req, res) => {
  const token = parseCookies(req).folio_session;
  if (token) delete db.sessions[token];
  saveDb();
  send(res, 200, { ok: true }, { 'Set-Cookie': 'folio_session=; HttpOnly; Path=/; Max-Age=0' });
});

route('PATCH', '/api/me', async (req, res, { user }) => {
  if (!user) return send(res, 401, { error: 'Sign in first.' });
  const body = await readBody(req);
  if (body.name !== undefined) user.name = cleanText(body.name, 40) || user.username;
  if (body.bio !== undefined) user.bio = cleanText(body.bio, 160);
  saveDb();
  send(res, 200, { user: publicUser(user, user) });
});

// The two books: "mine" (you + everyone on your shelf) and "commons" (everyone).
route('GET', '/api/book/:kind', (req, res, { user, params }) => {
  let posts = db.posts;
  if (params.kind === 'mine') {
    if (!user) return send(res, 401, { error: 'Sign in to read your book.' });
    const ids = new Set([user.id, ...user.following]);
    posts = posts.filter((p) => ids.has(p.authorId));
  } else if (params.kind !== 'commons') {
    return send(res, 404, { error: 'No such book.' });
  }
  posts = posts.slice(-300);
  send(res, 200, { posts: posts.map((p) => publicPost(p, user)) });
});

route('GET', '/api/users', (req, res, { user }) => {
  send(res, 200, { users: db.users.map((u) => publicUser(u, user)) });
});

route('GET', '/api/users/:username', (req, res, { user, params }) => {
  const author = db.users.find((u) => u.username === params.username.toLowerCase());
  if (!author) return send(res, 404, { error: 'No author by that name.' });
  const posts = db.posts.filter((p) => p.authorId === author.id).slice(-300);
  send(res, 200, { author: publicUser(author, user), posts: posts.map((p) => publicPost(p, user)) });
});

route('POST', '/api/users/:username/follow', (req, res, { user, params }) => {
  if (!user) return send(res, 401, { error: 'Sign in first.' });
  const author = db.users.find((u) => u.username === params.username.toLowerCase());
  if (!author) return send(res, 404, { error: 'No author by that name.' });
  if (author.id === user.id) return send(res, 400, { error: 'You are always on your own shelf.' });
  const i = user.following.indexOf(author.id);
  if (i >= 0) user.following.splice(i, 1);
  else user.following.push(author.id);
  saveDb();
  send(res, 200, { author: publicUser(author, user) });
});

route('POST', '/api/posts', async (req, res, { user }) => {
  if (!user) return send(res, 401, { error: 'Sign in to write.' });
  const body = await readBody(req);
  const text = cleanText(body.text, MAX_POST);
  if (!text) return send(res, 400, { error: 'A blank page says nothing.' });
  const post = { id: id(), authorId: user.id, text, created: new Date().toISOString(), dogears: [], notes: [] };
  db.posts.push(post);
  saveDb();
  send(res, 201, { post: publicPost(post, user) });
});

route('DELETE', '/api/posts/:id', (req, res, { user, params }) => {
  if (!user) return send(res, 401, { error: 'Sign in first.' });
  const i = db.posts.findIndex((p) => p.id === params.id);
  if (i < 0) return send(res, 404, { error: 'No such passage.' });
  if (db.posts[i].authorId !== user.id) return send(res, 403, { error: 'Only the author can tear out a page.' });
  db.posts.splice(i, 1);
  saveDb();
  send(res, 200, { ok: true });
});

route('POST', '/api/posts/:id/dogear', (req, res, { user, params }) => {
  if (!user) return send(res, 401, { error: 'Sign in first.' });
  const post = db.posts.find((p) => p.id === params.id);
  if (!post) return send(res, 404, { error: 'No such passage.' });
  const i = post.dogears.indexOf(user.id);
  if (i >= 0) post.dogears.splice(i, 1);
  else post.dogears.push(user.id);
  saveDb();
  send(res, 200, { post: publicPost(post, user) });
});

route('POST', '/api/posts/:id/notes', async (req, res, { user, params }) => {
  if (!user) return send(res, 401, { error: 'Sign in to annotate.' });
  const post = db.posts.find((p) => p.id === params.id);
  if (!post) return send(res, 404, { error: 'No such passage.' });
  const body = await readBody(req);
  const text = cleanText(body.text, MAX_NOTE).replace(/\n+/g, ' ');
  if (!text) return send(res, 400, { error: 'An empty margin note?' });
  post.notes.push({ id: id(), authorId: user.id, text, created: new Date().toISOString() });
  saveDb();
  send(res, 201, { post: publicPost(post, user) });
});

// ---------- static ----------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'Forbidden' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // SPA fallback
    file = path.join(PUBLIC_DIR, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith('/api/')) {
    // Basic CSRF guard: state-changing requests must be JSON from our own page.
    if (req.method !== 'GET' && !(req.headers['content-type'] || '').includes('application/json'))
      return send(res, 415, { error: 'Expected JSON.' });
    for (const r of routes) {
      const m = r.method === req.method && pathname.match(r.re);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = m[i + 1]));
      try {
        await r.handler(req, res, { user: currentUser(req), params });
      } catch (err) {
        send(res, 400, { error: err.message || 'Something went wrong.' });
      }
      return;
    }
    return send(res, 404, { error: 'Not found' });
  }
  serveStatic(req, res, pathname);
});

loadDb();
if (require.main === module) {
  server.listen(PORT, () => console.log(`Folio is open at http://localhost:${PORT}`));
}
module.exports = server;
