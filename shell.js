/* Responsive navigation. The game still owns purchases, rewards and saves. */
(() => {
  'use strict';
  const id = name => document.getElementById(name);
  const sheet = id('game-sheet');
  const scrim = id('sheet-scrim');
  const grip = id('sheet-grip');
  const closeButton = id('sheet-close');
  const scroll = id('sheet-scroll');
  const tabs = [...document.querySelectorAll('[data-open-sheet]')];
  const wide = matchMedia('(min-width:800px) and (min-aspect-ratio:1/1)');
  const titles = {shop:'Shop', staff:'Staff', goals:'Goals', stats:'Stats'};
  let selected = 'shop';
  let opened = false;
  let lastShop = 'machine';
  let pointer = null;
  let switching = false;
  // Each panel (and each shop category) keeps its own scroll position, so
  // comparing a machine with a hire never sends the player back to the top.
  const positions = new Map();
  function scrollKey() {
    if (selected !== 'shop') return selected;
    const current = document.querySelector('#shop-tabs [aria-selected="true"]');
    return current ? current.id : 'shop';
  }
  function remember() {
    if (opened || wide.matches) positions.set(scrollKey(), scroll.scrollTop);
  }
  function restore() { scroll.scrollTop = positions.get(scrollKey()) || 0; }

  function setSize(size) {
    sheet.dataset.size = size;
    grip.setAttribute('aria-label', size === 'half' ? 'Expand panel' : 'Reduce panel');
  }
  function paintPanels() {
    const visible = opened || wide.matches;
    sheet.dataset.sheet = selected;
    sheet.dataset.open = String(visible);
    sheet.inert = !visible;
    scrim.hidden = !opened || wide.matches;
    id('sheet-title').textContent = titles[selected];
    for (const tab of tabs) {
      const name = tab.dataset.openSheet;
      id('sheet-' + name).hidden = name !== selected;
      tab.setAttribute('aria-expanded', String(visible && name === selected));
    }
    document.dispatchEvent(new CustomEvent('game-panel', {detail:visible ? selected : null}));
  }
  function select(name, toggle = false) {
    if (!wide.matches && opened && name === selected && toggle) { close(); return; }
    const current = document.querySelector('#shop-tabs [aria-selected="true"]');
    if (current && current.id !== 'shop-tab-staff') lastShop = current.id.slice(9);
    remember();
    selected = name;
    opened = true;
    id('thermal-panel').hidden = true;
    id('heat-chip').setAttribute('aria-expanded','false');
    paintPanels();
    switching = true;
    try {
      if (name === 'staff') {
        if (!id('shop-tab-staff').hidden) id('shop-tab-staff').click();
      } else if (name === 'shop') {
        const tab = id('shop-tab-' + lastShop);
        if (tab && !tab.hidden) tab.click(); else id('shop-tab-machine').click();
      }
    } finally { switching = false; }
    restore();
    if (!wide.matches && !toggle) closeButton.focus({preventScroll:true});
  }
  function close() {
    if (wide.matches || !opened) return;
    remember();
    opened = false;
    paintPanels();
    tabs.find(tab=>tab.dataset.openSheet === selected)?.focus({preventScroll:true});
  }
  tabs.forEach(tab => tab.addEventListener('click', event => {
    select(tab.dataset.openSheet, true);
    if (event.detail === 0 && tab.getAttribute('aria-expanded') === 'true') {
      id('sheet-title').focus({preventScroll:true});
    }
  }));
  closeButton.addEventListener('click', close);
  scrim.addEventListener('click', close);
  let ignoreGripClick = false;
  grip.addEventListener('click', () => {
    if (!ignoreGripClick) setSize(sheet.dataset.size === 'half' ? 'full' : 'half');
    ignoreGripClick = false;
  });
  function dragStart(e) {
    if (wide.matches || !e.isPrimary || e.button !== 0) return;
    pointer = { id:e.pointerId, y:e.clientY, height:sheet.offsetHeight };
    grip.setPointerCapture(e.pointerId);
  }
  grip.addEventListener('pointerdown', dragStart);
  grip.addEventListener('pointermove', e => {
    if (pointer?.id !== e.pointerId) return;
    if (Math.abs(e.clientY - pointer.y) < 4) return;
    sheet.style.height = Math.max(60, pointer.height + pointer.y - e.clientY) + 'px';
  });
  grip.addEventListener('pointercancel', () => { pointer = null; sheet.style.height = ''; });
  grip.addEventListener('pointerup', e => {
    if (pointer?.id !== e.pointerId) return;
    sheet.style.height = '';
    const dy = e.clientY - pointer.y;
    pointer = null;
    if (Math.abs(dy) < 24) return;
    ignoreGripClick = true;
    if (dy < 0) setSize('full');
    else if (sheet.dataset.size === 'full') setSize('half'); else close();
  });
  let swipe = null;
  scroll.addEventListener('touchstart', e => {
    swipe = e.touches.length === 1 && scroll.scrollTop <= 0 ? {x:e.touches[0].clientX, y:e.touches[0].clientY} : null;
  },{passive:true});
  scroll.addEventListener('touchend', e => {
    if (!swipe || wide.matches || scroll.scrollTop > 0) return;
    const dy = e.changedTouches[0].clientY - swipe.y, dx = e.changedTouches[0].clientX - swipe.x;
    swipe = null;
    if (dy > 80 && Math.abs(dx) < dy / 2) close();
  },{passive:true});
  const heat = id('heat-chip'), thermal = id('thermal-panel');
  function showHeat(show) {
    thermal.hidden = !show;
    heat.setAttribute('aria-expanded',String(show));
    if (show && opened && !wide.matches) { close(); heat.focus(); }
  }
  heat.addEventListener('click', () => showHeat(thermal.hidden));
  id('heat-close').addEventListener('click', () => {showHeat(false); heat.focus();});
  document.addEventListener('pointerdown', e => {
    if (!thermal.hidden && !e.target.closest('.heat-chip-wrap')) showHeat(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (!thermal.hidden) { showHeat(false); heat.focus(); } else close();
  });
  wide.addEventListener('change', () => { opened = false; paintPanels(); });
  addEventListener('DOMContentLoaded', () => {
    const staffPanel = id('shop-panel-staff'), staffTab = id('shop-tab-staff');
    staffPanel.removeAttribute('role'); staffPanel.removeAttribute('aria-labelledby'); staffPanel.removeAttribute('tabindex');
    id('sheet-staff').append(staffPanel);
    // Keep the category and quantity controls pinned while the purchase list scrolls.
    const shopControls = document.createElement('div');
    shopControls.className = 'shop-controls';
    shopControls.append(id('shop-tabs'), id('shop-quantity'));
    id('sheet-shop').querySelector('.shop').prepend(shopControls);
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => sheet.style.setProperty('--shop-controls-height', shopControls.offsetHeight + 'px')).observe(shopControls);
    }
    // Switching shop categories also returns to where that category was left.
    const shopTabList = id('shop-tabs');
    shopTabList.addEventListener('click', () => { if (!switching) remember(); }, true);
    shopTabList.addEventListener('click', () => { if (!switching) restore(); });
    shopTabList.addEventListener('keydown', () => { if (!switching) remember(); }, true);
    shopTabList.addEventListener('keydown', () => { if (!switching) restore(); });
    function updateStaff() {
      id('staff-lock').hidden = !staffTab.hidden;
      if (selected === 'staff' && (opened || wide.matches) && !staffTab.hidden && staffTab.getAttribute('aria-selected') !== 'true') staffTab.click();
    }
    new MutationObserver(updateStaff).observe(staffTab,{attributes:true,attributeFilter:['hidden']});
    updateStaff();
    const navDot = n => tabs.find(tab=>tab.dataset.openSheet===n).querySelector('.nav-dot');
    const staffDot = staffTab.querySelector('.shop-tab-dot');
    const shopDots = [...id('shop-tabs').querySelectorAll('.shop-tab-dot')].filter(dot=>dot !== staffDot);
    const goalDot = id('goals-toggle').querySelector('.claim-dot');
    const contractDot = id('contracts-dot');
    const laptop = document.querySelector('.card[data-item="laptop"]');
    const signal = () => {
      navDot('staff').hidden = staffDot.hidden;
      navDot('shop').hidden = !(shopDots.some(dot=>!dot.hidden) || (laptop && !laptop.disabled));
      navDot('goals').hidden = (goalDot.hidden || id('goals-toggle').hidden) && contractDot.hidden;
    };
    const observer = new MutationObserver(signal);
    for (const node of [...shopDots,staffDot,goalDot,contractDot,laptop]) if (node) observer.observe(node,{attributes:true,attributeFilter:['hidden','disabled']});
    signal();
    paintPanels();
    if (wide.matches && staffTab.getAttribute('aria-selected')==='true') select('shop');
  });
  window.GameShell = {open:select, close, get panel() { return opened || wide.matches ? selected : null; }};
})();
