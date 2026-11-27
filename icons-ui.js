/* Original 24-unit line icons shared by the HUD, shop, map and rewards. */
(() => {
  'use strict';
  const ns = 'http://www.w3.org/2000/svg';
  const paths = {
    'server': 'M4 3h16v7H4z M4 14h16v7H4z M7 6.5h2m-2 11h2m5-11h3m-3 11h3',
    'wallet': 'M3 7h17v13H4a1 1 0 0 1-1-1z M3 7l13-4v4 M15 11h6v5h-6z',
    'heat': 'M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0z M12 8v9m6-11h2m-2 4h2',
    'bolt': 'm14 2-10 12h7l-2 8 11-13h-7z',
    'settings': 'm9 3 1-1h4l1 3 3-1 3 3-1 3 2 1v3l-3 1 1 3-3 3-3-1-1 2h-3l-1-3-3 1-3-3 1-3-2-1v-3l3-1-1-3 3-3 3 1z M15 12a3 3 0 1 1-6 0 3 3 0 1 1 6 0z',
    'trophy': 'M7 3h10v5c0 4-2 6-5 6s-5-2-5-6z M7 5H3v2c0 3 2 5 5 5m9-7h4v2c0 3-2 5-5 5m-4 3v4m-5 2h10m-9-2h8',
    'brush': 'M9 12 18 3q2-1 3 1l-8 11z M9 13c-4-1-6 2-5 4 .2 1-.8 2-2 3 5 2 10 0 10-5z',
    'camera': 'M3 7h5l2-3h5l2 3h4v13H3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
    'check': 'm4 12 5 5L20 6',
    'map': 'm3 5 6-2 6 3 6-2v15l-6 2-6-3-6 2z M9 3v15m6-12v15',
    'shop': 'M3 10l2-6h14l2 6c0 3-4 4-6 1-2 3-5 3-7 0-2 3-5 2-5-1z M5 13v7h14v-7m-9 7v-5h5v5',
    'staff': 'M14 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M4 20v-3c0-6 14-6 14 0v3z M16 5c4 0 5 5 1 6m2 2c2 0 3 2 3 4',
    'goals': 'M8 4H5v17h14V4h-3 M9 3h6v4H9z m-2 8 2 2 4-5 m-6 9h8',
    'stats': 'M3 20h18 M5 16v-5h3v5z m6 0V7h3v9z m6 0V3h3v13z',
    'chevron': 'm6 9 6 6 6-6',
    'close': 'm6 6 12 12 M6 18 18 6',
    'star': 'm12 2 3 6.4 7 1-5.1 5 1.2 7-6.1-3.4-6.1 3.4 1.2-7L2 9.4l7-1z',
    'tap': 'M9 14V5a2 2 0 0 1 4 0v6l2-1 5 2v6l-3 4h-6l-6-7c-1-2 1-4 3-2l1 1z',
    'news': 'M3 4h16v15H5a2 2 0 0 1-2-2z M19 8h3v9a2 2 0 0 1-3 2 M6 8h9m-9 4h5m-5 4h8',
    'laptop': 'M5 4h14v12H5z M2 19l3-3h14l3 3v1H2z M9 17.5h6',
    'tower': 'M6 2h12v20H6z M9 6h6m-6 4h6m-6 8h2',
    'rack': 'M4 2h16v20H4z M4 9h16M4 15h16M7 5h2m-2 7h2m-2 6h2',
    'gpu': 'M2 6h19v12H2z M3 18v3m2-3v2m2-2v2m2-2v2 M9 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0z M18 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
    'cluster': 'm12 2 8 4v10l-8 5-8-5V6z M4 6l8 5 8-5m-8 5v10 M8 4l8 5',
    'exascale': 'M2 17h20v3H2z M5 17V7l3-3 3 3v10 M13 17V5l3-3 3 3v12 M5 10h6m2-2h6M5 13h6m2-2h6',
    'mainframe': 'M4 3h16v18H4z M8 6h8v6H8z M7 16h3m2 0h5m-10 2h3',
    'fan': 'M4 3h16v17H4z M7 22v-2m10 2v-2 M12 12c-2-6 2-7 3-5s-1 4-3 5c6-1 7 3 4 4-2 0-3-2-4-4-1 6-6 6-6 3 0-2 4-3 6-3z',
    'ac': 'M2 5h20v12H2z M5 9h7m-7 3h14m-3-4h3m-11 11-1 2m5-2-1 2m5-2-1 2',
    'liquid': 'M12 2s7 8 7 13a7 7 0 0 1-14 0c0-5 7-13 7-13z M8 15a4 4 0 0 0 4 4',
    'tools': 'm4 20 9-9a6 6 0 0 1 7-8l-4 4 2 2 4-4a6 6 0 0 1-8 8l-8 9z',
    'keyboard': 'M2 6h20v12H2z M5 9h1m2 0h1m2 0h1m2 0h1m2 0h1M6 13h1m2 1h7',
    'power': 'M12 2v9 M7 5a9 9 0 1 0 10 0',
    'box': 'm3 7 9-4 9 4v11l-9 4-9-4z M3 7l9 5 9-5m-9 5v10m-4-17 9 5',
    'office': 'M5 3h14v18H5z M8 7h2m4 0h2m-8 4h2m4 0h2m-6 10v-5h4v5',
    'warehouse': 'm2 8 10-6 10 6 M4 8v13h16V8 M8 21V11h8v10m-8-7h8m-8 3h8',
    'dam': 'M2 8h19 M4 8v11m3-11 3 10m0-10 3 10m0-10 3 10m0-10 3 10 M2 20q2-2 4 0t4 0 4 0 4 0 4 0 M5 5h12',
    'penthouse': 'M2 21h20 M5 21V8h4V5h4V2l4 3v16 M8 11h1m3-3h2m-6 6h1m3-3h2m-2 4h2m-2 4h2',
    'bunker': 'M2 19h20 M3 18v-6l5-6h8l5 6v6 M7 13h3m4 0h3 M9 18v-3h6v3',
    'orbital': 'm7 9 5-3 5 3v6l-5 3-5-3z M2 9h3v6H2z M19 9h3v6h-3z M12 6V2m0 16v4 M7 12H5m12 0h2',
    'volcano': 'M2 20 8 8l3 2 2-2 3 1 6 11z M8 8l2 6 3-3 3 5 M9 5 7 3m6 2 1-3m3 5 2-2',
    'home': 'm2 11 10-8 10 8 M5 10v11h14V10 M10 21v-7h4v7',
    'move': 'M2 6h12v11H2z M14 9h4l4 5v3h-8 M8 18a2 2 0 1 1-4 0 2 2 0 1 1 4 0z M20 18a2 2 0 1 1-4 0 2 2 0 1 1 4 0z',
    'sale': 'M3 7h18v13H3z M8 7V4h8v3 M3 11l9 3 9-3m-10 2h2v3h-2z',
    'clock': 'M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0z M12 6v6l4 2',
    'fire': 'M13 2c1 5 8 7 7 13-1 5-5 7-9 6-5-1-8-5-6-10 0 3 2 3 3 3 0-6 4-7 5-12z',
    'shield': 'm12 2 8 3v7c0 5-3 8-8 10-5-2-8-6-8-10V5z m-4 10 3 3 5-6',
    'lock': 'M5 10h14v11H5z M8 10V7a4 4 0 0 1 8 0v3 M12 14v3',
    'gift': 'M3 9h18v4H3z M5 13v8h14v-8 M12 9v12 M12 9C2 9 6-1 12 9c6-10 10 0 0 0z',
    'board': 'm2 8 10-6 10 6z M5 11v7m5-7v7m4-7v7m5-7v7 M2 21h20',
    'arrow': 'M4 12h15m-7-7 7 7-7 7',
    'volume': 'm3 9 4 0 5-4v14l-5-4H3z M15 9q4 3 0 6m3-9q6 6 0 12',
    'save': 'M3 3h15l3 3v15H3z M7 3v6h9V3 M7 21v-8h10v8'
  };
  const sprite = document.createElementNS(ns, 'svg');
  sprite.setAttribute('aria-hidden', 'true');
  sprite.classList.add('ui-sprite');
  const defs = document.createElementNS(ns, 'defs');
  for (const [name, drawing] of Object.entries(paths)) {
    const symbol = document.createElementNS(ns, 'symbol');
    symbol.id = 'icon-' + name;
    symbol.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS(ns, 'path');
    for (const [key, value] of Object.entries({ d: drawing, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) path.setAttribute(key, value);
    symbol.append(path);
    defs.append(symbol);
  }
  sprite.append(defs);
  document.body.prepend(sprite);

  function paint(node, name) {
    if (node.dataset.uiIcon === name && node.firstElementChild) return node;
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.classList.add('ui-glyph');
    const use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#icon-' + name);
    svg.append(use);
    node.replaceChildren(svg);
    node.dataset.uiIcon = name;
    return node;
  }
  window.UIIcons = { paint };
})();
