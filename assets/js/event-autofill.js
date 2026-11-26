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

/**
 * @param {{date: Date, kabalas?: {h,m}|null, chuppa?: {h,m}|null, nightfallHour?: number|null}} input
 * @returns {Promise<{tokens: Object<string,string>, hebrewOk: boolean}>}
 */
export async function computeTokens({ date, kabalas = null, chuppa = null, nightfallHour = null }) {
  const tokens = {};
  const y = date.getFullYear(), mo = date.getMonth(), d = date.getDate();

  // English / secular
  const dayEn = date.toLocaleDateString('en-US', { weekday: 'long' });
  const monthEn = date.toLocaleDateString('en-US', { month: 'long' });
  const ord = ordinalWords(d);
  const yearWords = numberWords(y);
  Object.assign(tokens, {
    'day-en': dayEn,
    'month-en': monthEn,
    'day-num': String(d),
    'year': String(y),
    'date-ordinal-words': ord,
    'year-words': yearWords,
    'date-short': `${monthEn} ${d}, ${y}`,
    'date-en-full': `${dayEn}, the ${ord} of ${monthEn}, ${yearWords}`,
    'day-he': date.getDay() === 6 ? 'שבת קודש' : 'יום ' + HE_WEEKDAYS[date.getDay()],
  });

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
    const hd = new HDate(new Date(y, mo, d + (roll ? 1 : 0)));
    const hy = hd.getFullYear();
    const hMonthName = hd.getMonthName();
    const monthHe = Locale.gettext(hMonthName, 'he-x-NoNikud');
    const monthEnH = Locale.gettext(hMonthName, 'ashkenazi');
    const hOrd = ordinalWords(hd.getDate());

    Object.assign(tokens, {
      'hday-he': gematriya(hd.getDate()),
      'hmonth-he': monthHe,
      'hyear-he': gematriya(hy % 1000),
      'hdate-he': `${gematriya(hd.getDate())} ${monthHe} ${gematriya(hy % 1000)}`,
      'hday-num': String(hd.getDate()),
      'hmonth-en': monthEnH,
      'hyear-num': String(hy),
      'hday-ordinal-words': hOrd,
      'hyear-words': numberWords(hy),
      'hdate-en': `the ${hOrd} of ${monthEnH}, ${numberWords(hy)}`,
    });

    try {
      const sedra = new Sedra(hy, false); // false = Diaspora
      if (!sedra.lookup(hd).chag) {        // skip when that Shabbos is a Yom Tov reading
        const en = sedra.getString(hd, 'ashkenazi');       // "Parshas Matos-Masei"
        const he = sedra.getString(hd, 'he-x-NoNikud');    // "פרשת מטות־מסעי"
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
  const src = tpl.includes('{') ? tpl : `{${tpl.trim()}}`;
  let missing = false;
  const out = src.replace(/\{([\w-]+)(?::(upper|lower|title))?\}/g, (_, name, mod) => {
    const v = tokens[name];
    if (v == null || v === '') { missing = true; return ''; }
    return applyCase(v, mod);
  });
  return missing ? null : out;
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
    @media(max-width:480px){.event-picker .ep-row{grid-template-columns:1fr}}`;
  document.head.append(s);
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.container   where the panel is inserted
 * @param {() => Array<[string,string]>} [opts.getTargets] returns [[fieldId, autofillTemplate], ...] for ALL pages
 *        (preferred: the editor only keeps the active page in the DOM)
 * @param {HTMLElement} [opts.previewRoot] fallback if no getTargets: scans it for [data-field][data-autofill]
 * @param {(name:string, value:string)=>void} opts.setField  store ONE value (wording + its input box)
 * @param {() => void} [opts.onApplied] called once after a batch of setField calls (redraw the preview here)
 * @param {object} [opts.kabalasRange]   {start:'12:00', end:'23:45', step:15}  (step: multiples of 5)
 * @param {object} [opts.chuppaRange]
 * @param {number|null} [opts.nightfallHour] e.g. 20: a chuppa at/after 20:00 uses the next Hebrew date. Default off.
 */
export function mountEventPicker({ container, getTargets, previewRoot, setField, onApplied, kabalasRange, chuppaRange, nightfallHour = null }) {
  injectStyles();
  const el = document.createElement('section');
  el.className = 'event-picker';
  el.hidden = true;

  const optsHtml = (range) =>
    '<option value="">— not set —</option>' +
    timeOptions(range).map((t) => `<option value="${t.h}:${t.m}">${timeNumAmPm(t)}</option>`).join('');

  el.innerHTML = `
    <h3>Date &amp; times</h3>
    <p class="ep-hint">Pick your date and times and we’ll fill in the matching lines for you. You can still edit any line afterwards.</p>
    <label>Date <input type="date" class="ep-date"></label>
    <div class="ep-row">
      <label>Kabalas Ponim <select class="ep-kabalas">${optsHtml(kabalasRange)}</select></label>
      <label>Chuppa <select class="ep-chuppa">${optsHtml(chuppaRange)}</select></label>
    </div>
    <p class="ep-status" aria-live="polite"></p>`;
  container.append(el);

  const $ = (sel) => el.querySelector(sel);
  const dateIn = $('.ep-date'), kSel = $('.ep-kabalas'), cSel = $('.ep-chuppa'), status = $('.ep-status');
  const now = new Date();
  dateIn.min = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  let targets = [];
  function refresh() {
    if (getTargets) {
      targets = getTargets();
    } else {
      const seen = new Map();
      previewRoot.querySelectorAll('[data-field][data-autofill]').forEach((n) => {
        const name = n.getAttribute('data-field');
        if (!seen.has(name)) seen.set(name, n.getAttribute('data-autofill'));
      });
      targets = [...seen];
    }
    el.hidden = targets.length === 0; // templates with no tagged fields don't show the panel
  }

  let run = 0;
  async function apply() {
    const mine = ++run;
    refresh(); // pick up added/removed lines since the last change
    if (!dateIn.value) { status.textContent = ''; return; }
    const [y, m, d] = dateIn.value.split('-').map(Number);
    const { tokens, hebrewOk } = await computeTokens({
      date: new Date(y, m - 1, d),
      kabalas: parseTime(kSel.value),
      chuppa: parseTime(cSel.value),
      nightfallHour,
    });
    if (mine !== run) return; // a newer change superseded this one
    let filled = 0;
    for (const [name, tpl] of targets) {
      const value = renderTemplate(tpl, tokens);
      if (value != null) { setField(name, value); filled++; }
    }
    if (filled) onApplied?.();
    status.textContent = hebrewOk
      ? `Filled ${filled} line${filled === 1 ? '' : 's'}.`
      : `Filled ${filled} line${filled === 1 ? '' : 's'}. The Hebrew calendar couldn’t load, so Hebrew date and parsha lines were skipped.`;
  }

  [dateIn, kSel, cSel].forEach((n) => n.addEventListener('change', apply));
  loadHebcal().catch(() => {}); // warm up
  refresh();

  return { refresh, destroy: () => el.remove() };
}
