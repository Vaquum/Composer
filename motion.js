'use strict';
// Tactile flow: the same physical model as Poise and Eightchord.
const TactileFlow = (() => {
  const model = Object.freeze({ stiffness: 180, damping: 20, mass: 1, travel: 20, information: 8, feedback: 100 });
  function integrate(position, velocity, target, seconds) {
    if (![position, velocity, target, seconds].every(Number.isFinite) || seconds < 0) throw Error('Tactile flow requires finite values and a non-negative time step.');
    const steps = Math.max(1, Math.ceil(seconds / .008)), dt = seconds / steps;
    for (let i = 0; i < steps; i++) {
      velocity += (-model.stiffness * (position - target) - model.damping * velocity) / model.mass * dt;
      position += velocity * dt;
    }
    return { position, velocity };
  }
  function advance(values, velocities, targets, seconds, epsilon = .0008, immediate = false) {
    let busy = false;
    for (let i = 0; i < targets.length; i++) {
      const next = integrate(values[i], velocities[i], targets[i], immediate ? 0 : seconds);
      if (immediate || Math.abs(next.position - targets[i]) <= epsilon && Math.abs(next.velocity) <= epsilon * 10) {
        values[i] = targets[i]; velocities[i] = 0;
      } else { values[i] = next.position; velocities[i] = next.velocity; busy = true; }
    }
    return busy;
  }
  if (typeof window === 'undefined') return { model, integrate, advance };
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const owners = new WeakMap(), moving = new Set(), settlers = new Set();
  let frame = 0, previousTime = 0, suspended = document.hidden, printing = false;
  const reduced = () => preference.matches || suspended || printing;
  const bounded = value => Math.max(0, Math.min(1, value));
  const mark = owner => owner.toggleAttribute('data-motion-running', Boolean(owners.get(owner)?.size));
  function destination(channel) {
    const target = typeof channel.to === 'function' ? channel.to() : channel.to;
    for (const [key, value] of Object.entries(target)) {
      if (!Number.isFinite(value) || !Number.isFinite(channel.value[key])) throw Error(`Tactile flow received non-finite ${channel.name}.${key}.`);
      channel.range[key] = Math.max(channel.range[key] || 1, Math.abs(value - channel.value[key]));
    }
    return target;
  }
  function cancel(owner, name) {
    const channel = owners.get(owner)?.get(name);
    if (!channel) return;
    moving.delete(channel); owners.get(owner).delete(name); mark(owner);
  }
  function complete(channel) {
    if(!channel.owner.isConnected){cancel(channel.owner,channel.name);channel.done();return;}
    const target = destination(channel);
    channel.value = { ...target }; channel.write(target);
    // Remove ownership before callbacks, which may create a new request.
    cancel(channel.owner, channel.name); channel.done();
  }
  function tick(now) {
    const dt = Math.max(0, Math.min(.032, (now - previousTime) / 1000)); previousTime = now;
    for (const channel of [...moving]) {
      if (!moving.has(channel)) continue;
      if (!channel.owner.isConnected) { complete(channel); continue; }
      if (now < channel.start) continue;
      const target = destination(channel); let resting = true;
      for (const [key, goal] of Object.entries(target)) {
        const next = integrate(channel.value[key], channel.velocity[key] || 0, goal, dt);
        channel.value[key] = next.position; channel.velocity[key] = next.velocity;
        if (Math.abs(next.position - goal) > channel.range[key] * .0008 || Math.abs(next.velocity) > channel.range[key] * .008) resting = false;
      }
      if (resting || reduced()) complete(channel); else channel.write({ ...channel.value });
    }
    frame = moving.size ? requestAnimationFrame(tick) : 0;
  }
  function spring(owner, name, { from, to, write, done = () => {}, delay = 0, rebase = false }) {
    let own = owners.get(owner);
    if (!own) { own = new Map(); owners.set(owner, own); }
    let channel = own.get(name);
    if (!channel) { channel = { owner, name, value: { ...from }, velocity: {}, range: {} }; own.set(name, channel); }
    else if (rebase) channel.value = { ...from };
    Object.assign(channel, { to, write, done, start: performance.now() + delay });
    destination(channel);
    if (reduced()) { complete(channel); return; }
    moving.add(channel); mark(owner); write({ ...channel.value });
    if (!frame) { previousTime = performance.now(); frame = requestAnimationFrame(tick); }
  }
  function value(owner, name) { const c = owners.get(owner)?.get(name); return c ? { ...c.value } : null; }
  function finish(root) {
    for (const channel of [...moving]) if (moving.has(channel) && (!root || channel.owner === root || root.contains(channel.owner))) complete(channel);
    if (!root) for (const settle of settlers) settle();
  }
  function reveal(element, distance = model.information, delay = 0) {
    element.dataset.flowEnter = '';
    spring(element, 'entry', { from: { opacity: 0, y: distance }, to: { opacity: 1, y: 0 }, delay,
      write: ({ opacity, y }) => { element.style.opacity = String(bounded(opacity)); element.style.setProperty('--flow-enter-y', `${y}px`); },
      done: () => { element.style.opacity = ''; element.style.removeProperty('--flow-enter-y'); delete element.dataset.flowEnter; } });
  }
  function visible(element, open) {
    if (element.hidden === !open && !value(element, 'visibility')) return;
    const hidden = element.hasAttribute('hidden'), display = hidden ? '' : getComputedStyle(element).display;
    element.hidden = !open; element.toggleAttribute('hidden',!open);element.inert = !open;
    element.setAttribute('aria-hidden', String(!open)); element.dataset.flowVisible = '';
    element.style.setProperty('--flow-display', display || getComputedStyle(element).display);
    element.dataset.flowEnter = '';
    spring(element, 'visibility', { from: { progress: hidden ? 0 : 1 }, to: { progress: open ? 1 : 0 },
      write: ({ progress }) => { element.style.opacity = String(bounded(progress)); element.style.setProperty('--flow-enter-y', `${(1 - progress) * model.information}px`); },
      done: () => { element.style.opacity = ''; element.style.removeProperty('--flow-enter-y'); element.style.removeProperty('--flow-display'); delete element.dataset.flowVisible; delete element.dataset.flowEnter; } });
  }
  function intrinsic(element, axis = 'height') {
    const clone = element.cloneNode(true);
    for (const node of [clone, ...clone.querySelectorAll('*')]) { node.removeAttribute('id'); node.removeAttribute('data-motion-running'); }
    clone.hidden = false; clone.inert = true; clone.dataset.flowMeasuring = '';
    Object.assign(clone.style, { position: 'fixed', visibility: 'hidden', pointerEvents: 'none', translate: 'none', transform: 'none', opacity: '1', overflow: 'visible', height: 'auto', width: axis === 'height' ? `${element.getBoundingClientRect().width}px` : 'max-content' });
    delete clone.dataset.flowSizing; delete clone.dataset.flowVisible; delete clone.dataset.flowDisclosure;
    element.parentElement.append(clone);
    try { return clone.getBoundingClientRect()[axis]; } finally { clone.remove(); }
  }
  const sizes = new WeakMap();
  function resize(element, change) {
    const height = element.getBoundingClientRect().height;
    const result = change();
    if (!element.getClientRects().length || reduced()) return result;
    if (!sizes.has(element)) sizes.set(element, { height: element.style.height, overflow: element.style.overflow });
    element.dataset.flowSizing = ''; element.style.overflow = 'hidden';
    spring(element, 'size', { from: { height }, to: () => ({ height: intrinsic(element) }),
      write: ({ height }) => { element.style.height = `${Math.max(0, height)}px`; },
      done: () => { Object.assign(element.style, sizes.get(element)); sizes.delete(element); delete element.dataset.flowSizing; } });
    return result;
  }
  function disclosure(element, open, axis = 'height') {
    if (element.hidden === !open && !value(element, 'disclosure')) return;
    const start = element.getBoundingClientRect()[axis], display = element.hidden ? '' : getComputedStyle(element).display;
    element.hidden = !open; element.inert = !open;
    element.dataset.flowDisclosure = ''; element.dataset.flowVisible = '';
    element.style.setProperty('--flow-display', display || getComputedStyle(element).display);
    element.style.overflow = 'hidden';
    spring(element, 'disclosure', { from: { size: start, opacity: open && !start ? 0 : Number(getComputedStyle(element).opacity) },
      to: () => ({ size: open ? intrinsic(element, axis) : 0, opacity: open ? 1 : 0 }),
      write: ({ size, opacity }) => { element.style[axis] = `${Math.max(0, size)}px`; element.style.opacity = String(bounded(opacity)); },
      done: () => { element.style[axis] = ''; element.style.opacity = ''; element.style.overflow = ''; element.style.removeProperty('--flow-display'); delete element.dataset.flowDisclosure; delete element.dataset.flowVisible; } });
  }
  function details(root) {
    for (const detail of root.querySelectorAll('details')) {
      let body = detail.querySelector(':scope > .flow-detail-body');
      if (!body) {
        body = document.createElement('div'); body.className = 'flow-detail-body';
        for (const child of [...detail.childNodes]) if (!(child instanceof Element && child.tagName === 'SUMMARY')) body.append(child);
        detail.append(body);
      }
      if (!value(body, 'disclosure')) { body.hidden = false; body.inert = !detail.open; }
    }
  }
  document.addEventListener('click', event => {
    const summary = event.target.closest('summary'), detail = summary?.parentElement;
    if (detail?.tagName !== 'DETAILS') return;
    event.preventDefault(); details(detail.parentElement);
    const body = detail.querySelector(':scope > .flow-detail-body'), height = body.getBoundingClientRect().height;
    const open = !detail.open; detail.dataset.flowDetails = ''; detail.open = open;
    body.hidden = !open; body.inert = !open; body.dataset.flowVisible = ''; body.dataset.flowDisclosure = '';
    body.style.setProperty('--flow-display', 'block'); body.style.overflow = 'hidden';
    spring(body, 'disclosure', { from: { size: height, opacity: open && !height ? 0 : Number(getComputedStyle(body).opacity) }, to: () => ({ size: open ? intrinsic(body) : 0, opacity: open ? 1 : 0 }),
      write: ({ size, opacity }) => { body.style.height = `${Math.max(0, size)}px`; body.style.opacity = String(bounded(opacity)); },
      done: () => { body.hidden = false; body.style.height = ''; body.style.opacity = ''; body.style.overflow = ''; body.style.removeProperty('--flow-display'); delete body.dataset.flowVisible; delete body.dataset.flowDisclosure; delete detail.dataset.flowDetails; } });
  });
  document.addEventListener('toggle', event => {
    if (event.target.tagName === 'DETAILS' && !event.target.hasAttribute('data-flow-details')) details(event.target.parentElement);
  }, true);
  function clip(element) {
    const bounds = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) { bounds.left = Math.max(bounds.left, box.left + parent.clientLeft); bounds.right = Math.min(bounds.right, box.left + parent.clientLeft + parent.clientWidth); }
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) { bounds.top = Math.max(bounds.top, box.top + parent.clientTop); bounds.bottom = Math.min(bounds.bottom, box.top + parent.clientTop + parent.clientHeight); }
    }
    return bounds;
  }
  function capture(element) { return { box: element.getBoundingClientRect(), clip: clip(element) }; }
  function retire(element, geometry = capture(element)) {
    const { box, clip: bounds } = geometry;
    let opacity = Number(getComputedStyle(element).opacity);
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) opacity *= Number(getComputedStyle(parent).opacity);
    if (reduced() || !box.width || !box.height || !opacity || box.right <= bounds.left || box.left >= bounds.right || box.bottom <= bounds.top || box.top >= bounds.bottom) { finish(element); element.remove(); return; }
    const ghost = element.cloneNode(true), source = [element, ...element.querySelectorAll('*')], copies = [ghost, ...ghost.querySelectorAll('*')];
    source.forEach((node, i) => {
      const style = getComputedStyle(node);
      copies[i].style.cssText = style.cssText;
      // Computed CSSStyleDeclaration.cssText is empty in some engines; copy the resolved properties.
      for (const property of style) copies[i].style.setProperty(property, style.getPropertyValue(property));
      copies[i].removeAttribute('id');
      for (const attribute of [...copies[i].attributes]) if (attribute.name.startsWith('data-flow-') || attribute.name === 'data-motion-running') copies[i].removeAttribute(attribute.name);
    });
    ghost.inert = true; ghost.setAttribute('aria-hidden', 'true'); ghost.dataset.flowRetiring = '';
    Object.assign(ghost.style, { position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, margin: '0', translate: 'none', transform: 'none', pointerEvents: 'none', zIndex: '90' });
    finish(element); element.remove(); document.body.append(ghost);
    spring(ghost, 'retirement', { from: { opacity, y: 0 }, to: { opacity: 0, y: -model.information },
      write: ({ opacity, y }) => {
        ghost.style.opacity = String(bounded(opacity)); ghost.style.translate = `0 ${y}px`;
        ghost.style.clipPath = `inset(${Math.max(0, bounds.top - box.top - y)}px ${Math.max(0, box.right - bounds.right)}px ${Math.max(0, box.bottom + y - bounds.bottom)}px ${Math.max(0, bounds.left - box.left)}px)`;
      }, done: () => ghost.remove() });
  }
  const actors = ':scope > *, [data-reading], [data-detail], .pane-group, .prow, .pnear';
  function layout(root, change, selector = actors) {
    const active = document.activeElement;
    const before = new Map([...root.querySelectorAll(selector)].map(el => [el, capture(el)]));
    const result = change(before);
    if (active?.isConnected && root.contains(active) && document.activeElement !== active) active.focus({ preventScroll: true });
    const after = [...root.querySelectorAll(selector)], deltas = new Map();
    for (const el of after) { el.style.removeProperty('--flow-layout-x'); el.style.removeProperty('--flow-layout-y'); }
    for (const el of after) {
      const old = before.get(el), box = el.getBoundingClientRect();
      if (old?.box.width && old.box.height && box.width && box.height) deltas.set(el, { x: old.box.left - box.left, y: old.box.top - box.top });
    }
    for (const el of after) {
      const delta = deltas.get(el);
      if (!delta) { if (!before.has(el) && !after.some(parent => parent !== el && parent.contains(el) && !before.has(parent)) && el.getClientRects().length) reveal(el); continue; }
      let parent = el.parentElement;
      while (parent && parent !== root && !deltas.has(parent)) parent = parent.parentElement;
      const ancestor = deltas.get(parent), from = { x: delta.x - (ancestor?.x || 0), y: delta.y - (ancestor?.y || 0) };
      if (Math.abs(from.x) < .5 && Math.abs(from.y) < .5 && !value(el, 'layout')) continue;
      el.dataset.flowLayout = '';
      spring(el, 'layout', { from, to: { x: 0, y: 0 }, rebase: true,
        write: ({ x, y }) => { el.style.setProperty('--flow-layout-x', `${x}px`); el.style.setProperty('--flow-layout-y', `${y}px`); },
        done: () => { el.style.removeProperty('--flow-layout-x'); el.style.removeProperty('--flow-layout-y'); delete el.dataset.flowLayout; } });
    }
    return result;
  }
  function key(node, index) {
    if (node.nodeType !== 1) return `text-${index}`;
    for (const name of ['data-motion-key', 'id', 'data-reading', 'data-detail', 'data-key', 'data-design', 'data-k']) if (node.hasAttribute(name)) return `${node.tagName}:${name}:${node.getAttribute(name)}`;
    return `${node.tagName}:${node.classList[0] || ''}:${index}`;
  }
  function attributes(current, incoming) {
    const preserve = name => name.startsWith('data-flow-') || name === 'data-motion-running' || current.tagName === 'DETAILS' && name === 'open';
    for (const attr of [...current.attributes]) if (!preserve(attr.name) && attr.name !== 'style' && !incoming.hasAttribute(attr.name)) current.removeAttribute(attr.name);
    for (const attr of incoming.attributes) if (!preserve(attr.name) && attr.name !== 'style' && current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
    const temporary = name => name.startsWith('--flow-') || Boolean(owners.get(current)?.size) && ['height', 'width', 'opacity', 'overflow', 'translate'].includes(name);
    for (const name of [...current.style]) if (!temporary(name) && !incoming.style.getPropertyValue(name)) current.style.removeProperty(name);
    for (const name of incoming.style) if (!temporary(name)) current.style.setProperty(name, incoming.style.getPropertyValue(name), incoming.style.getPropertyPriority(name));
  }
  function reconcile(root, incoming, geometries, animate) {
    const old = [...root.childNodes], desired = [...incoming.childNodes], used = new Set(), keyed = new Map(old.map((node, i) => [key(node, i), node]));
    let cursor = root.firstChild;
    desired.forEach((next, index) => {
      let node = keyed.get(key(next, index));
      if (!node || used.has(node) || node.nodeType !== next.nodeType || node.nodeName !== next.nodeName) node = next.cloneNode(true);
      else if (node.nodeType === 1) { attributes(node, next); reconcile(node, next, geometries, animate); }
      else if (node.textContent !== next.textContent) node.textContent = next.textContent;
      used.add(node);
      if (node !== cursor) root.insertBefore(node, cursor);
      cursor = node.nextSibling;
    });
    for (const node of old) if (!used.has(node)) {
      if (node.nodeType === 1 && animate && geometries.has(node)) retire(node, geometries.get(node));
      else { if (node.nodeType === 1) finish(node); node.remove(); }
    }
  }
  function patch(root, markup, animate = true) {
    const template = document.createElement('template'); template.innerHTML = markup; details(template.content);
    if (animate) return layout(root, geometries => reconcile(root, template.content, geometries, true));
    reconcile(root, template.content, new Map(), false);
  }
  function switchControl(input) {
    const target = input.checked ? 13 : 0;
    if (!input.hasAttribute('data-flow-switch')) { input.dataset.flowSwitch = ''; input.style.setProperty('--flow-switch-x', `${target}px`); return; }
    spring(input, 'switch', { from: { x: parseFloat(input.style.getPropertyValue('--flow-switch-x')) }, to: { x: target }, write: ({ x }) => input.style.setProperty('--flow-switch-x', `${x}px`) });
  }
  let position = 0, velocity = 0; const samples = [0];
  do { const next = integrate(position, velocity, 1, .008); position = next.position; velocity = next.velocity; samples.push(position); } while (Math.abs(position - 1) > .0008 || Math.abs(velocity) > .008);
  samples[samples.length - 1] = 1;
  const css = document.documentElement.style;
  css.setProperty('--flow-settle', `${(samples.length - 1) * 8}ms`); css.setProperty('--flow-spring', `linear(${samples.map(n => n.toFixed(5)).join(',')})`);
  preference.addEventListener('change', () => { if (preference.matches) finish(); });
  addEventListener('resize', () => finish());
  addEventListener('beforeprint', () => { printing = true; finish(); });
  addEventListener('afterprint', () => { printing = false; });
  addEventListener('pagehide', () => { suspended = true; finish(); });
  addEventListener('pageshow', () => { suspended = document.hidden; });
  document.addEventListener('visibilitychange', () => { suspended = document.hidden; if (suspended) finish(); });
  details(document);
  return { model, integrate, advance, reduced, spring, value, cancel, finish, reveal, visible, disclosure, resize, layout, patch, switchControl, onSettle: fn => settlers.add(fn), active: () => moving.size > 0 };
})();
