/* Folio — your feed, bound as a book. */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const bookEl = $('#book');
  const pageLeft = $('#pageLeft');
  const pageRight = $('#pageRight');
  const measurePage = $('#measurePage');
  const scrubber = $('#scrubber');
  const modal = $('#modal');
  const modalBody = $('#modalBody');

  const MAX_POST = 600;
  const MAX_NOTE = 280;
  const NOTE_MARKS = ['*', '†', '‡'];

  const state = {
    me: null,
    book: null, // { key, kind, username, title, ... posts }
    pages: [],
    chapters: [],
    chapterPages: [],
    cursor: 0,
    spread: true,
    size: null,
    animating: false,
    routeToken: 0,
    ribbonPost: null,
  };

  // ---------- utilities ----------

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function roman(n) {
    const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
    return out;
  }

  function timeOf(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, ' ');
  }

  function dayKey(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  function longDate(iso) {
    return new Date(iso).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function weekday(iso) {
    const d = new Date(iso);
    const today = new Date();
    const y = new Date(); y.setDate(today.getDate() - 1);
    if (dayKey(d) === dayKey(today)) return 'Today';
    if (dayKey(d) === dayKey(y)) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long' });
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body !== undefined || method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : method !== 'GET' ? '{}' : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status });
    return data;
  }

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('folio:' + k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem('folio:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  let toastTimer;
  function toast(msg, actionLabel, onAction, ms = 6000) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>`;
    if (actionLabel) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = actionLabel;
      b.onclick = () => { t.hidden = true; onAction(); };
      t.append(b);
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms);
  }

  const ICON_DOGEAR = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.5h6.5L13 5v9.5H3z" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M9.5 1.5V5H13" fill="currentColor" fill-opacity=".25" stroke="currentColor" stroke-width="1.2"/></svg>';
  const ICON_DOGEAR_ON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.5h6.5L13 5v9.5H3z" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="1.2"/><path d="M9.5 1.5V5H13z" fill="currentColor" stroke="currentColor" stroke-width="1.2"/></svg>';
  const ICON_NOTE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.5 1.8l2.7 2.7-8 8-3.4.7.7-3.4z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9.8 3.5l2.7 2.7" stroke="currentColor" stroke-width="1.2"/></svg>';

  // ---------- theme ----------

  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }
  applyTheme(store.get('theme'));

  // ---------- sizing ----------

  function computeSize() {
    const wrap = $('.book-wrap');
    const W = Math.max(200, wrap.clientWidth - 32 - 30);
    const H = Math.max(260, wrap.clientHeight - 20);
    let spread = W / 2 >= 330 && H >= 440;
    let pw, ph;
    if (spread) {
      pw = Math.min(W / 2, H * 0.72, 560);
      ph = Math.min(H, pw / 0.6);
    } else {
      pw = Math.min(W + 30, H * 0.75, 560);
      ph = Math.min(H, pw / 0.55);
    }
    pw = Math.floor(pw);
    ph = Math.floor(ph);
    const fs = Math.max(13.5, Math.min(19, pw / 25));
    return { pw, ph, fs: Math.round(fs * 10) / 10, spread };
  }

  function applySize(sz) {
    const root = document.documentElement.style;
    root.setProperty('--pw', sz.pw + 'px');
    root.setProperty('--ph', sz.ph + 'px');
    root.setProperty('--fs', sz.fs + 'px');
    state.spread = sz.spread;
    bookEl.classList.toggle('single', !sz.spread);
    state.size = sz;
  }

  // ---------- binding (pagination) ----------

  function tokenize(text) {
    return text
      .split(/(\n\n|\n)/)
      .flatMap((seg) => (seg === '\n\n' || seg === '\n' ? [seg] : seg.split(/[ \t]+/).filter(Boolean)));
  }

  function renderParas(toks, isStart, marks) {
    const paras = [[]];
    for (const t of toks) {
      if (t === '\n\n') paras.push([]);
      else paras[paras.length - 1].push(t);
    }
    const html = paras
      .filter((p) => p.length)
      .map((p, pi) => {
        let words = p.map((t) => (t === '\n' ? '<br>' : esc(t)));
        if (isStart && pi === 0) {
          let n = 0;
          while (n < Math.min(3, words.length) && words[n] !== '<br>') n++;
          if (n) words = [`<span class="lead">${words.slice(0, n).join(' ')}</span>`, ...words.slice(n)];
        }
        return words.join(' ');
      });
    if (marks && html.length) html[html.length - 1] += marks;
    return html.map((h) => `<p>${h}</p>`).join('');
  }

  function attribHTML(post) {
    const who = `— <a href="#/author/${esc(post.author.username)}">${esc(post.author.name)}</a>, <span class="when">${timeOf(post.created)}</span>`;
    return `<div class="attrib">
      <span class="who">${who}</span>
      <span class="acts">
        <button type="button" class="act${post.dogeared ? ' on' : ''}" data-action="dogear" data-id="${post.id}" title="${post.dogeared ? 'Unfold the corner' : 'Dog-ear this passage'}" aria-pressed="${post.dogeared}">${post.dogeared ? ICON_DOGEAR_ON : ICON_DOGEAR}${post.dogears || ''}</button>
        <button type="button" class="act" data-action="notes" data-id="${post.id}" title="Write in the margin">${ICON_NOTE}${post.notes.length || ''}</button>
      </span>
    </div>`;
  }

  function footnotesHTML(post) {
    if (!post.notes.length) return '';
    const shown = post.notes.slice(0, 3);
    const more = post.notes.length - shown.length;
    return `<div class="footnotes"><ol>${shown
      .map((n, i) => `<li><span class="n">${NOTE_MARKS[i]}</span><span><span class="nm">${esc(n.author.name)}:</span> ${esc(n.text)}</span></li>`)
      .join('')}</ol>${more ? `<button type="button" class="more" data-action="notes" data-id="${post.id}">…and ${more} more note${more > 1 ? 's' : ''} in the margin</button>` : ''}</div>`;
  }

  function passageHTML(post, { from, to, dropcap, end }) {
    const toks = post._toks.slice(from, to);
    const isStart = from === 0;
    const marks = end ? post.notes.slice(0, 3).map((_, i) => `<sup class="fn">${NOTE_MARKS[i]}</sup>`).join('') : '';
    const cls = ['passage'];
    if (isStart && dropcap) cls.push('dropcap');
    if (!isStart) cls.push('continued');
    return `<article class="${cls.join(' ')}" data-post="${post.id}">${renderParas(toks, isStart, marks)}${
      end ? attribHTML(post) + footnotesHTML(post) : '<span class="cont-mark">continued overleaf</span>'
    }</article>`;
  }

  function chapterLabel(ch) {
    if (ch == null) return '';
    if (ch === -1) return 'Contents';
    const c = state.chapters[ch];
    return c ? `Chapter ${roman(ch + 1)} · ${c.title}` : '';
  }

  function titlePageHTML(book) {
    const me = state.me;
    const imprint = `<div class="imprint"><span class="mark">❦</span>Folio · ${roman(new Date().getFullYear())}</div>`;
    const names = (list) => {
      const shown = list.slice(0, 10).map((u) => `<a href="#/author/${esc(u.username)}">${esc(u.name)}</a>`);
      if (list.length > 10) shown.push(`${list.length - 10} others`);
      if (shown.length < 2) return shown.join('');
      return shown.slice(0, -1).join(', ') + ' and ' + shown[shown.length - 1];
    };
    if (book.kind === 'mine') {
      if (!me) {
        return `<div class="titlepage"><div class="spacer"></div><div class="over">Folio</div><h1>A Commonplace Book</h1>
          <div class="rule"></div><div class="subtitle">Sign in and a book will be bound for you from the passages of every author on your shelf.</div>
          <button type="button" class="btn btn-ink" data-action="account">Sign in or join</button>${imprint}</div>`;
      }
      const contrib = book.contributors.filter((u) => u.username !== me.username);
      return `<div class="titlepage"><div class="spacer"></div><div class="over">Kept for ${esc(me.name)}</div>
        <h1>A Commonplace Book</h1><div class="rule"></div>
        <div class="subtitle">Passages from your shelf, bound as they are written.</div>
        ${contrib.length ? `<div class="contrib">With contributions by ${names(contrib)}</div>` : `<div class="contrib">Your shelf is empty. Visit the <a href="#/library">Library</a> to shelve some authors.</div>`}
        ${imprint}</div>`;
    }
    if (book.kind === 'commons') {
      return `<div class="titlepage"><div class="spacer"></div><div class="over">Folio</div><h1>The Commons</h1><div class="rule"></div>
        <div class="subtitle">Being the collected passages of every reader in the house.</div>
        ${book.contributors.length ? `<div class="contrib">With contributions by ${names(book.contributors)}</div>` : ''}
        ${imprint}</div>`;
    }
    const a = book.author;
    const action = a.isMe
      ? `<button type="button" class="btn btn-ink" data-action="write">✒ Write a passage</button>`
      : `<button type="button" class="btn ${a.isFollowing ? 'btn-ghost' : 'btn-ink'}" data-action="follow" data-user="${esc(a.username)}">${a.isFollowing ? 'On your shelf — remove' : 'Shelve this volume'}</button>`;
    return `<div class="titlepage"><div class="spacer"></div><div class="over">The Collected Passages of</div>
      <h1>${esc(a.name)}</h1><div class="rule"></div>
      ${a.bio ? `<div class="subtitle">${esc(a.bio)}</div>` : ''}
      <div class="stats">${a.passages} passage${a.passages === 1 ? '' : 's'} · on ${a.followers} shel${a.followers === 1 ? 'f' : 'ves'} · keeps ${a.following} author${a.following === 1 ? '' : 's'}</div>
      ${action}${imprint}</div>`;
  }

  function endpaperOwner(book) {
    if (book.kind === 'author') return book.author.name;
    if (book.kind === 'mine' && state.me) return state.me.name;
    return 'Every Reader';
  }

  function colophonHTML(book) {
    const canWrite = state.me && (book.kind !== 'author' || book.author.isMe);
    return `<div class="colophon"><span class="fin">Here the book ends — for now.</span>
      The ink is still wet. New pages are bound as they are written.<br>
      ${canWrite ? '<button type="button" class="btn btn-ink" data-action="write">✒ Add a page</button>' : ''}
      ${book.kind === 'mine' && state.me ? '<div><a href="#/library">Find more authors in the Library</a></div>' : ''}</div>`;
  }

  function bind(book) {
    const sz = computeSize();
    applySize(sz);

    const posts = book.posts;
    posts.forEach((p) => (p._toks = tokenize(p.text)));

    // chapters, one per day
    const chapters = [];
    for (const p of posts) {
      const k = dayKey(p.created);
      let c = chapters[chapters.length - 1];
      if (!c || c.key !== k) {
        c = {
          key: k,
          title: weekday(p.created),
          date: longDate(p.created),
          short: new Date(p.created).toLocaleDateString([], { month: 'short', day: 'numeric' }),
          posts: [],
        };
        chapters.push(c);
      }
      c.posts.push(p);
    }
    state.chapters = chapters;

    measurePage.innerHTML = '<div class="page-inner"><div class="running-head">Head</div><div class="page-body"></div><div class="folio-num">0</div></div>';
    const mb = $('.page-body', measurePage);
    const pages = [];
    let cur = null;

    const fits = () => mb.scrollHeight <= mb.clientHeight + 1;
    const used = () => {
      const last = mb.lastElementChild;
      if (!last) return 0;
      return last.getBoundingClientRect().bottom - mb.getBoundingClientRect().top;
    };
    const append = (html) => {
      mb.insertAdjacentHTML('beforeend', html);
      return mb.lastElementChild;
    };
    const tryAppend = (html) => {
      const el = append(html);
      if (fits()) return true;
      el.remove();
      return false;
    };
    const tryFit = (html) => {
      const el = append(html);
      const ok = fits();
      el.remove();
      return ok;
    };
    const finish = () => {
      if (cur && !cur.special) cur.html = mb.innerHTML;
      cur = null;
      mb.innerHTML = '';
    };
    const newPage = (chapter, extra = {}) => {
      finish();
      cur = { html: '', chapter, posts: [], ...extra };
      pages.push(cur);
    };
    const ensurePage = (chapter) => { if (!cur) newPage(chapter); };

    pages.push({ special: 'endpaper' });
    pages.push({ special: 'title', html: titlePageHTML(book) });

    if (!posts.length) {
      newPage(null, { noHead: true });
      const msg = book.kind === 'mine' && !state.me
        ? 'This book is waiting for a reader.'
        : book.kind === 'author'
          ? 'This volume has no passages yet.'
          : 'No one has written anything here yet.';
      append(`<div class="empty">${msg}${state.me ? '<br><button type="button" class="btn btn-ink" data-action="write">✒ Write the first page</button>' : ''}</div>`);
      finish();
    } else {
      // contents
      newPage(-1);
      append('<h2 class="toc-head">Contents</h2>');
      chapters.forEach((c, i) => {
        const html = `<button type="button" class="toc-entry" data-action="goto-ch" data-ch="${i}"><span class="r">${roman(i + 1)}.</span><span class="t">${esc(c.title)} <em>${esc(c.short)}</em></span><span class="dots"></span><span class="p">@@CH${i}@@</span></button>`;
        if (!tryAppend(html)) { newPage(-1); append(html); }
      });

      // chapters
      const chapterPages = [];
      chapters.forEach((c, ci) => {
        // A new day starts a fresh page only when the current one is mostly used.
        const free = cur ? 1 - used() / mb.clientHeight : 0;
        if (!cur || cur.chapter === -1 || free < 0.45) newPage(ci, { noHead: true });
        chapterPages[ci] = pages.length - 1;
        append(`<header class="chapter"><div class="num">Chapter ${roman(ci + 1)}</div><h2>${esc(c.title)}</h2><div class="sub">${esc(c.date)}</div><div class="orn">· · ·</div></header>`);
        c.posts.forEach((post, pi) => placePassage(post, pi === 0, ci));
      });
      state.chapterPages = chapterPages;

      function placePassage(post, dropcap, ch) {
        const n = post._toks.length;
        let from = 0;
        let guard = 0;
        while (guard++ < 50) {
          ensurePage(ch);
          const full = passageHTML(post, { from, to: n, dropcap, end: true });
          const empty = mb.childElementCount === 0;
          const freeFrac = 1 - used() / mb.clientHeight;
          if (tryAppend(full)) { cur.posts.push(post.id); return; }
          if (!empty && freeFrac < 0.3) { newPage(ch); continue; }
          // Split the passage across the page turn.
          let lo = from + 1, hi = n - 1, best = -1;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (tryFit(passageHTML(post, { from, to: mid, dropcap, end: false }))) { best = mid; lo = mid + 1; } else hi = mid - 1;
          }
          if (best !== -1 && n - best < 3 && best - 3 > from) best = n - 3; // avoid a lonely widow
          if (best === -1 || (best - from < 5 && !empty)) {
            if (empty) { append(full); cur.posts.push(post.id); return; } // cannot do better
            newPage(ch);
            continue;
          }
          append(passageHTML(post, { from, to: best, dropcap, end: false }));
          cur.posts.push(post.id);
          newPage(ch);
          from = best;
        }
      }

      // colophon
      ensurePage(chapters.length - 1);
      if (!tryAppend(colophonHTML(book))) { newPage(chapters.length - 1); append(colophonHTML(book)); }
      finish();

      // fill contents page numbers
      pages.forEach((p) => {
        if (p.html && p.html.includes('@@CH')) p.html = p.html.replace(/@@CH(\d+)@@/g, (_, i) => chapterPages[+i]);
      });
    }
    finish();
    measurePage.innerHTML = '';
    state.pages = pages;
    scrubber.max = Math.max(0, pages.length - 1);
  }

  // ---------- rendering pages ----------

  function pageInner(i) {
    const p = state.pages[i];
    const book = state.book;
    if (!p) return '<div class="page-inner"></div>';
    if (p.special === 'endpaper') {
      return `<div class="endpaper"><div class="exlibris"><div class="ex">Ex Libris</div><div class="who">${esc(endpaperOwner(book))}</div><div class="orn">❦</div></div></div>`;
    }
    if (p.special === 'title') return `<div class="page-inner"><div class="page-body">${p.html}</div></div>`;
    const head = p.noHead ? '' : i % 2 === 0 ? esc(book.title) : esc(chapterLabel(p.chapter));
    return `<div class="page-inner"><div class="running-head">${head}</div><div class="page-body">${p.html}</div><div class="folio-num">${i}</div></div>`;
  }

  function norm(i) {
    i = Math.max(0, Math.min(state.pages.length - 1, i));
    return state.spread ? i - (i % 2) : i;
  }

  function visible() {
    return state.spread ? [state.cursor, state.cursor + 1] : [state.cursor];
  }

  function render() {
    if (state.spread) {
      pageLeft.innerHTML = pageInner(state.cursor);
      pageRight.innerHTML = pageInner(state.cursor + 1);
    } else {
      pageRight.innerHTML = pageInner(state.cursor);
    }
    afterTurn();
  }

  function afterTurn() {
    const total = state.pages.length;
    scrubber.value = state.cursor;
    const [a, b] = visible();
    const info = $('#pageInfo');
    if (state.spread && b < total) info.textContent = `pp. ${a}–${b} of ${total - 1}`;
    else info.textContent = `p. ${a} of ${total - 1}`;
    const frac = total > 1 ? state.cursor / (total - 1) : 0;
    bookEl.style.setProperty('--stack-l', Math.round(frac * 14) + 'px');
    bookEl.style.setProperty('--stack-r', Math.round((1 - frac) * 14) + 'px');

    // ribbon marks where the unread pages begin
    const ribbon = $('#ribbon');
    ribbon.hidden = true;
    if (state.ribbonPost) {
      const vis = visible();
      vis.forEach((idx, k) => {
        const p = state.pages[idx];
        if (p && p.posts && p.posts.includes(state.ribbonPost)) {
          ribbon.hidden = false;
          const onRight = !state.spread || k === 1;
          ribbon.style.left = onRight ? `calc(100% - ${state.spread ? 44 : 40}px)` : '28px';
        }
      });
    }
    saveBookmark();
  }

  function turnTo(target, animate = true) {
    if (state.animating) return;
    target = norm(target);
    if (target === state.cursor) return;
    const dir = target > state.cursor ? 1 : -1;
    const adjacent = Math.abs(target - state.cursor) === (state.spread ? 2 : 1);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || !adjacent || reduce) {
      state.cursor = target;
      render();
      return;
    }
    state.animating = true;
    const old = state.cursor;
    const leaf = document.createElement('div');
    let finalRotate;
    const face = (side, cls, html) => `<div class="page face ${side} ${cls}">${html}</div>`;

    if (state.spread) {
      if (dir > 0) {
        leaf.className = 'leaf fwd';
        leaf.innerHTML = face('front', 'as-right', pageInner(old + 1)) + face('back', 'as-left', pageInner(target)) + '<div class="shade"></div>';
        pageRight.innerHTML = pageInner(target + 1);
        finalRotate = 'rotateY(-180deg)';
      } else {
        leaf.className = 'leaf back-turn';
        leaf.innerHTML = face('front', 'as-left', pageInner(old)) + face('back', 'as-right', pageInner(target + 1)) + '<div class="shade"></div>';
        pageLeft.innerHTML = pageInner(target);
        finalRotate = 'rotateY(180deg)';
      }
    } else {
      leaf.className = 'leaf fwd';
      if (dir > 0) {
        leaf.innerHTML = face('front', 'as-right', pageInner(old)) + face('back', 'as-left', '') + '<div class="shade"></div>';
        pageRight.innerHTML = pageInner(target);
        finalRotate = 'rotateY(-180deg)';
      } else {
        leaf.innerHTML = face('front', 'as-right', pageInner(target)) + face('back', 'as-left', '') + '<div class="shade"></div>';
        leaf.style.transition = 'none';
        leaf.style.transform = 'rotateY(-180deg)';
        finalRotate = 'rotateY(0deg)';
      }
    }
    bookEl.append(leaf);
    leaf.getBoundingClientRect(); // reflow so the transition runs
    leaf.style.transition = '';
    requestAnimationFrame(() => {
      leaf.classList.add('turning');
      leaf.style.transform = finalRotate;
    });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      state.cursor = target;
      if (state.spread) {
        pageLeft.innerHTML = pageInner(target);
        pageRight.innerHTML = pageInner(target + 1);
      } else {
        pageRight.innerHTML = pageInner(target);
      }
      leaf.remove();
      state.animating = false;
      afterTurn();
    };
    leaf.addEventListener('transitionend', (e) => { if (e.propertyName === 'transform') finish(); });
    setTimeout(finish, 1100);
  }

  function step(dir) {
    turnTo(state.cursor + dir * (state.spread ? 2 : 1));
  }

  function pageOfPost(id) {
    const i = state.pages.findIndex((p) => p.posts && p.posts.includes(id));
    return i < 0 ? null : i;
  }

  function anchorPost() {
    for (const i of visible()) {
      const p = state.pages[i];
      if (p && p.posts && p.posts.length) return p.posts[0];
    }
    return null;
  }

  // ---------- bookmarks ----------

  function saveBookmark() {
    const b = state.book;
    if (!b) return;
    const newest = b.posts.length ? b.posts[b.posts.length - 1] : null;
    const prev = store.get('bm:' + b.key) || {};
    store.set('bm:' + b.key, {
      post: anchorPost(),
      cursor: state.cursor,
      // only move "seen" forward once the reader has actually reached the newest page
      seen: newest && pageOfPost(newest.id) != null && visible().includes(pageOfPost(newest.id))
        ? newest.created
        : prev.seen || null,
    });
  }

  // ---------- loading books ----------

  async function loadBook(kind, username, opts = {}) {
    const token = ++state.routeToken;
    let posts = [];
    let author = null;
    try {
      if (kind === 'mine') {
        if (state.me) posts = (await api('GET', '/api/book/mine')).posts;
      } else if (kind === 'commons') {
        posts = (await api('GET', '/api/book/commons')).posts;
      } else {
        const data = await api('GET', '/api/users/' + encodeURIComponent(username));
        posts = data.posts;
        author = data.author;
      }
    } catch (err) {
      if (token !== state.routeToken) return;
      toast(err.message);
      if (kind === 'author') location.hash = '#/library';
      return;
    }
    if (token !== state.routeToken) return;

    const seenAuthors = new Map();
    posts.forEach((p) => seenAuthors.set(p.author.username, p.author));
    const book = {
      kind,
      username,
      author,
      posts,
      key: kind === 'author' ? 'author:' + username : kind + (state.me ? ':' + state.me.username : ''),
      title: kind === 'mine' ? 'A Commonplace Book' : kind === 'commons' ? 'The Commons' : author.name,
      contributors: [...seenAuthors.values()],
    };
    const prevBook = state.book;
    const keep = opts.keepPlace && prevBook && prevBook.key === book.key ? anchorPost() : null;
    const keepCursor = state.cursor;
    state.book = book;

    showView('book');
    bind(book);

    const bm = store.get('bm:' + book.key);
    // where do unread pages begin?
    state.ribbonPost = null;
    let firstNew = null;
    if (bm && bm.seen) {
      firstNew = posts.find((p) => p.created > bm.seen && (!state.me || p.author.username !== state.me.username));
      if (firstNew) state.ribbonPost = firstNew.id;
    }

    let target;
    if (opts.gotoPost && pageOfPost(opts.gotoPost) != null) target = pageOfPost(opts.gotoPost);
    else if (opts.keepPlace && keep && pageOfPost(keep) != null) target = pageOfPost(keep);
    else if (opts.keepPlace && prevBook && prevBook.key === book.key) target = keepCursor;
    else if (bm && bm.post && pageOfPost(bm.post) != null) target = pageOfPost(bm.post);
    else if (bm && bm.cursor != null) target = bm.cursor;
    else target = state.spread ? 0 : 1;
    state.cursor = norm(target);
    render();

    if (firstNew && !opts.keepPlace && !opts.gotoPost) {
      const count = posts.filter((p) => p.created > bm.seen).length;
      const firstPage = pageOfPost(firstNew.id);
      if (firstPage != null && !visible().includes(firstPage)) {
        toast(`${count} new passage${count > 1 ? 's' : ''} bound since you last read.`, 'Turn to them', () => turnTo(firstPage, false), 9000);
      }
    }
  }

  async function rebind(opts = { keepPlace: true }) {
    const b = state.book;
    if (!b) return;
    await loadBook(b.kind, b.username, opts);
  }

  // ---------- library ----------

  const SPINES = ['#5a2e2a', '#2f4a3a', '#2b3d5c', '#6b4a24', '#4a2f4f', '#3c3c3c', '#7a3b22', '#24524f', '#5c5a2a', '#47302a'];
  function spineColor(name) {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return SPINES[h % SPINES.length];
  }

  async function loadLibrary() {
    const token = ++state.routeToken;
    showView('library');
    const view = $('#libraryView');
    let users;
    try {
      users = (await api('GET', '/api/users')).users;
    } catch (err) {
      toast(err.message);
      return;
    }
    if (token !== state.routeToken) return;
    const spine = (u) => {
      const h = 170 + Math.min(u.passages * 7, 90);
      return `<button type="button" class="spine${u.isMe ? ' mine' : ''}" style="--spine:${spineColor(u.username)};--h:${h}px" data-action="open-author" data-user="${esc(u.username)}" title="${esc(u.name)} — ${u.passages} passages">
        <span class="bands"></span><span class="title">${esc(u.name)}</span><span class="mark">❦</span></button>`;
    };
    const mine = users.filter((u) => u.isMe);
    const shelved = users.filter((u) => u.isFollowing);
    const stacks = users.filter((u) => !u.isFollowing && !u.isMe);
    const card = (u) => `<div class="card">
      <a class="nm" href="#/author/${esc(u.username)}">${esc(u.name)}</a>
      <div class="un">@${esc(u.username)}</div>
      <div class="bio">${esc(u.bio || 'No bookplate inscription.')}</div>
      <div class="row"><span>${u.passages} passage${u.passages === 1 ? '' : 's'} · on ${u.followers} shel${u.followers === 1 ? 'f' : 'ves'}</span>
      ${u.isMe ? '<span><em>you</em></span>' : `<button type="button" class="btn ${u.isFollowing ? 'btn-ghost' : 'btn-ink'}" data-action="follow" data-user="${esc(u.username)}">${u.isFollowing ? 'Unshelve' : 'Shelve'}</button>`}</div>
    </div>`;
    view.innerHTML = `<div class="library-inner">
      <h1>The Library</h1>
      <p class="lede">Every author here keeps a volume. Shelve the ones you love, and their passages will be bound into your book.</p>
      ${mine.length ? `<div class="shelf-label">Your own volume</div><div class="shelf">${mine.map(spine).join('')}</div>` : ''}
      ${state.me ? `<div class="shelf-label">On your shelf</div><div class="shelf">${shelved.length ? shelved.map(spine).join('') : '<span class="none">Nothing shelved yet.</span>'}</div>` : ''}
      <div class="shelf-label">${state.me ? 'The stacks' : 'All volumes'}</div><div class="shelf">${(state.me ? stacks : users).map(spine).join('') || '<span class="none">You have shelved every volume in the house.</span>'}</div>
      <div class="authors">${users.map(card).join('')}</div>
    </div>`;
  }

  // ---------- views & routing ----------

  function showView(v) {
    $('#bookView').hidden = v !== 'book';
    $('#libraryView').hidden = v !== 'library';
  }

  function setNav(name) {
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
  }

  function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    const [a, b] = parts;
    if (!a) {
      location.replace(state.me ? '#/mine' : '#/commons');
      return;
    }
    if (a === 'library') { setNav('library'); loadLibrary(); return; }
    if (a === 'author' && b) {
      setNav('');
      loadBook('author', decodeURIComponent(b));
      return;
    }
    if (a === 'mine') { setNav('mine'); loadBook('mine'); return; }
    setNav('commons');
    loadBook('commons');
  }

  // ---------- modals ----------

  function openModal(html, onOpen) {
    modalBody.innerHTML = html;
    if (!modal.open) modal.showModal();
    if (onOpen) onOpen(modalBody);
  }
  function closeModal() { if (modal.open) modal.close(); }
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  function requireAuth() {
    if (state.me) return true;
    openAuth('signin', 'You’ll need a library card for that.');
    return false;
  }

  function openAuth(mode = 'signin', note) {
    const signup = mode === 'signup';
    openModal(`
      <h2>${signup ? 'Join the library' : 'Welcome back'}</h2>
      <p class="hint">${esc(note || (signup ? 'Choose a pen name. Your passages will be bound under it.' : 'Sign in to open your own book.'))}</p>
      <form id="authForm" autocomplete="on">
        <label class="field"><span>Pen name</span><input name="username" required autocomplete="username" pattern="[A-Za-z0-9_]{3,20}" maxlength="20" placeholder="e.g. marguerite"></label>
        ${signup ? '<label class="field"><span>Name on the spine</span><input name="name" maxlength="40" placeholder="Marguerite Vale"></label>' : ''}
        <label class="field"><span>Password</span><input name="password" type="password" required minlength="6" autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
        <p class="error" id="authErr"></p>
        <div class="modal-foot">
          <button type="button" class="switch" id="authSwitch">${signup ? 'Already have a card? Sign in' : 'New here? Join the library'}</button>
          <button class="btn btn-ink" type="submit">${signup ? 'Join' : 'Sign in'}</button>
        </div>
      </form>
      <p class="demo">To look around, sign in as <strong>guest</strong> with the password <strong>reader</strong>.</p>`,
    (root) => {
      $('input', root).focus();
      $('#authSwitch', root).onclick = () => openAuth(signup ? 'signin' : 'signup');
      $('#authForm', root).onsubmit = async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target));
        const btn = $('button[type=submit]', e.target);
        btn.disabled = true;
        try {
          const { user } = await api('POST', signup ? '/api/signup' : '/api/login', fd);
          setMe(user);
          closeModal();
          toast(signup ? `Welcome, ${user.name}. Your book has been bound.` : `Welcome back, ${user.name}.`);
          if (location.hash === '#/mine') route();
          else location.hash = '#/mine';
        } catch (err) {
          $('#authErr', root).textContent = err.message;
          btn.disabled = false;
        }
      };
    });
  }

  function openAccount() {
    if (!state.me) return openAuth();
    const me = state.me;
    const theme = store.get('theme') || 'auto';
    openModal(`
      <h2>Your bookplate</h2>
      <p class="hint">@${esc(me.username)} · ${me.passages} passage${me.passages === 1 ? '' : 's'} · on ${me.followers} shel${me.followers === 1 ? 'f' : 'ves'}</p>
      <form id="plateForm">
        <label class="field"><span>Name on the spine</span><input name="name" maxlength="40" value="${esc(me.name)}"></label>
        <label class="field"><span>Inscription</span><textarea name="bio" maxlength="160" rows="2">${esc(me.bio)}</textarea></label>
        <label class="field"><span>Reading light</span>
          <select name="theme" class="field-select">
            <option value="auto"${theme === 'auto' ? ' selected' : ''}>Follow my device</option>
            <option value="light"${theme === 'light' ? ' selected' : ''}>Daylight</option>
            <option value="dark"${theme === 'dark' ? ' selected' : ''}>Lamplight</option>
          </select>
        </label>
        <p class="error" id="plateErr"></p>
        <div class="modal-foot">
          <span><a href="#/author/${esc(me.username)}" id="myVol">Open your volume</a> · <button type="button" class="switch" id="signOut">Sign out</button></span>
          <button class="btn btn-ink" type="submit">Save</button>
        </div>
      </form>`,
    (root) => {
      $('select', root).onchange = (e) => {
        store.set('theme', e.target.value);
        applyTheme(e.target.value);
      };
      $('#myVol', root).onclick = () => closeModal();
      $('#signOut', root).onclick = async () => {
        await api('POST', '/api/logout');
        setMe(null);
        closeModal();
        toast('You have left the library. Come back soon.');
        location.hash = '#/commons';
        route();
      };
      $('#plateForm', root).onsubmit = async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target));
        try {
          const { user } = await api('PATCH', '/api/me', { name: fd.name, bio: fd.bio });
          setMe(user);
          closeModal();
          toast('Bookplate updated.');
          if (state.book && !$('#bookView').hidden) rebind();
        } catch (err) {
          $('#plateErr', root).textContent = err.message;
        }
      };
    });
  }

  function openWrite() {
    if (!requireAuth()) return;
    const draft = store.get('draft') || '';
    openModal(`
      <h2>A new page</h2>
      <p class="hint">It will be bound into today’s chapter, in every book that keeps you on its shelf.</p>
      <form id="writeForm">
        <textarea class="manuscript" name="text" maxlength="${MAX_POST}" placeholder="Begin here…" aria-label="Your passage">${esc(draft)}</textarea>
        <p class="error" id="writeErr"></p>
        <div class="modal-foot">
          <span class="count" id="writeCount"></span>
          <button class="btn btn-ink" type="submit">Bind it into the book</button>
        </div>
      </form>`,
    (root) => {
      const ta = $('textarea', root);
      const count = $('#writeCount', root);
      const upd = () => {
        count.textContent = `${ta.value.length} / ${MAX_POST}`;
        count.classList.toggle('over', ta.value.length >= MAX_POST);
        store.set('draft', ta.value);
      };
      upd();
      ta.addEventListener('input', upd);
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#writeForm', root).requestSubmit(); });
      $('#writeForm', root).onsubmit = async (e) => {
        e.preventDefault();
        const btn = $('button[type=submit]', e.target);
        btn.disabled = true;
        try {
          const { post } = await api('POST', '/api/posts', { text: ta.value });
          store.set('draft', '');
          closeModal();
          state.me.passages++;
          const b = state.book;
          const showsMine = b && !$('#bookView').hidden && (b.kind !== 'author' || b.author.isMe);
          if (showsMine) await loadBook(b.kind, b.username, { gotoPost: post.id });
          else {
            location.hash = '#/mine';
            await new Promise((r) => setTimeout(r, 0));
            await loadBook('mine', undefined, { gotoPost: post.id });
          }
          toast('Your page has been bound. The ink is still wet.');
        } catch (err) {
          $('#writeErr', root).textContent = err.message;
          btn.disabled = false;
        }
      };
    });
  }

  function findPost(id) {
    return state.book && state.book.posts.find((p) => p.id === id);
  }

  function openNotes(id) {
    const post = findPost(id);
    if (!post) return;
    const mine = state.me && state.me.username === post.author.username;
    const list = post.notes.length
      ? `<ol class="notes-list">${post.notes.map((n) => `<li><a class="nm" href="#/author/${esc(n.author.username)}">${esc(n.author.name)}</a>: ${esc(n.text)}<div class="meta">${esc(longDate(n.created))}, ${timeOf(n.created)}</div></li>`).join('')}</ol>`
      : '<p class="hint">The margins are still clean.</p>';
    openModal(`
      <h2>In the margin</h2>
      <blockquote class="quote">${esc(post.text)}</blockquote>
      <div class="quote-by">— ${esc(post.author.name)}, ${esc(longDate(post.created))}</div>
      ${list}
      ${state.me ? `<form id="noteForm">
        <textarea class="manuscript small" name="text" maxlength="${MAX_NOTE}" placeholder="Write a note in the margin…" aria-label="Your note"></textarea>
        <p class="error" id="noteErr"></p>
        <div class="modal-foot">
          ${mine ? '<button type="button" class="danger" id="tearOut">Tear out this page</button>' : '<span class="count" id="noteCount"></span>'}
          <button class="btn btn-ink" type="submit">Add note</button>
        </div></form>` : '<button type="button" class="btn btn-ink" data-action="account">Sign in to annotate</button>'}`,
    (root) => {
      const form = $('#noteForm', root);
      if (!form) return;
      const ta = $('textarea', form);
      const count = $('#noteCount', root);
      if (count) {
        const upd = () => (count.textContent = `${ta.value.length} / ${MAX_NOTE}`);
        upd();
        ta.addEventListener('input', upd);
      }
      const tear = $('#tearOut', root);
      if (tear) tear.onclick = async () => {
        if (!confirm('Tear this page out of every book it is bound in? This cannot be undone.')) return;
        await api('DELETE', '/api/posts/' + id);
        state.me.passages--;
        closeModal();
        toast('The page has been torn out.');
        rebind();
      };
      form.onsubmit = async (e) => {
        e.preventDefault();
        try {
          const { post: updated } = await api('POST', `/api/posts/${id}/notes`, { text: ta.value });
          Object.assign(post, updated);
          await rebind();
          openNotes(id);
        } catch (err) {
          $('#noteErr', root).textContent = err.message;
        }
      };
    });
  }

  // ---------- actions ----------

  function setMe(user) {
    state.me = user;
    const btn = $('#accountBtn');
    btn.textContent = user ? user.name : 'Sign in';
    btn.title = user ? 'Your bookplate' : 'Sign in or join';
  }

  async function toggleDogear(id) {
    if (!requireAuth()) return;
    const post = findPost(id);
    try {
      const { post: updated } = await api('POST', `/api/posts/${id}/dogear`);
      if (post) Object.assign(post, updated, { _toks: post._toks });
      rerenderInPlace();
    } catch (err) { toast(err.message); }
  }

  // Re-bind without moving: used after small edits that don't change layout much.
  function rerenderInPlace() {
    const anchor = anchorPost();
    const cursor = state.cursor;
    bind(state.book);
    const p = anchor ? pageOfPost(anchor) : null;
    state.cursor = norm(p != null ? p : cursor);
    render();
  }

  async function toggleFollow(username) {
    if (!requireAuth()) return;
    try {
      const { author } = await api('POST', `/api/users/${encodeURIComponent(username)}/follow`);
      toast(author.isFollowing ? `${author.name} is now on your shelf.` : `${author.name} has been returned to the stacks.`);
      if (!$('#libraryView').hidden) loadLibrary();
      else rebind();
    } catch (err) { toast(err.message); }
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    switch (a) {
      case 'prev': step(-1); break;
      case 'next': step(1); break;
      case 'write': openWrite(); break;
      case 'account': openAccount(); break;
      case 'contents': if (state.pages.length > 2) turnTo(2, Math.abs(state.cursor - 2) <= 2); break;
      case 'latest': turnTo(state.pages.length - 1, false); break;
      case 'goto-ch': turnTo(state.chapterPages[+el.dataset.ch], false); break;
      case 'dogear': toggleDogear(el.dataset.id); break;
      case 'notes': openNotes(el.dataset.id); break;
      case 'follow': toggleFollow(el.dataset.user); break;
      case 'open-author': location.hash = '#/author/' + encodeURIComponent(el.dataset.user); break;
      default: return;
    }
    e.preventDefault();
  });

  document.addEventListener('keydown', (e) => {
    if (modal.open || $('#bookView').hidden) return;
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { step(1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { step(-1); e.preventDefault(); }
    else if (e.key === 'Home') turnTo(0, false);
    else if (e.key === 'End') turnTo(state.pages.length - 1, false);
  });

  // swipe to turn
  let swipe = null;
  bookEl.addEventListener('pointerdown', (e) => { swipe = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  bookEl.addEventListener('pointerup', (e) => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - swipe.t < 800) step(dx < 0 ? 1 : -1);
    swipe = null;
  });

  scrubber.addEventListener('input', () => {
    const v = norm(+scrubber.value);
    const total = state.pages.length - 1;
    $('#pageInfo').textContent = state.spread ? `pp. ${v}–${Math.min(v + 1, total)} of ${total}` : `p. ${v} of ${total}`;
  });
  scrubber.addEventListener('change', () => turnTo(+scrubber.value, false));

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!state.book || $('#bookView').hidden) return;
      const sz = computeSize();
      const old = state.size;
      if (old && sz.pw === old.pw && sz.ph === old.ph && sz.spread === old.spread) return;
      rerenderInPlace();
    }, 150);
  });

  window.addEventListener('hashchange', () => { closeModal(); route(); });

  // Check for new pages now and then.
  setInterval(async () => {
    const b = state.book;
    if (!b || document.hidden || $('#bookView').hidden || modal.open || state.animating) return;
    if (b.kind === 'mine' && !state.me) return;
    try {
      const url = b.kind === 'author' ? '/api/users/' + encodeURIComponent(b.username) : '/api/book/' + b.kind;
      const { posts } = await api('GET', url);
      const known = new Set(b.posts.map((p) => p.id));
      const fresh = posts.filter((p) => !known.has(p.id));
      if (fresh.length && state.book === b) {
        toast(`${fresh.length} new page${fresh.length > 1 ? 's have' : ' has'} been written.`, 'Bind them in', () => loadBook(b.kind, b.username, { gotoPost: fresh[0].id }), 12000);
      }
    } catch { /* offline — try later */ }
  }, 45000);

  // ---------- start ----------

  async function start() {
    try {
      const { user } = await api('GET', '/api/me');
      setMe(user);
    } catch { setMe(null); }
    if (document.fonts && document.fonts.ready) {
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
    }
    route();
    // Fonts that arrive late change the measure; re-bind once if so.
    if (document.fonts) document.fonts.addEventListener('loadingdone', () => { if (state.book && !$('#bookView').hidden && !state.animating) rerenderInPlace(); }, { once: true });
  }
  start();
})();
