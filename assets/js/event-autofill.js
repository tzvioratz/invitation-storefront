/**
 * event-autofill.js  (shared module)
 *
 * A date picker + two time dropdowns (Kabalas Ponim, Chuppa) that auto-fill
 * every invitation field tagged with `data-autofill` in the SVG templates.
 *
 * Nothing template-specific lives here: each template says what a field
 * should contain, e.g.
 *
 *   <text data-field="card2_dateline"
 *         data-autofill="{day-en}, the {date-ordinal-words} of {month-en}">
 *   <text data-field="card2_hebdate"  data-autofill="hdate-he">
 *   <text data-field="card2_parsha"   data-autofill="parsha-he">
 *   <text data-field="card2_kabalas"  data-autofill="kabalas-en:upper">
 *
 * Values go through your existing setField(name, value), so they end up in the
 * normal wording state -> order JSON -> print page. No backend/print changes.
 */

export const VERSION = 'styles-v5';
const HEBCAL_URL = 'https://cdn.jsdelivr.net/npm/@hebcal/core@5/+esm'; // pin or vendor if you prefer
let hebcalPromise = null;
export function loadHebcal() {
  return (hebcalPromise ??= import(HEBCAL_URL));
}

/* ───────────── English number words ───────────── */

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const IRREGULAR_ORD = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };

const below100 = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''));
const below1000 = (n) => {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? ONES[h] + ' hundred' : '', r ? below100(r) : ''].filter(Boolean).join(' ');
};
/** 1..9999 -> "two thousand twenty-six" */
export function numberWords(n) {
  const t = Math.floor(n / 1000), r = n % 1000;
  return [t ? ONES[t] + ' thousand' : '', r ? below1000(r) : ''].filter(Boolean).join(' ');
}
/** 1..99 -> "twenty-eighth" */
export function ordinalWords(n) {
  return below100(n).replace(/(\w+)$/, (w) => IRREGULAR_ORD[w] || (w.endsWith('y') ? w.slice(0, -1) + 'ieth' : w + 'th'));
}

/* ───────────── Times ───────────── */

const pad2 = (n) => String(n).padStart(2, '0');
const hour12 = (h) => h % 12 || 12;

/** {h:18,m:30} -> "six thirty" / "six o'clock" / "six oh five" */
export function timeWordsEn({ h, m }) {
  const hw = ONES[hour12(h)];
  if (m === 0) return `${hw} o'clock`;
  return `${hw} ${m < 10 ? 'oh ' + ONES[m] : below100(m)}`;
}
export const timeNum = ({ h, m }) => `${hour12(h)}:${pad2(m)}`;
export const timeNumAmPm = ({ h, m }) => `${timeNum({ h, m })} ${h >= 12 ? 'PM' : 'AM'}`;

const HE_HOURS = ['', 'אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע', 'עשר', 'אחת עשרה', 'שתים עשרה'];
const HE_MIN = { 5: 'חמש', 10: 'עשר', 15: 'רבע', 20: 'עשרים', 25: 'עשרים וחמש', 30: 'חצי' };

/** {h:18,m:30} -> "שש וחצי"; {h:18,m:45} -> "שבע פחות רבע". Minutes must be multiples of 5. */
export function timeWordsHe({ h, m }) {
  const h12 = hour12(h);
  if (m === 0) return HE_HOURS[h12];
  if (m <= 30 && HE_MIN[m]) return `${HE_HOURS[h12]} ו${HE_MIN[m]}`;
  if (m > 30 && HE_MIN[60 - m]) return `${HE_HOURS[(h12 % 12) + 1]} פחות ${HE_MIN[60 - m]}`;
  return timeNum({ h, m }); // odd minute value: fall back to digits
}

/* ───────────── Hebrew numerals ───────────── */

const G1 = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const G10 = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const G100 = ['', 'ק', 'ר', 'ש', 'ת'];

/** 28 -> כ״ח, 30 -> ל׳, 786 -> תשפ״ו (pass year % 1000) */
export function gematriya(n) {
  let s = '';
  while (n >= 400) { s += 'ת'; n -= 400; }
  if (n >= 100) { s += G100[Math.floor(n / 100)]; n %= 100; }
  if (n === 15) s += 'טו';
  else if (n === 16) s += 'טז';
  else s += G10[Math.floor(n / 10)] + G1[n % 10];
  return s.length > 1 ? s.slice(0, -1) + '״' + s.slice(-1) : s + '׳';
}

const HE_WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/* ───────────── Token table ───────────── */

const ordinalSuffix = (n) =>
  (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));

/** Everything about the secular date that needs no Hebrew calendar (sync). */
export function englishTokens(date) {
  const y = date.getFullYear(), mo = date.getMonth(), d = date.getDate();
  const dayEn = date.toLocaleDateString('en-US', { weekday: 'long' });
  const monthEn = date.toLocaleDateString('en-US', { month: 'long' });
  const ord = ordinalWords(d);
  const yearWords = numberWords(y);
  return {
    'day-en': dayEn,
    'month-en': monthEn,
    'day-num': String(d),
    'day-ordinal': `${d}${ordinalSuffix(d)}`,
    'month-num': String(mo + 1),
    'year': String(y),
    'year-short': pad2(y % 100),
    'date-ordinal-words': ord,
    'year-words': yearWords,
    'date-short': `${monthEn} ${d}, ${y}`,
    'date-en-full': `${dayEn}, the ${ord} of ${monthEn}, ${yearWords}`,
    'day-he': date.getDay() === 6 ? 'שבת קודש' : 'יום ' + HE_WEEKDAYS[date.getDay()],   // includes "יום"
    'dayname-he': date.getDay() === 6 ? 'שבת קודש' : HE_WEEKDAYS[date.getDay()],        // without "יום"
  };
}

/**
 * Date styles the customer can choose from. Each is a template over the tokens above.
 * Add, remove or reorder freely (or pass your own list as `dateStyles` to mountEventPicker).
 * Fields opt in with data-autofill="date-styled" (with weekday) or "date-styled-nodow" (without).
 */
export const DATE_STYLES = [
  { id: 'ordinal',        tpl: '{day-en}, {month-en} {day-ordinal} {year}' },                               // Tuesday, March 26th 2026
  { id: 'the-of',         tpl: '{day-en} the {day-ordinal} of {month-en}, {year}' },                        // Tuesday the 26th of March, 2026
  { id: 'comma-year',     tpl: '{day-en}, {month-en} {day-num}, {year}' },                                  // Tuesday, March 26, 2026
  { id: 'numeric',        tpl: '{day-en}, {month-num}/{day-num}/{year-short}' },                            // Tuesday, 3/26/26
  { id: 'words-full',     tpl: '{day-en} the {date-ordinal-words} of {month-en}, {year-words}' },           // Tuesday the twenty-sixth of March, two thousand twenty-six
  { id: 'month-words',    tpl: '{day-en}, {month-en} {date-ordinal-words}, {year-words}' },                 // Tuesday, March twenty-sixth, two thousand twenty-six
  { id: 'words-no-year',  tpl: '{day-en}, the {date-ordinal-words} of {month-en}' },                        // Tuesday, the twenty-sixth of March
  { id: 'short-no-year',  tpl: '{day-en}, {month-en} {day-ordinal}' },                                      // Tuesday, March 26th
];

/** Render a style template; withDay:false drops the leading weekday ("The 26th of March, 2026"). */
export function renderDateStyle(tpl, tokens, { withDay = true } = {}) {
  const t = withDay ? tpl : tpl.replace(/^\{day-en\}(?:,\s*|\s+)/, '');
  const out = renderTemplate(t, tokens);
  return out && !withDay ? out.charAt(0).toUpperCase() + out.slice(1) : out;
}

/**
 * @param {{date: Date, kabalas?: {h,m}|null, chuppa?: {h,m}|null, nightfallHour?: number|null, dateStyleTpl?: string|null}} input
 * @returns {Promise<{tokens: Object<string,string>, hebrewOk: boolean}>}
 */
export async function computeTokens({ date, kabalas = null, chuppa = null, nightfallHour = null, dateStyleTpl = null }) {
  const tokens = englishTokens(date);
  const y = date.getFullYear(), mo = date.getMonth(), d = date.getDate();
  const styleTpl = dateStyleTpl || DATE_STYLES[0].tpl;
  tokens['date-styled'] = renderDateStyle(styleTpl, tokens) ?? '';
  tokens['date-styled-nodow'] = renderDateStyle(styleTpl, tokens, { withDay: false }) ?? '';

  // Times
  for (const [key, t] of [['kabalas', kabalas], ['chuppa', chuppa]]) {
    if (!t) continue;
    tokens[`${key}-en`] = timeWordsEn(t);
    tokens[`${key}-num`] = timeNum(t);
    tokens[`${key}-num-ampm`] = timeNumAmPm(t);
    tokens[`${key}-he`] = timeWordsHe(t);
  }

  // Hebrew calendar + parsha (needs Hebcal; English tokens above still work if it fails)
  let hebrewOk = true;
  try {
    const { HDate, Sedra, Locale } = await loadHebcal();
    // Optional: a chuppa at/after `nightfallHour` (24h) is on the NEXT Hebrew day.
    const roll = nightfallHour != null && chuppa && chuppa.h >= nightfallHour;
    const mk = (dt, p) => {
      const h = new HDate(dt);
      const hy = h.getFullYear();
      const name = h.getMonthName();
      const monthHe = Locale.gettext(name, 'he-x-NoNikud');
      const monthEnH = Locale.gettext(name, 'ashkenazi');
      const ord = ordinalWords(h.getDate());
      const dayHe = gematriya(h.getDate()), yearHe = gematriya(hy % 1000);
      return {
        [`${p}day-he`]: dayHe,
        [`${p}month-he`]: monthHe,
        [`${p}year-he`]: yearHe,
        [`${p}date-he`]: `${dayHe} ${monthHe} ${yearHe}`,
        [`${p}day-num`]: String(h.getDate()),
        [`${p}month-en`]: monthEnH,
        [`${p}year-num`]: String(hy),
        [`${p}day-ordinal-words`]: ord,
        [`${p}year-words`]: numberWords(hy),
        [`${p}date-en`]: `the ${ord} of ${monthEnH}, ${numberWords(hy)}`,
      };
    };
    // h*  = Hebrew date of the picked day (next day if `roll`)
    // nh* = "night of" date: the Hebrew day that begins that evening (for "אור ל…" / "evening of …")
    Object.assign(tokens, mk(new Date(y, mo, d + (roll ? 1 : 0)), 'h'), mk(new Date(y, mo, d + 1), 'nh'));
    const hdDay = new HDate(new Date(y, mo, d)); // parsha = the Shabbos on/after the picked day itself

    try {
      const sedra = new Sedra(hdDay.getFullYear(), false); // false = Diaspora
      if (!sedra.lookup(hdDay).chag) {        // skip when that Shabbos is a Yom Tov reading
        const en = sedra.getString(hdDay, 'ashkenazi');       // "Parshas Matos-Masei"
        const he = sedra.getString(hdDay, 'he-x-NoNikud');    // "פרשת מטות־מסעי"
        const strip = (s) => (/\s/.test(s) ? s.replace(/^\S+\s+/, '') : s);
        Object.assign(tokens, {
          'parsha-en': en, 'parsha-name-en': strip(en),
          'parsha-he': he, 'parsha-name-he': strip(he),
        });
      }
    } catch { /* no parsha for this date; those fields are left alone */ }
  } catch (err) {
    console.warn('Hebrew calendar failed to load:', err);
    hebrewOk = false;
  }
  return { tokens, hebrewOk };
}

/* ───────────── Template rendering ───────────── */

const applyCase = (s, mod) =>
  mod === 'upper' ? s.toUpperCase()
    : mod === 'lower' ? s.toLowerCase()
      : mod === 'title' ? s.replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
        : s;

/**
 * "kabalas-en:upper"  or  "{day-en}, the {date-ordinal-words:title} of {month-en}"
 * Returns null if any token has no value yet (e.g. time not chosen) so the field is left alone.
 */
export function renderTemplate(tpl, tokens) {
  return renderTemplateDetailed(tpl, tokens).value;
}

/** Same as renderTemplate, but also says which tokens had no value. */
export function renderTemplateDetailed(tpl, tokens) {
  const src = tpl.includes('{') ? tpl : `{${tpl.trim()}}`;
  const missing = [];
  const out = src.replace(/\{([\w-]+)(?::(upper|lower|title))?\}/g, (_, name, mod) => {
    const v = tokens[name];
    if (v == null || v === '') { missing.push(name); return ''; }
    return applyCase(v, mod);
  });
  return { value: missing.length ? null : out, missing };
}

const KNOWN_TOKENS = new Set([
  'day-en', 'month-en', 'day-num', 'day-ordinal', 'month-num', 'year', 'year-short', 'date-ordinal-words',
  'year-words', 'date-short', 'date-en-full', 'day-he', 'dayname-he', 'date-styled', 'date-styled-nodow',
  ...['h', 'nh'].flatMap((p) =>
    ['day-he', 'month-he', 'year-he', 'date-he', 'day-num', 'month-en', 'year-num', 'day-ordinal-words', 'year-words', 'date-en']
      .map((x) => p + x)),
  'parsha-en', 'parsha-name-en', 'parsha-he', 'parsha-name-he',
  ...['kabalas', 'chuppa'].flatMap((k) => ['en', 'num', 'num-ampm', 'he'].map((x) => `${k}-${x}`)),
]);
const waitingFor = (name) =>
  name.startsWith('kabalas-') ? 'a Kabalas Ponim time' : name.startsWith('chuppa-') ? 'a Chuppa time' : null;

/* ───────────── Splitting a long line ───────────── */

/**
 * Split text at a space into two lines that each fit `max` if possible.
 * Prefers breaking after a comma, then the most even split.
 */
export function splitText(text, max) {
  const s = String(text).trim();
  let best = null;
  for (let i = 1; i < s.length - 1; i++) {
    if (s[i] !== ' ') continue;
    const a = s.slice(0, i).trimEnd(), b = s.slice(i + 1).trimStart();
    if (!a || !b) continue;
    const over = Math.max(0, a.length - max) + Math.max(0, b.length - max);
    const score = over * 10 + Math.abs(a.length - b.length) - (/[,;:]$/.test(a) ? 12 : 0);
    if (!best || score < best.score) best = { a, b, score };
  }
  return best ? [best.a, best.b] : [s, ''];
}

/* ───────────── Picker UI ───────────── */

function timeOptions({ start = '12:00', end = '23:45', step = 15 } = {}) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const out = [];
  for (let t = sh * 60 + sm; t <= eh * 60 + em; t += step) out.push({ h: Math.floor(t / 60), m: t % 60 });
  return out;
}
const parseTime = (v) => (v ? { h: +v.split(':')[0], m: +v.split(':')[1] } : null);

function injectStyles() {
  if (document.getElementById('event-picker-styles')) return;
  const s = document.createElement('style');
  s.id = 'event-picker-styles';
  s.textContent = `
    .event-picker{display:grid;gap:.6rem;padding:1rem;margin:0 0 1rem;border:1px solid var(--border,#ddd);border-radius:10px;background:var(--surface,#fff)}
    .event-picker h3{margin:0;font-size:1rem}
    .event-picker .ep-hint,.event-picker .ep-status{margin:0;font-size:.85rem;opacity:.75}
    .event-picker label{display:grid;gap:.25rem;font-size:.9rem}
    .event-picker input,.event-picker select{font:inherit;padding:.5rem;border:1px solid var(--border,#ccc);border-radius:6px;background:#fff}
    .event-picker .ep-row{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}
    .event-picker .ep-overflow{display:grid;gap:.5rem}
    .event-picker .ep-overflow-row{display:grid;gap:.4rem;padding:.6rem;border:1px solid #e0b25a;background:#fff8e8;border-radius:8px}
    .event-picker .ep-overflow-row p{margin:0;font-size:.85rem}
    .event-picker .ep-overflow-actions{display:flex;flex-wrap:wrap;gap:.4rem}
    .event-picker .ep-overflow-actions button{font:inherit;font-size:.85rem;padding:.35rem .7rem;border:1px solid var(--border,#bbb);border-radius:6px;background:#fff;cursor:pointer}
    .event-picker[hidden],.event-picker [hidden]{display:none!important}
    @media(max-width:480px){.event-picker .ep-row{grid-template-columns:1fr}}`;
  document.head.append(s);
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.container   where the panel is inserted
 * @param {() => Array<{id:string, template:string, label?:string, maxLength?:number}>} [opts.getTargets]
 *        ALL autofill fields on ALL pages, excluding removed and extra (cloned) lines.
 *        [[id, template], ...] tuples are accepted too.
 * @param {HTMLElement} [opts.previewRoot] fallback if no getTargets: scans it for [data-field][data-autofill]
 * @param {(name:string, value:string)=>void} opts.setField  store ONE value (wording + its input box)
 * @param {() => void} [opts.onApplied] called once after a batch of setField calls (redraw here)
 * @param {object} [opts.actions] optional editor hooks for lines that exceed maxLength:
 *   canSplit(id)->bool, split(id, first, second)->Promise<extraLineId>, unsplit(id, extraLineId)->Promise,
 *   canShrink(id)->bool, shrink(id, value)->bool|void (false = couldn't fully fit), unshrink(id)->void
 *   (a button is only shown for hooks you provide)
 * @param {Array} [opts.dateStyles]  defaults to DATE_STYLES
 * @param {object} [opts.kabalasRange] {start:'12:00', end:'23:45', step:15} (step: multiples of 5)
 * @param {object} [opts.chuppaRange]
 * @param {number|null} [opts.nightfallHour] e.g. 20: a chuppa at/after 20:00 uses the next Hebrew date. Default off.
 */
export function mountEventPicker({
  container, getTargets, previewRoot, setField, onApplied, actions = {},
  dateStyles = DATE_STYLES, kabalasRange, chuppaRange, nightfallHour = null,
}) {
  injectStyles();
  console.info(`event-autofill ${VERSION} loaded`);
  const el = document.createElement('section');
  el.className = 'event-picker';
  el.hidden = true;

  const timeOpts = (range) =>
    '<option value="">— not set —</option>' +
    timeOptions(range).map((t) => `<option value="${t.h}:${t.m}">${timeNumAmPm(t)}</option>`).join('');

  el.innerHTML = `
    <h3>Date &amp; times</h3>
    <p class="ep-hint">Pick your date and times and we’ll fill in the matching lines for you. You can still edit any line afterwards.</p>
    <label>Date <input type="date" class="ep-date"></label>
    <label class="ep-style-wrap" hidden>Date style <select class="ep-style"></select></label>
    <div class="ep-row">
      <label>Kabalas Ponim <select class="ep-kabalas">${timeOpts(kabalasRange)}</select></label>
      <label>Chuppa <select class="ep-chuppa">${timeOpts(chuppaRange)}</select></label>
    </div>
    <p class="ep-status" aria-live="polite"></p>
    <div class="ep-overflow"></div>`;
  container.append(el);

  const $ = (sel) => el.querySelector(sel);
  const dateIn = $('.ep-date'), kSel = $('.ep-kabalas'), cSel = $('.ep-chuppa');
  const styleSel = $('.ep-style'), styleWrap = $('.ep-style-wrap');
  const status = $('.ep-status'), overflowBox = $('.ep-overflow');
  const now = new Date();
  dateIn.min = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  // Style dropdown: each option shows the customer's own date in that style.
  dateStyles.forEach((st) => {
    const o = document.createElement('option');
    o.value = st.id;
    styleSel.append(o);
  });
  const pickedDate = () => {
    if (!dateIn.value) return new Date();
    const [y, m, d] = dateIn.value.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  function updateStyleLabels() {
    const tk = englishTokens(pickedDate());
    dateStyles.forEach((st, i) => {
      styleSel.options[i].textContent = renderDateStyle(st.tpl, tk) ?? st.id;
    });
  }
  updateStyleLabels();

  const normalize = (t) => (Array.isArray(t) ? { id: t[0], template: t[1] } : t);
  let targets = [];
  function refresh() {
    if (getTargets) {
      targets = getTargets().map(normalize);
    } else {
      const seen = new Map();
      previewRoot.querySelectorAll('[data-field][data-autofill]').forEach((n) => {
        const name = n.getAttribute('data-field');
        if (!seen.has(name)) seen.set(name, n.getAttribute('data-autofill'));
      });
      targets = [...seen].map(normalize);
    }
    el.hidden = targets.length === 0; // templates with no tagged fields don't show the panel
    styleWrap.hidden = !targets.some((t) => /date-styled/.test(t.template)); // only if a field uses it
  }

  const splits = new Map(); // fieldId -> { extraId, original }
  const shrunk = new Set(); // fieldIds whose font we shrank

  function showOverflow({ t, value, max }) {
    const row = document.createElement('div');
    row.className = 'ep-overflow-row';
    const msg = document.createElement('p');
    msg.textContent = `“${t.label || t.id}” is ${value.length} characters, but this line fits about ${max}. How should we handle it?`;
    const btns = document.createElement('div');
    btns.className = 'ep-overflow-actions';
    const mk = (text, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.addEventListener('click', fn);
      btns.append(b);
      return b;
    };

    if (actions.split && (actions.canSplit ? actions.canSplit(t.id) : true) && /\s/.test(value.trim())) {
      mk('Split onto 2 lines', async () => {
        const [first, second] = splitText(value, max);
        const extraId = await actions.split(t.id, first, second);
        splits.set(t.id, { extraId, original: value });
        const still = Math.max(first.length, second.length) > max;
        msg.textContent = 'Split onto two lines.' + (still ? ' One line is still long; try shrinking it or a shorter date style.' : '');
        btns.replaceChildren();
        mk('Undo', async () => {
          await actions.unsplit(t.id, extraId);
          splits.delete(t.id);
          setField(t.id, value);
          onApplied?.();
          row.remove();
        });
      });
    }
    if (actions.shrink && (actions.canShrink ? actions.canShrink(t.id) : true)) {
      mk('Shrink text', () => {
        const fits = actions.shrink(t.id, value);
        shrunk.add(t.id);
        msg.textContent = fits === false
          ? 'Shrunk as far as still looks good, so it may be tight. You can also split it or pick a shorter date style.'
          : 'Text shrunk to fit.';
        btns.replaceChildren();
        if (actions.unshrink) mk('Undo', () => { actions.unshrink(t.id); shrunk.delete(t.id); row.remove(); });
      });
    }
    mk('Keep as is', () => row.remove());

    row.append(msg, btns);
    overflowBox.append(row);
  }

  let run = 0;
  async function apply() {
    const mine = ++run;
    refresh(); // pick up added/removed lines since the last change
    updateStyleLabels();
    if (!dateIn.value) { status.textContent = ''; return; }
    const style = dateStyles.find((st) => st.id === styleSel.value) || dateStyles[0];
    const { tokens, hebrewOk } = await computeTokens({
      date: pickedDate(),
      kabalas: parseTime(kSel.value),
      chuppa: parseTime(cSel.value),
      nightfallHour,
      dateStyleTpl: style.tpl,
    });
    if (mine !== run) return; // a newer change superseded this one

    overflowBox.replaceChildren();
    const overflows = [];
    const skipped = [];
    let filled = 0;
    for (const t of targets) {
      const { value, missing } = renderTemplateDetailed(t.template, tokens);
      if (value == null) { skipped.push({ t, missing }); continue; }
      if (shrunk.has(t.id)) { // a previous shrink no longer applies to the new text
        actions.unshrink?.(t.id);
        shrunk.delete(t.id);
      }
      if (splits.has(t.id)) { // a previous split is now obsolete
        await actions.unsplit?.(t.id, splits.get(t.id).extraId);
        splits.delete(t.id);
        if (mine !== run) return;
      }
      setField(t.id, value);
      filled++;
      const max = Number(t.maxLength);
      if (Number.isFinite(max) && max > 0 && value.length > max) overflows.push({ t, value, max });
    }
    if (filled) onApplied?.();

    // Why were some lines skipped? Usually: a time hasn't been picked yet.
    const waits = new Set();
    let unknown = false;
    let noParsha = false;
    for (const { t, missing } of skipped) {
      for (const name of missing) {
        const w = waitingFor(name);
        if (w) waits.add(w);
        else if (name.startsWith('parsha-')) { if (hebrewOk) noParsha = true; }
        else if (!KNOWN_TOKENS.has(name)) {
          unknown = true;
          console.warn(`event-autofill: field "${t.id}" uses unknown token "{${name}}" in data-autofill="${t.template}"`);
        }
      }
    }
    let note = `Filled ${filled} line${filled === 1 ? '' : 's'}.`;
    if (waits.size) note += ` Pick ${[...waits].join(' and ')} to fill the rest.`;
    if (noParsha) note += ' There is no regular parsha that week (Yom Tov), so the parsha wording was left unchanged. Please update it yourself.';
    if (!hebrewOk) note += ' The Hebrew calendar couldn’t load, so Hebrew date and parsha lines were skipped.';
    if (unknown) note += ' Some lines have an unrecognised autofill tag (see the browser console).';
    status.textContent = note;
    overflows.forEach(showOverflow);
  }

  [dateIn, styleSel, kSel, cSel].forEach((n) => n.addEventListener('change', apply));
  loadHebcal().catch(() => {}); // warm up
  refresh();

  return { refresh, destroy: () => el.remove() };
}
