// tour-steps.js - edit this file to change the tour. Nothing else needs touching.
//
// target : CSS selector (or array of fallbacks). Omit for a centered message.
// before : optional function run before the step shows (e.g. open a panel).
// after  : optional function run when leaving the step (undo what before() did).
// Steps whose target isn't on the page (or is hidden) are skipped automatically.

// --- helper: open the first line's "advanced" panel for the add/remove-lines step ---
const ADV_TOGGLE = '#fieldControls .field-label-row > :not(label):not(.field-line-tools)';
let openedByTour = null;

const firstToolsWrap = () =>
  document.querySelector('#fieldControls .field-line-tools')?.closest('.field-control-wrap');

const visible = (el) => !!el && el.getClientRects().length > 0;

function openAdvanced() {
  const wrap = firstToolsWrap();
  const tools = wrap?.querySelector('.field-line-tools');
  if (!wrap || visible(tools)) return;                 // already open (or tools not inside a panel)
  const toggle = wrap.querySelector(ADV_TOGGLE);
  if (toggle) { toggle.click(); openedByTour = toggle; }
}
function closeAdvanced() {
  if (openedByTour && visible(firstToolsWrap()?.querySelector('.field-line-tools'))) openedByTour.click();
  openedByTour = null;
}

export default [
  {
    title: 'Welcome to the editor',
    body: 'A quick tour of everything you can customize. Skip it any time, and reopen it later with the "Take the tour" button.',
  },
  {
    target: '.large-preview-wrap',
    title: 'Live preview',
    body: 'Your invitation updates as you type.',
  },
  {
    target: '#pageThumbs',
    title: 'Pages',
    body: 'Select a page to preview, or use the arrows beside the preview. The arrow button next to "Invitation Preview" hides this strip to give you more room.',
  },
  {
    target: '.preview-zoom-button',
    waitFor: '.preview-zoom-button',
    title: 'Full-screen zoom',
    body: 'Open the invitation full screen, then zoom with the slider, mouse wheel or a pinch, and drag to look closely at the details.',
  },
  {
    target: '#mainQuantityDropdown',
    title: '1. Quantity',
    body: 'Choose how many invitations you need. Each quantity shows the total and the price per invitation.',
  },
  {
    target: '#optionControls',
    title: '2. Invitation options',
    body: 'Choose the card format, paper and design option. Each choice shows how it changes the price, per invitation or per order.',
  },
  {
    target: '.control-section > h2 + div:not(#fieldControls)',
    waitFor: '.control-section > h2 + div:not(#fieldControls) *',
    title: 'Date and times',
    body: 'Pick the date and the Kabalas Ponim and Chuppa times. The English and Hebrew date, times, day and parsha fill in automatically.',
  },
  {
    target: '#fieldControls .field-control-wrap',
    waitFor: '#fieldControls [data-field]',
    title: 'Your wording',
    body: 'Type your own wording for each line. Click a field and the matching text is outlined in the preview, so you always know what you are editing.',
  },
  {
    target: '#fieldControls .hebrew-keyboard-toggle',
    waitFor: '#fieldControls .hebrew-keyboard-toggle',
    title: 'Hebrew keyboard',
    body: 'Tap the keyboard button beside any field to type Hebrew without switching your device keyboard.',
  },
  {
    target: ADV_TOGGLE,
    title: 'Advanced options',
    body: 'Click "advanced" next to a line to change that line\'s font, size and color.',
  },
  {
    before: openAdvanced,
    after: closeAdvanced,
    target: '#fieldControls .field-line-tools',
    title: 'Add or remove lines',
    body: 'Inside Advanced, add a line above or below, or remove a line you do not need. New lines copy the style of the line they came from. Removed lines can be restored from the "Removed lines" box.',
  },
  {
    target: '#addOnControls',
    waitFor: () => { const c = document.querySelector('#addOnControls'); return !!c && (c.querySelector('.addon-card') || c.textContent.trim()); },
    title: '3. Optional add-ons',
    body: 'Add matching cards and other extras. Choose Yes, then pick a quantity and design, and personalize the wording.',
  },
  {
    target: '#orderInvoice',
    waitFor: '#orderInvoice .invoice-item',
    title: 'Order summary',
    body: 'An itemized summary of your invitations, design fee and add-ons. Nothing is paid online.',
  },
  {
    target: '#liveOrderTotal',
    title: 'Current order total',
    body: 'This stays on screen and updates with every change, including add-ons.',
  },
  {
    target: '#reviewButton',
    title: 'Review your order',
    body: 'When you are happy, enter your name and email, then review everything. We will email you a proof to approve before anything is printed.',
  },
  {
    title: 'You are all set',
    body: 'Reopen this tour any time with the "Take the tour" button.',
  },
];
