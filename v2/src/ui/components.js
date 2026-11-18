import { h } from '../core/dom.js';
import { icon } from './icons.js';

/* ---------- surfaces ---------- */

// card('Title', ...children) or card({ title, subtitle, action }, ...children)
export function card(titleOrOptions, ...children) {
  const opts = typeof titleOrOptions === 'string' || !titleOrOptions
    ? { title: titleOrOptions }
    : titleOrOptions;
  const head = opts.title || opts.action
    ? h('div', { class: 'card-head' },
      h('div', null,
        opts.title ? h('h2', { class: 'card-title' }, opts.title) : null,
        opts.subtitle ? h('p', { class: 'card-sub' }, opts.subtitle) : null),
      opts.action || null)
    : null;
  return h('section', { class: `card ${opts.class || ''}`.trim() }, head, ...children);
}

export const row = (label, value, cls = '') =>
  h('div', { class: `row ${cls}`.trim() }, h('span', { class: 'muted' }, label), h('strong', { class: 'num' }, value));

export function emptyState(title, text, iconName = 'inbox') {
  return h('div', { class: 'empty' },
    h('span', { class: 'empty-icon' }, icon(iconName, { size: 24 })),
    h('strong', null, title),
    text ? h('p', null, text) : null);
}
export const empty = emptyState;

/* ---------- forms ---------- */

export const field = (label, control, hint) =>
  h('label', { class: 'field' },
    h('span', { class: 'field-label' }, label),
    control,
    hint ? h('small', { class: 'hint' }, hint) : null);

export const input = (props = {}) => h('input', props);

export const moneyInput = (props = {}) =>
  h('div', { class: 'money-input' }, h('input', { type: 'text', inputmode: 'decimal', placeholder: '0.00', autocomplete: 'off', ...props }));

export function select(options, { value, ...props } = {}) {
  return h('select', props, options.map((opt) => {
    const { value: v, label } = typeof opt === 'string' ? { value: opt, label: opt } : opt;
    return h('option', { value: v, selected: String(v) === String(value) }, label);
  }));
}

/* ---------- buttons ---------- */

/**
 * Wraps a submit/click handler so it cannot run twice at once: a double-click or Enter-then-click
 * sends one request, not two. The form's buttons are disabled while the work is in flight.
 */
export function singleFlight(handler) {
  let running = false;
  return async (event) => {
    event?.preventDefault?.();
    if (running) return undefined;
    running = true;
    // currentTarget is cleared after the first await, so capture the buttons now.
    const scope = event?.currentTarget?.closest?.('form') || event?.currentTarget;
    const controls = scope?.querySelectorAll ? [...scope.querySelectorAll('button')].filter((b) => !b.disabled) : [];
    controls.forEach((b) => { b.disabled = true; });
    try {
      return await handler(event);
    } finally {
      running = false;
      controls.forEach((b) => { b.disabled = false; });
    }
  };
}

// button('Save', { icon: 'check', class: 'primary sm' })
export function button(label, { icon: iconName, ...props } = {}) {
  return h('button', { type: 'button', ...props, class: `btn ${props.class || ''}`.trim() },
    iconName ? icon(iconName, { size: 18 }) : null,
    label ? h('span', null, label) : null);
}

export function iconButton(iconName, label, props = {}) {
  return h('button', { type: 'button', 'aria-label': label, title: label, ...props, class: `icon-btn ${props.class || ''}`.trim() },
    icon(iconName, { size: 20 }));
}

/* ---------- people ---------- */

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts.at(-1)[0] : '')).toUpperCase();
}

// Colours are stable across devices: derived from the sorted member ids, not list order.
export function avatarSlot(members, userId) {
  const index = members.map((m) => m.user_id).sort().indexOf(userId);
  return (index < 0 ? 0 : index % 6) + 1;
}

export function avatar(member, members, { large = false } = {}) {
  return h('span', {
    class: `avatar c${avatarSlot(members, member?.user_id)} ${large ? 'lg' : ''}`.trim(),
    title: member?.display_name || '',
  }, initials(member?.display_name));
}

export function memberName(members, userId) {
  const member = members.find((m) => m.user_id === userId);
  if (!member) return 'Someone';
  return member.left_at ? `${member.display_name} (former)` : member.display_name;
}

export function avatarFor(members, userId) {
  return avatar(members.find((m) => m.user_id === userId) || { user_id: userId, display_name: '?' }, members);
}

/* ---------- data display ---------- */

export function progressBar(pct, status = 'ok') {
  const width = Math.max(0, Math.min(100, pct));
  const fill = h('div', { class: `bar-fill ${status}` });
  fill.style.width = `${width}%`;
  return h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': width, 'aria-valuemin': 0, 'aria-valuemax': 100 }, fill);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const RING_RADIUS = 32;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function ring(pct, tone = 'needs') {
  const clamped = Math.max(0, Math.min(100, pct));
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 76 76');
  svg.setAttribute('width', '76');
  svg.setAttribute('height', '76');
  svg.setAttribute('aria-hidden', 'true');
  for (const [cls, dash] of [['ring-track', null], [`ring-fill ${tone}`, `${(clamped / 100) * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`]]) {
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('class', cls);
    circle.setAttribute('cx', '38');
    circle.setAttribute('cy', '38');
    circle.setAttribute('r', String(RING_RADIUS));
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke-width', '8');
    if (dash) {
      circle.setAttribute('stroke-linecap', 'round');
      circle.setAttribute('stroke-dasharray', dash);
    }
    svg.append(circle);
  }
  return h('div', { class: 'ring' }, svg, h('span', { class: 'ring-label num' }, `${Math.round(pct)}%`));
}

export function segmented(options, value, onChange) {
  return h('div', { class: 'segmented', role: 'group' }, options.map(({ value: v, label, leading }) =>
    h('button', {
      type: 'button',
      class: `seg ${v === value ? 'active' : ''}`,
      'aria-pressed': v === value ? 'true' : 'false',
      title: label,
      onClick: () => onChange(v),
    }, leading || null, h('span', { class: 'seg-label' }, label))));
}

/* ---------- feedback ---------- */

let toastTimer;
export function toast(message, type = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = message;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3500);
}

/**
 * Modal bottom-sheet. Escape or a backdrop click closes it; focus moves into
 * the dialog and returns to the opener afterwards.
 */
export function openSheet({ title, content, onClose }) {
  const opener = document.activeElement;
  const overlay = h('div', { class: 'sheet-overlay' });
  const focusables = () => [...sheet.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && !el.closest('[hidden]'));

  // Keeps Tab / Shift+Tab inside the dialog so keyboard users cannot wander onto the page behind it.
  const onKey = (event) => {
    if (event.key === 'Escape') return close();
    if (event.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) return;
    const [first, last] = [items[0], items.at(-1)];
    const outside = !sheet.contains(document.activeElement);
    if (outside || (event.shiftKey && document.activeElement === first)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  function close() {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    opener?.focus?.();
    onClose?.();
  }

  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', null, title), iconButton('x', 'Close', { onClick: close })),
    content);
  overlay.append(sheet);
  overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  sheet.querySelector('input, select, button:not(.icon-btn)')?.focus();
  return { close, element: overlay };
}
