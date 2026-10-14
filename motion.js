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
  // Spring the center and logarithmic span: zoom may overshoot, but never invert the price axis.
  function bounds(values, velocities, targets, seconds, immediate = false) {
    const span=values[1]-values[0],targetSpan=targets[1]-targets[0];
    if(!(span>0)||!(targetSpan>0))throw Error('Tactile framing requires ordered bounds.');
    const center=[(values[0]+values[1])/2],cv=[velocities[0]],zoom=[Math.log(span)],zv=[velocities[1]];
    const p=advance(center,cv,[(targets[0]+targets[1])/2],seconds,targetSpan*1e-4,immediate);
    const z=advance(zoom,zv,[Math.log(targetSpan)],seconds,.00001,immediate);
    velocities[0]=cv[0];velocities[1]=zv[0];
    if(p||z){const half=Math.exp(zoom[0])/2;values[0]=center[0]-half;values[1]=center[0]+half;}
    else{values[0]=targets[0];values[1]=targets[1];}
    return p||z;
  }
  if (typeof window === 'undefined') return { model, integrate, advance, bounds };
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
  function visible(element, open, distance = model.information) {
    if (element.hidden === !open && !value(element, 'visibility')) return;
    const hidden = element.hasAttribute('hidden'), display = hidden ? '' : getComputedStyle(element).display;
    element.hidden = !open; element.toggleAttribute('hidden',!open);element.inert = !open;
    element.setAttribute('aria-hidden', String(!open)); element.dataset.flowVisible = '';
    element.style.setProperty('--flow-display', display || getComputedStyle(element).display);
    element.dataset.flowEnter = '';
    spring(element, 'visibility', { from: { progress: hidden ? 0 : 1 }, to: { progress: open ? 1 : 0 },
      write: ({ progress }) => { element.style.opacity = String(bounded(progress)); element.style.setProperty('--flow-enter-y', `${(1 - progress) * distance}px`); },
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
  // Natural height changes with content or available width, not with each spring sample.
  const measurements = new WeakMap();
  function invalidate(element) {
    for (let node=element;node;node=node.parentElement) {
      const measurement=measurements.get(node);if(measurement)measurement.dirty=true;
    }
  }
  function natural(element,axis='height') {
    const measurement={dirty:true,width:NaN,size:0};measurements.set(element,measurement);
    return ()=>{
      const width=element.getBoundingClientRect().width;
      if(measurement.dirty||width!==measurement.width){measurement.size=intrinsic(element,axis);measurement.width=width;measurement.dirty=false;}
      return measurement.size;
    };
  }
  const sizes = new WeakMap();
  function resize(element, change) {
    const height = element.getBoundingClientRect().height;
    const result = change();
    if (!element.getClientRects().length || reduced()) return result;
    if (!sizes.has(element)) sizes.set(element, { height: element.style.height, overflow: element.style.overflow });
    element.dataset.flowSizing = ''; element.style.overflow = 'hidden';
    const target=natural(element);
    spring(element, 'size', { from: { height }, to: () => ({ height: target() }),
      write: ({ height }) => { element.style.height = `${Math.max(0, height)}px`;invalidate(element.parentElement); },
      done: () => { Object.assign(element.style, sizes.get(element)); sizes.delete(element);measurements.delete(element);delete element.dataset.flowSizing;invalidate(element.parentElement); } });
    return result;
  }
  function disclosure(element, open, axis = 'height') {
    if (element.hidden === !open && !value(element, 'disclosure')) return;
    const start = element.getBoundingClientRect()[axis], display = element.hidden ? '' : getComputedStyle(element).display;
    element.hidden = !open; element.inert = !open;
    element.dataset.flowDisclosure = ''; element.dataset.flowVisible = '';
    element.style.setProperty('--flow-display', display || getComputedStyle(element).display);
    element.style.overflow = 'hidden';
    const target=natural(element,axis);
    spring(element, 'disclosure', { from: { size: start, opacity: open && !start ? 0 : Number(getComputedStyle(element).opacity) },
      to: () => ({ size: open ? target() : 0, opacity: open ? 1 : 0 }),
      write: ({ size, opacity }) => { element.style[axis] = `${Math.max(0, size)}px`; element.style.opacity = String(bounded(opacity));invalidate(element.parentElement); },
      done: () => { element.style[axis] = ''; element.style.opacity = ''; element.style.overflow = ''; element.style.removeProperty('--flow-display'); delete element.dataset.flowDisclosure; delete element.dataset.flowVisible;measurements.delete(element);invalidate(element.parentElement); } });
  }
  function details(root) {
    for (const detail of root.querySelectorAll('details')) {
      let body = detail.querySelector(':scope > .flow-detail-body');
      if (!body) {
        body = document.createElement('div'); body.className = 'flow-detail-body';
        for (const child of [...detail.childNodes]) if (!(child instanceof Element && child.tagName === 'SUMMARY')) body.append(child);
        detail.append(body);
      }
      if(value(body,'disclosure')){if(body.dataset.flowOpen!==String(detail.open))detailVisibility(detail,detail.open);}
      else { body.hidden=false;body.inert=!detail.open; }
    }
  }
  function detailVisibility(detail,open) {
    const body=detail.querySelector(':scope > .flow-detail-body'),height=body.getBoundingClientRect().height;
    body.dataset.flowOpen=String(open);detail.dataset.flowDetails='';detail.open=open;
    body.hidden=!open;body.inert=!open;body.dataset.flowVisible='';body.dataset.flowDisclosure='';
    body.style.setProperty('--flow-display','block');body.style.overflow='hidden';
    const target=natural(body);
    spring(body,'disclosure',{from:{size:height,opacity:open&&!height?0:Number(getComputedStyle(body).opacity)},to:()=>({size:open?target():0,opacity:open?1:0}),
      write:({size,opacity})=>{body.style.height=`${Math.max(0,size)}px`;body.style.opacity=String(bounded(opacity));invalidate(detail);},
      done:()=>{
        body.hidden=false;body.inert=!detail.open;body.style.height='';body.style.opacity='';body.style.overflow='';body.style.removeProperty('--flow-display');
        delete body.dataset.flowVisible;delete body.dataset.flowDisclosure;delete body.dataset.flowOpen;delete detail.dataset.flowDetails;measurements.delete(body);invalidate(detail);
      }});
  }
  document.addEventListener('click',event=>{
    const summary=event.target.closest('summary'),detail=summary?.parentElement;
    if(detail?.tagName!=='DETAILS')return;
    event.preventDefault();details(detail.parentElement);detailVisibility(detail,!detail.open);
  });
  document.addEventListener('toggle',event=>{if(event.target.tagName==='DETAILS'){details(event.target.parentElement);invalidate(event.target);}},true);
  function clip(element,cache=new Map()) {
    const parent=element.parentElement;
    if(!parent||parent===document.body)return{left:0,top:0,right:innerWidth,bottom:innerHeight};
    if(cache.has(parent))return cache.get(parent);
    const bounds={...clip(parent,cache)},style=getComputedStyle(parent),box=parent.getBoundingClientRect();
    if (/auto|scroll|hidden|clip/.test(style.overflowX)) { bounds.left = Math.max(bounds.left, box.left + parent.clientLeft); bounds.right = Math.min(bounds.right, box.left + parent.clientLeft + parent.clientWidth); }
    if (/auto|scroll|hidden|clip/.test(style.overflowY)) { bounds.top = Math.max(bounds.top, box.top + parent.clientTop); bounds.bottom = Math.min(bounds.bottom, box.top + parent.clientTop + parent.clientHeight); }
    cache.set(parent,bounds);return bounds;
  }
  function capture(element,cache) { const box=element.getBoundingClientRect();return { box, clip: box.width&&box.height?clip(element,cache):null }; }
  function retire(element, geometry = capture(element)) {
    const { box, clip: bounds } = geometry;
    if(reduced()||!box.width||!box.height){finish(element);element.remove();return;}
    let opacity = Number(getComputedStyle(element).opacity);
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) opacity *= Number(getComputedStyle(parent).opacity);
    if (reduced() || !box.width || !box.height || !opacity || box.right <= bounds.left || box.left >= bounds.right || box.bottom <= bounds.top || box.top >= bounds.bottom) { finish(element); element.remove(); return; }
    // Preserve selector/inheritance context with shallow shells. Copying every computed
    // property of every descendant made a pane switch a hundreds-of-ms blocking task.
    const ghost=document.createElement('div'),snapshot=element.cloneNode(true);let context=ghost;
    const ancestors=[];for(let parent=element.parentElement;parent&&parent!==document.body;parent=parent.parentElement)ancestors.unshift(parent);
    for(const parent of ancestors){
      const shell=parent.cloneNode(false);shell.removeAttribute('id');shell.removeAttribute('hidden');
      for(const attribute of [...shell.attributes])if(attribute.name.startsWith('data-flow-')||attribute.name==='data-motion-running')shell.removeAttribute(attribute.name);
      Object.assign(shell.style,{display:'contents',opacity:'1',translate:'none',transform:'none',filter:'none',contain:'none',containerType:'normal'});
      context.append(shell);context=shell;
    }
    for(const node of [snapshot,...snapshot.querySelectorAll('*')])node.removeAttribute('id');
    const style=getComputedStyle(element);
    for(const property of ['display','box-sizing','font','color','text-align','padding','border','border-radius','background','gap','flex-direction','align-items','justify-content'])snapshot.style.setProperty(property,style.getPropertyValue(property));
    Object.assign(snapshot.style,{position:'absolute',left:'0',top:'0',width:`${box.width}px`,height:`${box.height}px`,margin:'0',translate:'none',transform:'none'});
    context.append(snapshot);
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
    if(reduced())return change(new Map());
    const active = document.activeElement;
    const clips=new Map(),before = new Map([...root.querySelectorAll(selector)].map(el => [el, capture(el,clips)]));
    const result = change(before);
    if (active?.isConnected && root.contains(active) && document.activeElement !== active) active.focus({ preventScroll: true });
    const after = [...root.querySelectorAll(selector)], actorsAfter=new Set(after),deltas = new Map();
    for (const el of after) { el.style.removeProperty('--flow-layout-x'); el.style.removeProperty('--flow-layout-y'); }
    for (const el of after) {
      const old = before.get(el), box = el.getBoundingClientRect();
      if (old?.box.width && old.box.height && box.width && box.height) deltas.set(el, { x: old.box.left - box.left, y: old.box.top - box.top });
    }
    for (const el of after) {
      const delta = deltas.get(el);
      if (!delta) {
        let parent=el.parentElement,nested=false;
        while(parent&&parent!==root){if(actorsAfter.has(parent)&&!before.has(parent)){nested=true;break;}parent=parent.parentElement;}
        if(!before.has(el)&&!nested&&el.getClientRects().length)reveal(el);continue;
      }
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
    const preserve = name => name.startsWith('data-flow-') || name === 'data-motion-running' || current.tagName === 'DETAILS' && name === 'open' || name==='inert'&&current.classList.contains('flow-detail-body');
    for (const attr of [...current.attributes]) if (!preserve(attr.name) && attr.name !== 'style' && !incoming.hasAttribute(attr.name)) current.removeAttribute(attr.name);
    for (const attr of incoming.attributes) if (!preserve(attr.name) && attr.name !== 'style' && current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
    const temporary = name => name.startsWith('--flow-') || Boolean(owners.get(current)?.size) && ['height', 'width', 'opacity', 'overflow', 'translate'].includes(name);
    for (const name of [...current.style]) if (!temporary(name) && !incoming.style.getPropertyValue(name)) current.style.removeProperty(name);
    for (const name of incoming.style) if (!temporary(name)&&(current.style.getPropertyValue(name)!==incoming.style.getPropertyValue(name)||current.style.getPropertyPriority(name)!==incoming.style.getPropertyPriority(name))) current.style.setProperty(name, incoming.style.getPropertyValue(name), incoming.style.getPropertyPriority(name));
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
  const markups=new WeakMap();
  function patch(root, markup, animate = true) {
    const previous=markups.get(root);
    if(previous?.markup===markup&&previous.first===root.firstChild&&previous.last===root.lastChild){details(root);return;}
    const template = document.createElement('template'); template.innerHTML = markup; details(template.content);
    const result=animate?layout(root,geometries=>reconcile(root,template.content,geometries,true)):reconcile(root,template.content,new Map(),false);
    details(root);invalidate(root);markups.set(root,{markup,first:root.firstChild,last:root.lastChild});return result;
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
  return { model, integrate, advance, bounds, reduced, spring, value, cancel, finish, reveal, visible, disclosure, resize, layout, patch, details, switchControl, onSettle: fn => settlers.add(fn), active: () => moving.size > 0 };
})();
