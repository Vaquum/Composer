// Small DOM and SVG helpers, and the one menu the bench uses. The same shapes as Query's shared helpers.
const NS = 'http://www.w3.org/2000/svg';

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}
export function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}
export const mount = (el, ...kids) => { el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false)); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);
export const label = (text, cls = '') => h('span', { class: 'label ' + cls }, text);
export const note = (text, cls = '') => h('span', { class: 'note ' + cls }, text);
export const quiet = (text, fn, title) => h('button', { class: 'quiet', type: 'button', title, onclick: (e) => { e.stopPropagation(); fn(e); } }, text);

let popup = null; let opener = null; let openerName = null;
/** The control a menu or popover opened from, as it stands now: a redraw may have replaced the one that opened it. */
const openerNow = () => (openerName ? document.querySelector(`[data-enc="${CSS.escape(openerName)}"]`) : null) || opener;
export function closeMenu() { if (popup) { popup.remove(); popup = null; document.removeEventListener('mousedown', outside, true); } openerNow()?.setAttribute('aria-expanded', 'false'); opener = null; openerName = null; }
/** The control a menu or popover opened from says that it is open, until it closes. */
const opened = (anchor) => { opener = anchor; openerName = anchor.dataset.enc || null; anchor.setAttribute('aria-expanded', 'true'); };
/** Whether the menu or popover on screen opened from the term of this name: a redrawn term says so too. */
export const menuOpenFor = (name) => !!popup && openerName === name;
export const menuOpen = () => !!popup;
function outside(e) { if (popup && !popup.contains(e.target) && !e.target.closest('[data-menu]')) closeMenu(); }
/**
 * A menu under its anchor. Options are { value, label, detail, figure, disabled }. With `multi`, a choice toggles
 * membership in the `value` array and the menu stays open; otherwise it closes on the choice.
 */
export function menu(anchor, { title, hint, options, value, onChange, multi = false, keep = false }) {
  closeMenu();
  const chosen = (v) => (multi ? value.includes(v) : v === value);
  const list = h('ul', null, options.map((o) => h('li', null, h('button', { type: 'button', role: multi ? 'menuitemcheckbox' : 'menuitemradio', 'aria-checked': String(chosen(o.value)), disabled: o.disabled,
    onclick: () => { if (!multi && !keep) closeMenu(); onChange(o.value); } },
  h('span', null, o.label, o.detail ? h('small', null, o.detail) : null), o.figure !== undefined ? h('span', { class: 'fig' }, o.figure) : null))));
  popup = h('div', { class: 'pop', role: 'menu', onkeydown: (e) => {
    const items = [...popup.querySelectorAll('li button:not(:disabled)')]; const at = items.indexOf(document.activeElement);
    // Esc goes back to the control; Tab and ⇧Tab close the menu and move on from the control, either way
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const back = openerNow() || anchor; closeMenu(); back.focus(); }
    if (e.key === 'Tab') { e.stopPropagation(); const back = openerNow() || anchor; closeMenu(); back.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); e.stopPropagation(); items[e.key === 'Home' ? 0 : items.length - 1]?.focus(); }
  } }, h('header', null, label(title)), hint ? h('p', { class: 'note' }, hint) : null, list);
  document.body.append(popup); opened(anchor);
  const r = anchor.getBoundingClientRect();
  popup.style.left = Math.max(8, Math.min(window.innerWidth - popup.offsetWidth - 8, r.left)) + 'px';
  popup.style.top = (r.bottom + popup.offsetHeight + 4 < window.innerHeight ? r.bottom + 1 : r.top - popup.offsetHeight - 1) + 'px';
  document.addEventListener('mousedown', outside, true);
  (popup.querySelector('[aria-checked="true"]') || popup.querySelector('li button'))?.focus({ preventScroll: true });
  return popup;
}

/** A panel under its anchor with any content: the same surface as the menu, for a term that is more than a choice. */
export function popover(anchor, { title, hint, body, footer = null }) {
  closeMenu();
  popup = h('div', { class: 'pop wide', role: 'dialog', 'aria-label': title, onkeydown: (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const back = openerNow() || anchor; closeMenu(); back.focus(); } } },
    h('header', null, label(title)), hint ? h('p', { class: 'note' }, hint) : null, body, footer ? h('footer', null, footer) : null);
  document.body.append(popup); opened(anchor);
  const r = anchor.getBoundingClientRect();
  popup.style.left = Math.max(8, Math.min(window.innerWidth - popup.offsetWidth - 8, r.left)) + 'px';
  popup.style.top = (r.bottom + popup.offsetHeight + 4 < window.innerHeight ? r.bottom + 1 : r.top - popup.offsetHeight - 1) + 'px';
  document.addEventListener('mousedown', outside, true);
  return popup;
}
