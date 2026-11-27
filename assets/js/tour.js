// tour.js - shared guided-tour module. No page templates need changes.
// Usage (in editor.js):  import { initTour } from './tour.js';
//                        import steps from './tour-steps.js';
//                        initTour({ steps });
// Steps live in tour-steps.js, so the engine never needs editing.

const CSS = `
.tour-blocker{position:fixed;inset:0;z-index:10000;}
.tour-spot{position:fixed;z-index:10001;pointer-events:none;border-radius:8px;
  box-shadow:0 0 0 9999px rgba(20,16,10,.62);transition:all .25s ease;}
.tour-spot.tour-none{box-shadow:none;width:0;height:0;}
.tour-dim{position:fixed;inset:0;z-index:10001;background:rgba(20,16,10,.62);pointer-events:none;}
.tour-pop{position:fixed;z-index:10002;width:min(340px,calc(100vw - 24px));background:#fff;color:#2b2620;
  border-radius:12px;padding:16px 18px 14px;box-shadow:0 12px 40px rgba(0,0,0,.3);
  font:15px/1.5 system-ui,sans-serif;}
.tour-pop h3{margin:0 0 6px;font-size:17px;}
.tour-pop p{margin:0 0 14px;}
.tour-foot{display:flex;align-items:center;gap:8px;}
.tour-count{flex:1;font-size:12px;color:#8a8175;}
.tour-pop button{font:inherit;font-size:14px;padding:7px 14px;border-radius:8px;cursor:pointer;
  border:1px solid #cfc7ba;background:#fff;color:#2b2620;}
.tour-pop button.tour-primary{background:#2b2620;color:#fff;border-color:#2b2620;}
.tour-pop button.tour-skip{border:0;background:none;color:#8a8175;padding:7px 4px;}
.tour-reopen{position:fixed;right:16px;bottom:16px;z-index:9000;font:600 14px system-ui,sans-serif;
  padding:9px 14px;border-radius:999px;border:1px solid #cfc7ba;background:#fff;color:#2b2620;
  cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.15);}
.tour-reopen:hover{background:#f6f1e8;}
@media (prefers-reduced-motion:reduce){.tour-spot{transition:none;}}
`;

const isVisible = (el) => !!el && el.getClientRects().length > 0;
const find = (sel) => {
  if (!sel) return null;
  for (const s of [].concat(sel)) {          // selector or list of fallbacks
    for (const el of document.querySelectorAll(s)) if (isVisible(el)) return el; // first VISIBLE match
  }
  return null;
};
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

export function initTour({
  steps,
  storageKey = 'invStudioTour.v1',   // bump the version to re-show after big changes
  autoStart = true,
  button = true,                     // true = floating button, or { mount: '#some-selector', label: '? Tour' }
  padding = 6,
  settle = 500,                      // extra ms after the page looks ready
} = {}) {
  if (!steps?.length) return null;

  if (!document.getElementById('tour-css')) {
    const st = document.createElement('style');
    st.id = 'tour-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  let blocker, spot, dim, pop, active = [], idx = 0, lastFocus = null;

  function start() {
    if (blocker) return;
    // Keep only steps whose target exists right now (centered steps have no target).
    active = steps.filter((s) => !s.target || find(s.target) || s.before);
    if (!active.length) return;
    lastFocus = document.activeElement;
    blocker = el('div', 'tour-blocker');
    spot = el('div', 'tour-spot');
    dim = el('div', 'tour-dim');
    pop = el('div', 'tour-pop');
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'true');
    pop.setAttribute('aria-live', 'polite');
    document.body.append(blocker, dim, spot, pop);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('keydown', onKey, true);
    idx = 0;
    show();
  }

  function leave() { try { active[idx]?.after?.(); } catch {} }   // undo what a step's before() did
  function go(d) { leave(); idx += d; show(); }

  function end(markSeen = true) {
    if (!blocker) return;
    leave();
    [blocker, spot, dim, pop].forEach((n) => n.remove());
    blocker = spot = dim = pop = null;
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
    document.removeEventListener('keydown', onKey, true);
    if (markSeen) store.set(storageKey, 'done');
    lastFocus?.focus?.();
  }

  function el(tag, cls) { const n = document.createElement(tag); n.className = cls; return n; }

  function show() {
    const step = active[idx];
    try { step.before?.(); } catch {}
    // Let the page react to before() (e.g. opening an Advanced panel), then draw.
    requestAnimationFrame(() => {
      const target = find(step.target);
      if (step.target && !target) {            // target vanished: skip forward
        if (idx < active.length - 1) return go(1);
      }
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const last = idx === active.length - 1;
      pop.innerHTML = '';
      const h = document.createElement('h3'); h.textContent = step.title || '';
      const p = document.createElement('p'); p.textContent = step.body || '';
      const foot = el('div', 'tour-foot');
      const count = el('span', 'tour-count'); count.textContent = `${idx + 1} of ${active.length}`;
      const skip = btn('Skip', 'tour-skip', () => end());
      const back = btn('Back', '', () => go(-1));
      const next = btn(last ? 'Done' : 'Next', 'tour-primary', () => (last ? end() : go(1)));
      back.disabled = idx === 0;
      if (idx === 0) back.style.visibility = 'hidden';
      foot.append(count, ...(last ? [] : [skip]), back, next);
      pop.append(h, p, foot);
      next.focus();
      setTimeout(place, target ? 320 : 0);     // after smooth scroll settles
      place();
    });
  }

  function btn(label, cls, fn) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; if (cls) b.className = cls;
    b.addEventListener('click', fn);
    return b;
  }

  function place() {
    if (!pop) return;
    const step = active[idx];
    const target = find(step.target);
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!target) {                              // centered modal
      spot.className = 'tour-spot tour-none';
      dim.style.display = '';
      pop.style.left = Math.max(12, (vw - pop.offsetWidth) / 2) + 'px';
      pop.style.top = Math.max(12, (vh - pop.offsetHeight) / 2) + 'px';
      return;
    }
    dim.style.display = 'none';                 // spotlight's shadow does the dimming
    const r = target.getBoundingClientRect();
    spot.className = 'tour-spot';
    Object.assign(spot.style, {
      left: r.left - padding + 'px', top: r.top - padding + 'px',
      width: r.width + padding * 2 + 'px', height: r.height + padding * 2 + 'px',
    });
    const pw = pop.offsetWidth, ph = pop.offsetHeight, gap = 14;
    const below = r.bottom + gap + ph <= vh - 8;
    const above = r.top - gap - ph >= 8;
    let top = below ? r.bottom + gap : above ? r.top - gap - ph : Math.max(12, vh - ph - 12);
    let left = Math.min(Math.max(12, r.left + r.width / 2 - pw / 2), vw - pw - 12);
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); end(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      if (e.target.tagName === 'BUTTON' && e.key === 'Enter') return; // let the focused button act
      e.preventDefault(); idx < active.length - 1 ? go(1) : end();
    } else if (e.key === 'ArrowLeft' && idx > 0) { e.preventDefault(); go(-1); }
  }

  // Reopen button
  let reopen = null;
  if (button) {
    reopen = document.createElement('button');
    reopen.type = 'button';
    reopen.className = 'tour-reopen';
    reopen.textContent = (button.label) || 'Take the tour';
    reopen.setAttribute('aria-label', 'Open the guided tour');
    reopen.addEventListener('click', start);
    const mount = button.mount && document.querySelector(button.mount);
    if (mount) { reopen.classList.remove('tour-reopen'); reopen.classList.add('tour-reopen-inline'); mount.appendChild(reopen); }
    else document.body.appendChild(reopen);
  }

  // Auto-start: wait until the page has finished building (each step may declare a
  // waitFor selector or function), plus a short settle, but never longer than maxWait.
  const isReady = (w) => { try { return typeof w === 'function' ? !!w() : !!document.querySelector(w); } catch { return false; } };
  function whenReady(maxWait = 10000) {
    const waits = steps.map((s) => s.waitFor).filter(Boolean);
    const t0 = Date.now();
    return new Promise((resolve) => {
      (function poll() {
        if (waits.every(isReady) || Date.now() - t0 > maxWait) setTimeout(resolve, settle);
        else setTimeout(poll, 150);
      })();
    });
  }
  if (autoStart && !store.get(storageKey)) whenReady().then(() => { if (!store.get(storageKey)) start(); });

  return { start, end, destroy() { end(false); reopen?.remove(); } };
}
