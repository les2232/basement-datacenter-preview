/*
 * Mom, It's a Startup: the page.
 *
 * economy.js decides the rules; this file shows them on screen, reacts to clicks,
 * tells the story, and saves to the browser's localStorage.
 */
(function () {
  'use strict';

  const E = window.Economy;
  const adConfig = window.ADS;
  const rewardedEnabled = adConfig?.enabled === true && /^(?:ca-)?pub-\d{16}$/.test(adConfig.publisherId);
  const { MACHINES, COOLERS, UPGRADES, STAFF, LOCATIONS, CONFIG } = E;
  const NOTATION_KEY = window.GameChannel.key('basement-datacenter.notation');
  try { E.setNotation(localStorage.getItem(NOTATION_KEY) || 'standard'); } catch { /* Standard notation. */ }
  const money = E.formatMoney;
  const rate = E.formatRate;
  // All money text goes through economy.js so the player's number style (Settings → Numbers)
  // applies everywhere: exact dollars while readable, then K/M/B…/Dc or e-notation.
  const exactMoney = (amount, mode) => E.formatExactMoney(amount, mode);
  const shortMoney = amount => E.formatShortMoney(amount);
  const moveGoalText = exactMoney(CONFIG.moveGoal);
  const dollarsAndCents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const insuranceMoney = amount => (amount < 1e6 && !Number.isInteger(amount) ? dollarsAndCents.format(amount) : exactMoney(amount));
  const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 });
  const starBonus = stars => '+' + percent.format(E.reputationMultiplier(state, stars) - 1);
  const runStarBonus = () => '+' + percent.format(E.runReputationMultiplier(state) - 1);

  const channel = window.GameChannel;
  const SAVE_KEY = channel.saveKey;
  const SNAPSHOTS_KEY = channel.key('basement-datacenter-backups');
  const PREVIOUS_SAVE_KEY = channel.key('basement-datacenter-previous-save');
  const UNDO_SESSION_KEY = channel.key('basement-datacenter-undo-session');
  const PERSIST_REQUESTED_KEY = channel.key('basement-datacenter-persistence-requested');
  const SAVE_EVERY_MS = 5000;
  const FRAME_MS = 100;
  const AWAY_NOTICE_SECONDS = 120; // gaps longer than this get a "while you were gone" summary
  const GOAL_REFRESH_MS = 500;
  const WELCOME_ADVICE_MS = 1000;
  const SHOP_TAP_WINDOW_MS = 10000;
  const ROOM_DROP_LIMIT = 2;       // share the entrance-animation limit across the entire purchase
  const STAFF_RECEIPT_MS = 1800;
  const STAFF_RECEIPT_FADE_MS = 240;
  const MANAGER_DISPLAY_MS = 1000;

  const $ = (id) => document.getElementById(id);
  const el = {
    income: $('income'), throttle: $('throttle'), reserve: $('cooling-reserve'),
    incomeSource: $('income-source'), sysadminReceipt: $('sysadmin-receipt'),
    heatText: $('heat-text'), heatFill: $('heat-fill'), fireproofBadge: $('fireproof-badge'), orbitalHeatRule: $('orbital-heat-rule'),
    fireRisk: $('fire-risk'), fireRiskFill: $('fire-risk-fill'), fireRiskValue: $('fire-risk-value'),
    fireAlarm: $('fire-alarm'), fireCountdown: $('fire-countdown'), fireEdge: $('fire-screen-edge'),
    fireFlash: $('fire-flash'), fireMoment: $('fire-moment'), firePayout: $('fire-payout'), fireRebuild: $('fire-rebuild'),
    powerControl: $('power-control'), powerSlider: $('power-slider'), powerValue: $('power-value'),
    powerReadout: $('power-readout'), powerBest: $('power-best'), powerTarget: $('power-target'), powerCapLabel: $('power-cap-label'),
    incident: $('incident-banner'), incidentTitle: $('incident-title'), incidentTime: $('incident-time'),
    incidentDetail: $('incident-detail'), incidentActions: $('incident-actions'),
    accept: $('incident-accept'), decline: $('incident-decline'),
    goal: $('goal-strip'), goalTitle: $('goal-title'), goalDetail: $('goal-detail'), goalActions: $('goal-actions'),
    footer: document.querySelector('.footer'),
    goalIcon: $('goal-icon'), goalTrack: $('goal-track'), goalFill: $('goal-fill'),
    moveBtn: $('move-btn'), location: $('location'),
    sellBtn: $('sell-btn'), reputation: $('reputation'),
    perkDialog: $('perk-dialog'), perkOptions: $('perk-options'), perkTier: $('perk-tier'),
    jobBtn: $('job-btn'), jobValue: $('job-value'), tapEquivalent: $('tap-equivalent'), tapBoost: $('tap-boost'), tapMultiplier: $('tap-multiplier'),
    room: $('room'), roomInventory: $('room-inventory'), roomTitle: $('room-title'), roomTerms: $('room-terms'), log: $('log'),
    upgradeEmpty: $('upgrade-empty'), installed: $('installed'),
    unlockTeaser: $('unlock-teaser'), unlockText: $('unlock-text'), unlockProgress: $('unlock-progress'),
    saveStatus: $('save-status'), resetBtn: $('reset-btn'),
    modal: $('modal'), modalTitle: $('modal-title'), modalBody: $('modal-body'), modalActions: $('modal-actions'),
    settingsDialog: $('settings-dialog'), photoDialog: $('decor-photo'),
  };

  let state;
  let cards = [];               // { kind, def, el, parts... }
  let roomKey = '';
  let animateStartingRoom = false;
  let installedKey = null;
  let lastSavedAt = 0;
  let storageOk = true;
  let reloadingSave = false;
  let away = null;              // accumulated "while you were gone" report shown in the modal
  let suspended = false;        // hidden tabs settle elapsed time once, on return
  let adPlaying = false;
  let rewardControls;
  const incidentTypes = new Map(E.EVENTS.map(def => [def.id, def]));
  const incidentRemaining = $('incident-remaining');
  let previousOffer = null;
  let previousMoveReady = false;
  let announcedRewards = new Set();
  let lastStats;
  let uiFrame = 0, tickDue = false, powerChanged = false;
  const pendingStaffOrders = [];
  let nextStaffPaint = 0, lastManagerPurchase = -Infinity;
  let saleQuote;
  let saleChallengePicker;

  // ---------------------------------------------------------------------------
  // Story: one-time messages, each shown once per save (remembered in state.flags)
  // ---------------------------------------------------------------------------

  const STORY = [
    { id: 'intro', when: () => true,
      text: "Your parents finally gave you the basement. You have one outlet and one idea: rent out computer time." },
    { id: 'firstLaptop', when: (s) => s.machines.laptop >= 1,
      text: "The laptop whirs to life. Somewhere, a stranger's spreadsheet is being calculated. You get paid every second." },
    { id: 'firstClient', when: s => s.counters.machinesBought >= E.CONTRACT_RULES.unlockMachinesBought, cls: 'good',
      text: 'Your phone buzzes. A bakery chain wants web hosting. Open Goals to pick your first client contract.' },
    { id: 'firstHot', when: (s, st) => st.throttle < 1, cls: 'warn',
      text: "It's getting hot down here! When heat goes over your cooling, every machine slows down. A Box Fan will help." },
    { id: 'firstFan', when: (s) => s.coolers.fan >= 1,
      text: 'The fan rattles to life. Machines run full speed as long as heat stays under cooling.' },
    { id: 'storyFireRebuild', when: s => s.counters.bestFireRebuild >= E.FIRE.charredUntil, cls: 'good',
      text: 'The last scorch mark disappears behind a freshly installed machine. The listing now says “lightly refurbished.”' },
    { id: 'firstTower', when: (s) => s.machines.tower >= 1,
      text: 'Mom asks why the dryer is warm when nobody has used it.' },
    { id: 'thousand', when: (s) => s.lifetime >= 1000, cls: 'good',
      text: 'First $1,000 earned. You celebrate with a second extension cord.' },
    { id: 'firstRack', when: (s) => s.machines.rack >= 1,
      text: 'The rack server boots. Every light in the house dims for a second.' },
    { id: 'overclock', when: (s) => s.upgrades.includes('overclock'), cls: 'warn',
      text: 'You flip every switch to MAX. The basement smells like hot dust. Watch that heat bar.' },
    { id: 'halfway', when: (s) => s.location === 'basement' && s.lifetime >= CONFIG.moveGoal / 2,
      text: "A neighbor asks if you're \"mining crypto down there.\" You say \"sort of.\" Halfway to moving out." },
    { id: 'canMove', when: s => s.location === 'basement' && E.canMove(s), cls: 'big',
      text: `You've earned ${moveGoalText} and outgrown the basement. Press the move button to choose your new home.` },
    { id: 'movedWarehouse', when: (s) => s.location === 'warehouse', cls: 'big',
      text: 'Welcome to the Arctic Warehouse. Your breath fogs. Your machines have never been happier. GPU Rigs unlocked!' },
    { id: 'movedOffice', when: (s) => s.location === 'office', cls: 'big',
      text: 'Welcome to the Downtown Office. Clients pay more for the fancy address. GPU Rigs unlocked!' },
    { id: 'movedMall', when: s => s.location === 'mall', cls: 'big',
      text: 'You roll the first rack past a dry fountain. The old food court has more outlets than customers.' },
    ...Object.entries({
      dam: 'The turbine engineer draws a new red line on the Power dial. “Plenty of river left,” she says.',
      penthouse: 'The concierge hands you two phones. Both are already ringing.',
      bunker: 'The operations manual is in a biscuit tin. Two names are still on the duty roster. Every fire drill is crossed out.',
      orbital: 'Ground control asks if the racks need a breather. Your sibling points out there is nothing up here to breathe.',
      volcano: 'The geothermal hookup comes with an oversized Power dial and an oven mitt.',
    }).map(([id, text]) => ({ id: 'opened:' + id, when: s => s.location === id, cls: 'big', text })),
    { id: 'firstGpu', when: (s) => s.machines.gpu >= 1,
      text: 'The GPU rig spins up. It sounds like a hair dryer having an argument.' },
    { id: 'firstStartupSale', when: s => s.runs >= 1, cls: 'big',
      text: 'You sold the company. Your parents let you have the basement back. Again.' },
    { id: 'returnFounder', when: s => s.runs >= 1 && s.machines.laptop > 0, cls: 'good',
      text: 'The investors call it a serial startup. Your sibling calls it the same laptop.' },
  ];

  function checkStory(st) {
    for (const beat of STORY) {
      if (!state.flags[beat.id] && beat.when(state, st)) {
        state.flags[beat.id] = true;
        log(beat.text, beat.cls);
      }
    }
  }

  function log(text, cls) {
    if (pendingStaffOrders.length) showStaffOrders();
    writeLogRow(text, cls, el.log);
  }

  function writeLogRow(text, cls, target) {
    const total = el.log.children.length + (target === el.log ? 0 : target.childElementCount);
    const li = total >= 40 && el.log.lastElementChild ? el.log.lastElementChild : document.createElement('li');
    setText(li, text);
    li.className = cls || '';
    target.prepend(li);
    if (total === 9) el.log.classList.add('full-log');
  }

  // ---------------------------------------------------------------------------
  // Saving (localStorage; everything stays in this browser)
  // ---------------------------------------------------------------------------

  function readSave() {
    try {
      return localStorage.getItem(SAVE_KEY);
    } catch (e) {
      storageOk = false;
      return null;
    }
  }

  function save() {
    if (reloadingSave || backups.changedInAnotherTab()) return;
    try {
      localStorage.setItem(SAVE_KEY, E.serialize(state));
      storageOk = true;
      lastSavedAt = Date.now();
    } catch (e) {
      storageOk = false;
    }
    backups.flush();
  }

  function wipeSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* nothing to wipe */ }
    backups.clear();
  }

  function createSaveBackups(B) {
    let seconds = 0, snapshots = [], dirty = false;
    let previousSlot = null;
    try {
      previousSlot = localStorage.getItem(PREVIOUS_SAVE_KEY);
      const saved = JSON.parse(localStorage.getItem(SNAPSHOTS_KEY));
      if (B && saved) {
        seconds = B.advanceSnapshotClock(saved.seconds, 0).seconds;
        if (Array.isArray(saved.snapshots)) {
          snapshots = saved.snapshots.filter(entry => Number.isFinite(entry?.savedAt) && typeof entry.save === 'string')
            .slice(0, B.SNAPSHOT_COUNT);
        }
      }
    } catch { /* Unavailable storage or an unreadable snapshot list starts a fresh clock. */ }

    function flush() {
      if (!dirty) return;
      try {
        localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify({ seconds, snapshots }));
        dirty = false;
      } catch { /* The snapshots remain available in memory. Retry on the next save. */ }
    }

    function trackLive(elapsed, now) {
      if (!B || !elapsed) return;
      const clock = B.advanceSnapshotClock(seconds, elapsed);
      seconds = clock.seconds;
      dirty = true;
      if (clock.due) {
        snapshots = B.rotateSnapshots(snapshots, { savedAt: now, save: E.serialize(state) });
        flush();
        settingsPanel?.refreshSnapshots?.();
      }
    }

    function changedInAnotherTab() {
      try {
        if (localStorage.getItem(PREVIOUS_SAVE_KEY) === previousSlot) return false;
      } catch { return false; }
      // A different tab replaced this save. Its fresh copy must survive our next autosave or pagehide.
      if (!reloadingSave) {
        reloadingSave = true;
        location.reload();
      }
      return true;
    }

    function undoSave() {
      try {
        const slot = JSON.parse(localStorage.getItem(PREVIOUS_SAVE_KEY));
        if (slot?.token && slot.token === sessionStorage.getItem(UNDO_SESSION_KEY)) return slot.save;
      } catch { /* Undo belongs to the tab that made the replacement. */ }
      return null;
    }

    function setSlot(storage, key, value) {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    }

    function install(serialized, undoing) {
      if (reloadingSave || changedInAnotherTab()) return;
      const target = B.prepareReplacement(state, serialized, Date.now());
      const next = E.serialize(target.state);
      flush();
      // Prepare Undo before changing the primary key. If any write fails, the old game is still playable.
      let oldToken, oldSlot, sessionWritten = false, slotWritten = false;
      try {
        oldToken = sessionStorage.getItem(UNDO_SESSION_KEY);
        oldSlot = localStorage.getItem(PREVIOUS_SAVE_KEY);
        const token = undoing ? null : crypto.getRandomValues(new Uint32Array(4)).join('-');
        const newSlot = undoing ? null : JSON.stringify({ token, save: target.previous });
        setSlot(sessionStorage, UNDO_SESSION_KEY, token);
        sessionWritten = true;
        setSlot(localStorage, PREVIOUS_SAVE_KEY, newSlot);
        slotWritten = true;
        localStorage.setItem(SAVE_KEY, next);
      } catch {
        try { if (slotWritten) setSlot(localStorage, PREVIOUS_SAVE_KEY, oldSlot); } catch { /* Storage unavailable. */ }
        try { if (sessionWritten) setSlot(sessionStorage, UNDO_SESSION_KEY, oldToken); } catch { /* Storage unavailable. */ }
        throw new Error('Your browser could not save the replacement. Your current game is still open.');
      }
      reloadingSave = true;
      location.reload(); // Use the ordinary startup, offline cap, outstanding perk and tip handling.
    }

    return {
      version: B?.VERSION,
      exportCode: () => B.encodeSave(state),
      decode: code => B.decodeSave(code, Date.now()),
      preview: target => B.preview(target, Date.now()),
      replace: target => install(E.serialize(target), false),
      canUndo: () => Boolean(undoSave()),
      undo() {
        const saved = undoSave();
        if (!saved) throw new Error('There is no previous save to undo in this session.');
        install(saved, true);
      },
      snapshots() {
        const now = Date.now(), result = [];
        for (const { savedAt, save } of snapshots) {
          try { result.push({ at: savedAt, state: B.readSave(save, now) }); } catch { /* Skip a damaged entry. */ }
        }
        return result;
      },
      gameInfo() {
        const width = window.innerWidth, height = window.innerHeight;
        const touch = window.matchMedia('(pointer: coarse)').matches;
        const device = touch ? (Math.min(width, height) >= 600 ? 'tablet' : 'phone') : 'desktop';
        return B.gameInfo(state, { width, height, device, effects: feel.reduced() ? 'Reduced' : 'Full' });
      },
      flush, trackLive, changedInAnotherTab,
      clear() {
        seconds = 0;
        snapshots = [];
        dirty = false;
        previousSlot = null;
        try { localStorage.removeItem(SNAPSHOTS_KEY); } catch { /* Unavailable storage. */ }
        try { localStorage.removeItem(PREVIOUS_SAVE_KEY); } catch { /* Unavailable storage. */ }
        try { sessionStorage.removeItem(UNDO_SESSION_KEY); } catch { /* Unavailable storage. */ }
      },
    };
  }

  async function requestPersistentStorage() {
    try {
      if (!navigator.storage?.persist) return;
      try {
        if (localStorage.getItem(PERSIST_REQUESTED_KEY)) return;
        localStorage.setItem(PERSIST_REQUESTED_KEY, '1');
      } catch { /* Storage may be unavailable; try once for this visit. */ }
      await navigator.storage.persist();
    } catch { /* Normal browser saving still works if persistence is denied. */ }
  }

  // ---------------------------------------------------------------------------
  // Feedback helpers
  // ---------------------------------------------------------------------------

  function centerOf(node) {
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // ---------------------------------------------------------------------------
  // Shop
  // ---------------------------------------------------------------------------

  const QUANTITY_KEY = channel.key('basement-datacenter-shop-quantity');
  const SHOP_TAB_KEY = channel.key('basement-datacenter-shop-tab');
  const shopTabs = new Map();
  const quantityControl = $('shop-quantity');
  let quantity = '1';
  let activeShopTab = 'machine';
  let lastAdviceAt = -Infinity;
  let bestPurchase = null;
  const recentTaps = [];
  let shopTabsInView = false;
  const cardByRow = new WeakMap();
  const adviceObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      const card = cardByRow.get(entry.target);
      if (card) card.inView = entry.isIntersecting;
      else shopTabsInView = entry.isIntersecting;
    }
  }) : null;

  function buildShopTabs() {
    const list = $('shop-tabs');
    adviceObserver?.observe(list);
    for (const [kind, label] of Object.entries({ machine: 'Machines', cooler: 'Cooling', upgrade: 'Upgrades', staff: 'Staff' })) {
      const panel = $('shop-panel-' + kind);
      const button = make('button', null, label);
      button.type = 'button';
      button.id = 'shop-tab-' + kind;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', panel.id);
      const signals = make('span', 'shop-tab-signals');
      const dot = make('span', 'shop-tab-dot');
      const star = UIIcons.paint(make('span', 'shop-tab-star'), 'star');
      dot.setAttribute('role', 'img');
      dot.setAttribute('aria-label', 'New or newly affordable item');
      star.setAttribute('role', 'img');
      star.setAttribute('aria-label', 'Contains the best buy');
      dot.hidden = star.hidden = true;
      signals.append(dot, star);
      button.append(signals);
      list.append(button);
      shopTabs.set(kind, { button, panel, dot, star, flag: 'shop-unread:' + kind });
      button.addEventListener('click', () => selectShopTab(kind));
      button.addEventListener('keydown', event => {
        const available = [...shopTabs.keys()].filter(k => k !== 'staff' && !shopTabs.get(k).button.hidden);
        const i = available.indexOf(kind);
        const keys = { ArrowRight: (i + 1) % available.length, ArrowLeft: (i - 1 + available.length) % available.length,
          Home: 0, End: available.length - 1 };
        if (!Object.hasOwn(keys, event.key)) return;
        event.preventDefault();
        const next = available[keys[event.key]];
        selectShopTab(next);
        shopTabs.get(next).button.focus();
      });
    }
    try {
      const saved = localStorage.getItem(SHOP_TAB_KEY);
      if (shopTabs.has(saved)) activeShopTab = saved;
    } catch { /* Keep the default tab when storage is unavailable. */ }
  }

  function showShopTab() {
    for (const [kind, tab] of shopTabs) {
      const selected = kind === activeShopTab;
      tab.button.setAttribute('aria-selected', String(selected));
      tab.button.tabIndex = selected ? 0 : -1;
      setHidden(tab.panel, !selected);
      if (selected) delete state.flags[tab.flag];
      setHidden(tab.dot, !state.flags[tab.flag]);
    }
  }

  function selectShopTab(kind) {
    if (kind === activeShopTab || shopTabs.get(kind).button.hidden) return;
    activeShopTab = kind;
    try { localStorage.setItem(SHOP_TAB_KEY, kind); } catch { /* The selection works in memory. */ }
    const st = lastStats || E.stats(state);
    refreshShopCards(st, true);
    showShopTab();
    for (const card of revealedCards) {
      if (card.kind === kind) showBestPurchase(card);
    }
    shopMoney = undefined;
    renderShop(st, true);
  }

  function markShopTab(kind) {
    if (activeShopTab === kind) return;
    const tab = shopTabs.get(kind);
    state.flags[tab.flag] = true;
    setHidden(tab.dot, false);
  }

  function initQuantity() {
    const radios = Array.from(quantityControl.querySelectorAll('input'));
    try {
      const saved = localStorage.getItem(QUANTITY_KEY);
      if (radios.some((radio) => radio.value === saved)) quantity = saved;
    } catch { /* The selector still works in memory. */ }
    for (const radio of radios) radio.checked = radio.value === quantity;
    quantityControl.addEventListener('change', (event) => {
      quantity = event.target.value;
      try { localStorage.setItem(QUANTITY_KEY, quantity); } catch { /* Keep the session preference. */ }
      renderShop(E.stats(state));
    });
  }

  function make(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function buildShop() {
    initQuantity();
    buildShopTabs();
    cards = [];
    const groups = [['machine', MACHINES], ['cooler', COOLERS], ['upgrade', UPGRADES], ['staff', STAFF]];
    for (const [kind, list] of groups) {
      const container = $('shop-' + kind);
      container.textContent = '';
      for (const def of list) {
        const button = make('button', 'card');
        button.type = 'button';
        button.dataset.kind = kind;
        button.dataset.item = def.id;
        if (kind === 'staff') button.id = 'staff-' + def.id;
        const icon = UIIcons.paint(make('span', 'card-icon'), def.icon);
        const main = make('span', 'card-main');
        const title = make('span', 'card-title');
        const name = make('span', 'card-name', def.name);
        const owned = make('span', 'card-owned');
        title.append(name, owned);
        const desc = make('span', 'card-desc');
        const blurb = make('span', 'card-blurb', def.blurb || '');
        blurb.hidden = !def.blurb;
        main.append(title, desc, blurb);
        // One short line of buying advice stays visible in the collapsed row.
        const advice = make('span', 'card-advice');
        const best = make('span', 'card-best');
        best.append(UIIcons.paint(make('span', 'best-buy-star'), 'star'), make('span'));
        const payback = make('span', 'card-payback');
        const eta = make('span', 'card-eta');
        best.hidden = payback.hidden = eta.hidden = true;
        advice.append(eta, payback);
        main.append(advice);
        const price = make('span', 'card-price');
        const costEl = make('span', 'card-cost');
        const shortfall = make('small', 'card-shortfall');
        price.append(costEl, shortfall, best);
        const symbol = make('span', 'card-symbol');
        const badge = make('span', 'card-new', 'NEW');
        badge.hidden = true;
        symbol.append(icon, badge);
        const funds = make('span', 'card-funds');
        funds.setAttribute('aria-hidden', 'true');
        const fill = make('span', 'card-funds-fill');
        funds.appendChild(fill);
        button.append(symbol, main, price, funds);
        const row = make('div', 'card-row');
        const acknowledge = make('button', 'ack-item');
        acknowledge.type = 'button';
        acknowledge.hidden = true;
        acknowledge.setAttribute('aria-label', `Mark ${def.name} as seen`);
        const detail = make('details', 'item-details');
        const detailLabel = make('summary', null, kind === 'staff' ? 'Role details' : 'Specs and payoff');
        detailLabel.setAttribute('aria-label', `${detailLabel.textContent} for ${def.name}`);
        const detailText = make('p', 'card-info');
        detail.append(detailLabel, detailText);
        detail.addEventListener('toggle', () => {
          if (detail.open) renderCardDetails(card, E.stats(state));
        });
        row.append(button, acknowledge, detail);
        container.appendChild(row);

        const card = { kind, def, el: button, row, owned, desc, cost: costEl, shortfall,
          badge, acknowledge, funds, fill, best, payback, eta, detail, detailText,
          newFlag: `shop-new:${kind}:${def.id}` };
        // An open disclosure may still be visible after its purchase button
        // scrolls away. Keep its live advice current until the whole row leaves.
        cardByRow.set(row, card);
        adviceObserver?.observe(row);
        if (kind === 'machine') {
          // Shown in the row only when the selected quantity would reach a milestone.
          card.milestoneHit = make('span', 'card-milestone-hit');
          card.milestoneHit.hidden = true;
          main.append(card.milestoneHit);
          const label = make('span', 'card-milestone-label');
          const track = make('span', 'card-milestone-track');
          const fill = make('span', 'card-milestone-fill');
          track.setAttribute('aria-hidden', 'true');
          track.appendChild(fill);
          detail.append(label, track);
          card.milestone = { label, track, fill, lastOwned: null };
        }
        button.addEventListener('click', () => onBuy(card));
        // The purchase stays natively disabled. This second, keyboard-accessible hit area
        // lets someone dismiss NEW without ever buying an item they cannot afford.
        acknowledge.addEventListener('click', () => {
          delete state.flags[card.newFlag];
          card.badge.hidden = card.acknowledge.hidden = true;
          save();
        });
        cards.push(card);
      }
    }
  }

  function renderCardDetails(card, st) {
    if (!card.detail.open) return;
    const outputNote = card.kind === 'machine'
      ? 'Heat can reduce this output. Buy any recommended cooling separately.' : '';
    setText(card.detailText, [card.def.blurb || card.def.desc, describe(card, st),
      outputNote, exactPriceText(card)].filter(Boolean).join(' '));
  }

  // Between two consecutive Max totals the affordable count cannot change. Reuse
  // that quote while money ticks up, or until a purchase changes the owned count.
  function quoteFor(card, owned = E.ownedCount(state, card.kind, card.def.id)) {
    const { kind, def } = card;
    const mode = kind === 'machine' || kind === 'cooler' ? quantity : '1';
    const cached = card.quote;
    if (cached && cached.owned === owned && cached.mode === mode &&
        (mode !== 'max' || (state.money >= cached.total && state.money < cached.nextTotal))) return cached;

    const count = mode === 'max' ? E.maxAffordable(state, kind, def.id) : Number(mode);
    const total = E.bulkCost(state, kind, def.id, count);
    const nextTotal = mode === 'max' && count < CONFIG.maxBulkBuy
      ? total + E.price(def, owned + count, state) : Infinity;
    const prefix = mode === 'max' ? `Max (${count}) · ` : '';
    card.quote = { mode, owned, count, total, nextTotal, prefix };
    return card.quote;
  }

  // Money inside a shop card: the exact amount, plus a compact copy (e.g. $2.70M) that
  // narrow layouts show instead. Neither copy can break inside the number, and the
  // compact one rounds up so it never understates a price or a shortfall.
  function setAmount(node, prefix, amount, suffix = '') {
    const full = exactMoney(amount, 'ceil');
    const compact = money(amount, 'ceil');
    const key = `${prefix}|${full}|${suffix}`;
    if (node.dataset.amountKey === key) return;
    node.dataset.amountKey = key;
    const parts = [];
    // The prefix ("Max (12) · ", "Need ") may wrap; the amount and "Buy" never split.
    if (prefix) parts.push(make('span', 'price-prefix', prefix));
    if (compact === full) {
      parts.push(make('span', 'price-amount', full));
    } else {
      parts.push(make('span', 'price-amount money-full', full), make('span', 'price-amount money-compact', compact));
    }
    if (suffix) parts.push(suffix);
    node.replaceChildren(...parts);
    node.title = `${prefix}${full}${suffix}`;
  }

  // Non-money requirements for a shop item, refreshed whenever the shop structure changes.
  function purchaseBlocker(def) {
    return E.requirementBlocker(state, def);
  }

  function setPlain(node, text) {
    if (node.dataset.amountKey) {
      delete node.dataset.amountKey;
      node.removeAttribute('title');
    }
    setText(node, text);
  }

  function exactPriceText(card) {
    if (card.kind === 'staff' && E.ownedCount(state, card.kind, card.def.id) >= card.def.prices.length) return '';
    const quote = quoteFor(card);
    const amount = exactMoney(quote.count ? quote.total : quote.nextTotal, 'ceil');
    if (quote.mode === 'max') return quote.count ? `Exact price for ${quote.count}: ${amount}.` : `Exact price for 1: ${amount}.`;
    return `Exact price${quote.count > 1 ? ` for ${quote.count}` : ''}: ${amount}.`;
  }

  function onBuy(card) {
    if (card.kind !== activeShopTab || card.el.hidden || modalOpen() || suspended || document.hidden) return;
    if (card.kind === 'staff' && card.def.id !== 'sibling' && state.staff[card.def.id]) {
      if (card.def.id === 'manager') state.managerEnabled = !state.managerEnabled;
      else state.staff.sysadminEnabled = !state.staff.sysadminEnabled;
      render();
      save();
      return;
    }
    if (!settleBeforePurchaseOrMove()) return;
    const { count } = quoteFor(card);
    if (!count) return;
    const result = E.buyMany(state, card.kind, card.def.id, count);
    if (!result.ok) return;
    purchaseLog(card, result);
    feel.spend(card.el, result.cost, card.kind === 'upgrade');
    feel.purchase(result.count);
    render();
    save();
  }

  function purchaseLog(card, result) {
    delete state.flags[card.newFlag];
    const spent = exactMoney(result.cost);
    if (card.kind === 'upgrade') {
      log(`Installed ${card.def.name}: ${card.def.desc}`, 'good');
    } else if (card.kind === 'staff') {
      const level = state.staff[card.def.id];
      log(level === 1 ? `Hired ${card.def.name} for ${spent}.` :
        `${card.def.name} reached level ${level} for ${spent}.`, 'good');
    } else {
      const name = result.count === 1 ? card.def.name : card.def.name + 's';
      log(`Bought ${result.count} ${name} for ${spent}.`);
    }
  }

  // Text for a card's middle line, using the CURRENT multipliers so upgrades are reflected.
  function describe(card, st) {
    const id = card.def.id;
    if (card.kind === 'machine') {
      return `Up to ${rate(st.incomePerUnit[id])}\u00a0each · +${E.formatNumber(st.heatPerUnit[id])}\u00a0heat`;
    }
    if (card.kind === 'cooler') return `+${E.formatNumber(st.coolingPerUnit[id])}\u00a0cooling each`;
    if (card.kind === 'staff') {
      if (id === 'sysadmin') return `Buys cooling above 100% load. Spends up to ${CONFIG.sysadminSpendShare * 100}% of cash per purchase.`;
      if (id === 'manager') return `Up to ${1000 / E.MANAGER.intervalMs} purchases/s. Skips purchases that would risk a fire.`;
      const next = card.def.jobsPerSecond[state.staff.sibling];
      const current = st.siblingJobsPerSecond ? `${st.siblingJobsPerSecond} ${st.siblingJobsPerSecond === 1 ? 'job' : 'jobs'}/s · ${rate(st.staffIncome)}` : '';
      if (!next) return current;
      const nextPay = rate(next * (st.siblingJobPay ?? st.clickValue));
      return current ? `${current} → ${next} jobs/s · ${nextPay}` : `Runs 1 job/s · ${nextPay}`;
    }
    return card.def.desc;
  }

  function renderMachineMilestone(card, visibleTab) {
    const { id, name } = card.def;
    const owned = state.machines[id];
    const progress = card.milestone;
    if (visibleTab && progress.shownOwned !== owned) {
      const next = E.nextMilestone(owned);
      const multiplier = E.milestoneMult(next ? next.count : owned, state).toLocaleString('en-US');
      setText(progress.label, next
        ? `Next bonus: ${next.count} owned → ${multiplier}× (${owned}/${next.count})`
        : `Milestones maxed: ${multiplier}×`);
      setHidden(progress.track, !next);
      if (next) progress.fill.style.transform = `scaleX(${owned / next.count})`;
      progress.shownOwned = owned;
    }
    if (progress.lastOwned === owned) return;

    // On the first render, quietly record thresholds already present in an older save.
    // Purchases and free hardware both trigger this same check when the count changes.
    let latestBonus = 0;
    for (const tier of E.MILESTONES) {
      if (owned < tier.count) break;
      const flag = `milestone:${id}:${tier.count}`;
      const crossedAgain = (state.runs > 0 || state.fireRunBurned) && progress.lastOwned !== null && progress.lastOwned < tier.count;
      if (state.flags[flag] && !crossedAgain) continue;
      state.flags[flag] = true;
      if (progress.lastOwned === null) continue;
      latestBonus = E.milestoneMult(tier.count, state);
      log(`${tier.count} ${name}s! Milestone income bonus: ${latestBonus.toLocaleString('en-US')}×.`, 'big');
    }
    progress.lastOwned = owned;
    if (latestBonus) {
      // A bulk purchase can earn several tiers. Log each tier and celebrate the total once.
      guidance.milestone();
      feel.milestone(card.el, name, latestBonus);
    }
  }

  // Start with what this save already knows. Offline income can then reveal new items
  // on the very first frame without replaying unlock messages for the whole shop.
  function rememberRevealedItems(newRun = false) {
    announcedRewards = new Set(state.challengeRewards);
    shopStructure = '';
    shopStats = null;
    shopPriceKey = '';
    bestPurchase = null;
    recentTaps.length = 0;
    for (const tab of shopTabs.values()) {
      if (newRun) delete state.flags[tab.flag];
      setHidden(tab.star, true);
    }
    for (const card of cards) {
      card.wasRevealed = E.isRevealed(state, card.kind, card.def.id);
      card.blocker = purchaseBlocker(card.def);
      card.eligible = !card.blocker;
      card.quote = null;
      card.dotPrice = null;
      card.wasAffordable = card.wasRevealed && affordableForDot(card, E.ownedCount(state, card.kind, card.def.id));
      card.displayedAffordable = null;
      card.displayedStatus = null;
      for (const line of [card.best, card.payback, card.eta]) setHidden(line, true);
      card.el.classList.remove('can-shimmer', 'reveal-flash', 'is-best', 'is-locked');
    }
    const staffShown = cards.some(card => card.kind === 'staff' && card.wasRevealed);
    setHidden(shopTabs.get('staff').button, !staffShown);
    if (activeShopTab === 'staff' && !staffShown) {
      activeShopTab = 'machine';
      try { localStorage.setItem(SHOP_TAB_KEY, activeShopTab); } catch { /* Keep the session preference. */ }
    }
    showShopTab();
  }

  let displayedUnlock = null;
  function renderUnlockTeaser(next) {
    if (!next) {
      if (!el.unlockTeaser.hidden) el.unlockTeaser.hidden = true;
      displayedUnlock = null;
      return;
    }
    if (!displayedUnlock || displayedUnlock.kind !== next.kind || displayedUnlock.at !== next.at) {
      const target = next.at.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(next.at) ? 0 : 2 });
      setText(el.unlockText, `New ${next.kind === 'staff' ? 'hire' : next.kind} at $${target} earned this run`);
      displayedUnlock = next;
    }
    const percent = Math.min(100, Math.floor(state.lifetime / next.at * 100));
    if (el.unlockProgress.value !== percent) el.unlockProgress.value = percent;
    if (el.unlockTeaser.hidden) el.unlockTeaser.hidden = false;
  }

  let shopStructure = '';
  let shopPriceKey = '';
  let shopStats = null;
  let nextUnlock = null;
  let shopMoney, shopQuantity, shopLifetime;
  const revealedCards = [];

  let shopDetailsPending = false;
  function refreshShopCards(st, showDetails) {
    shopDetailsPending = !showDetails;
    let anyUpgradeShown = false;
    let anyCoolerShown = false;
    let anyStaffShown = false;
    revealedCards.length = 0;
    for (const card of cards) {
      const { kind, def } = card;
      const isUpgrade = kind === 'upgrade';
      const bought = isUpgrade && state.upgrades.includes(def.id);
      const revealed = E.isRevealed(state, kind, def.id);
      if (revealed && !card.wasRevealed) {
        state.flags[card.newFlag] = true;
        markShopTab(kind);
        if (kind === activeShopTab && !feel.reduced()) card.el.classList.add('reveal-flash');
        log(`Unlocked: ${def.name}`, 'good');
      }
      card.wasRevealed = revealed;
      const active = kind === activeShopTab;
      if (active) {
        setHidden(card.row, bought || !revealed);
        setHidden(card.el, bought || !revealed);
      }
      if (bought || !revealed) continue;
      if (isUpgrade) anyUpgradeShown = true;
      if (kind === 'cooler') anyCoolerShown = true;
      if (kind === 'staff') anyStaffShown = true;

      card.ownedCount = E.ownedCount(state, kind, def.id);
      card.blocker = purchaseBlocker(def);
      card.eligible = !card.blocker;
      revealedCards.push(card);
      if (kind === 'machine') renderMachineMilestone(card, active);
      if (!active) continue;
      let ownedLabel = isUpgrade ? '' : '×' + card.ownedCount;
      if (kind === 'staff') {
        ownedLabel = def.id === 'sibling' ? `Lv ${card.ownedCount}/${def.prices.length}` : (card.ownedCount ? 'Hired' : '');
        if (def.id !== 'sibling') {
          const enabled = def.id === 'manager' ? state.managerEnabled : state.staff.sysadminEnabled;
          if (card.ownedCount && card.el.getAttribute('aria-pressed') !== String(enabled)) card.el.setAttribute('aria-pressed', String(enabled));
          else if (!card.ownedCount && card.el.hasAttribute('aria-pressed')) card.el.removeAttribute('aria-pressed');
        }
      }
      setText(card.owned, ownedLabel);
      const statValue = kind === 'machine' ? st.incomePerUnit[def.id] : kind === 'cooler' ? st.coolingPerUnit[def.id] :
        def.id === 'sibling' ? st.siblingJobPay : 0;
      const detailValue = kind === 'machine' ? st.heatPerUnit[def.id] : def.id === 'sibling' ? state.staff.sibling : 0;
      if (showDetails && (statValue !== card.statValue || detailValue !== card.detailValue)) {
        setText(card.desc, describe(card, st));
        card.statValue = statValue;
        card.detailValue = detailValue;
      }
      setHidden(card.badge, !state.flags[card.newFlag]);
    }
    if (activeShopTab === 'upgrade') setHidden(el.upgradeEmpty, anyUpgradeShown);
    if (activeShopTab === 'cooler') setHidden($('cooler-empty'), anyCoolerShown);
    setHidden(shopTabs.get('staff').button, !anyStaffShown);
    if (activeShopTab === 'staff') {
      setHidden($('manager-budget-control'), !state.staff.manager);
      if (state.staff.manager) showManagerBudget();
    }
    nextUnlock = E.nextReveal(state);

    if (activeShopTab !== 'upgrade') return;
    const key = state.upgrades.join(',');
    if (key !== installedKey) {
      installedKey = key;
      el.installed.textContent = '';
      for (const id of state.upgrades) {
        const u = E.lookup('upgrade', id);
        const chip = make('span', 'chip', `${u.name} · ${u.desc}`);
        el.installed.appendChild(chip);
      }
      el.installed.hidden = state.upgrades.length === 0;
    }
  }

  // An inactive tab needs just one price threshold per item for its notification.
  // Max becomes available at the price of one, regardless of the eventual Max count.
  function affordableForDot(card, owned) {
    const { kind, def } = card;
    if (kind === 'staff' && owned === def.prices.length) return false;
    const count = (kind === 'machine' || kind === 'cooler') && quantity !== 'max' ? Number(quantity) : 1;
    if (!card.dotPrice || card.dotPrice.owned !== owned || card.dotPrice.count !== count) {
      card.dotPrice = { count, owned, total: E.bulkCost(state, kind, def.id, count) };
    }
    return state.money >= card.dotPrice.total && card.eligible;
  }

  function renderShop(st, showDetails = !pendingStaffOrders.length) {
    // Taps reuse the last production snapshot. On timer ticks, inventory, location
    // and incident changes can also alter requirements or the per-unit description.
    let refresh = state.lifetime < shopLifetime || (nextUnlock != null && state.lifetime >= nextUnlock.at);
    shopLifetime = state.lifetime;
    if (shopStats !== st) {
      shopStats = st;
      const priceKey = JSON.stringify([state.sites, state.location, state.extraLocation, state.perks, state.stars, state.challenge, state.challengeRewards]);
      if (priceKey !== shopPriceKey) {
        shopPriceKey = priceKey;
        for (const card of cards) { card.quote = null; card.dotPrice = null; }
      }
      const key = JSON.stringify([state.machines, state.coolers, state.upgrades, state.staff, state.location,
        state.active?.id, state.active?.side, priceKey, st.power, !!state.flags.fireSmokeSeen, state.managerEnabled,
        !!state.perkChoicePending]);
      refresh = refresh || key !== shopStructure;
      shopStructure = key;
    }
    if (refresh || (showDetails && shopDetailsPending)) refreshShopCards(st, showDetails);
    renderUnlockTeaser(nextUnlock);
    if (!refresh && shopMoney === state.money && shopQuantity === quantity) return;
    shopMoney = state.money;
    shopQuantity = quantity;

    for (const card of revealedCards) {
      if (card.kind !== activeShopTab) {
        const affordable = affordableForDot(card, card.ownedCount);
        if (affordable && !card.wasAffordable) markShopTab(card.kind);
        card.wasAffordable = affordable;
        continue;
      }
      renderCardDetails(card, st);
      if (card.kind === 'staff' && card.ownedCount === card.def.prices.length) {
        const toggle = card.def.id !== 'sibling';
        if (card.el.disabled !== !toggle) card.el.disabled = !toggle;
        card.el.classList.toggle('affordable', toggle);
        const control = card.def.id === 'manager' ? `Auto-buying ${state.managerEnabled ? 'on' : 'off'}` :
          `Auto-cooling ${state.staff.sysadminEnabled ? 'on' : 'off'}`;
        setPlain(card.cost, toggle ? control : 'Max level');
        setHidden(card.shortfall, true);
        setHidden(card.funds, true);
        setHidden(card.acknowledge, true);
        card.el.classList.remove('is-locked');
        card.displayedQuote = null;
        card.displayedStatus = null;
        card.wasAffordable = false;
        card.displayedAffordable = null;
        card.el.classList.remove('is-best');
        for (const line of [card.best, card.payback, card.eta]) setHidden(line, true);
        continue;
      }
      const quote = quoteFor(card, card.ownedCount);
      if (card.displayedQuote !== quote) {
        card.displayedQuote = quote;
        setAmount(card.cost, quote.prefix, quote.total);
      }
      // A requirement (e.g. a later expansion stage) and a cash shortage are different
      // blockers: a locked card explains the requirement and never shows a funds bar.
      const blocker = state.perkChoicePending ? { type: 'perk-choice' } : card.blocker;
      const status = E.purchaseStatus(state, card.kind, card.def.id, quote, blocker);
      const affordable = status.status === 'ready';
      if (affordable !== card.displayedAffordable) {
        card.el.disabled = !affordable;
        card.el.classList.toggle('affordable', affordable);
        if (!affordable) card.el.classList.remove('can-shimmer');
        else if (card.wasAffordable === false && !feel.reduced() && !managerBurst()) card.el.classList.add('can-shimmer');
        card.displayedAffordable = affordable;
      }
      card.wasAffordable = affordable;
      setHidden(card.acknowledge, affordable || card.badge.hidden);
      const locked = status.status === 'locked';
      const short = status.status === 'short';
      if (card.displayedStatus !== status.status) {
        card.displayedStatus = status.status;
        card.el.classList.toggle('is-locked', locked);
        setHidden(card.shortfall, !locked && !short);
        setHidden(card.funds, !short);
        if (!short) setHidden(card.eta, true);
        if (locked) setHidden(card.payback, true);
        card.lastShortfall = card.lockedText = card.fraction = null;
      }
      if (card.milestoneHit) renderMilestoneHit(card, quote, locked);
      if (locked) {
        const text = E.requirementText(state, status.blocker, card.ownedCount);
        if (card.lockedText !== text) {
          card.lockedText = text;
          setPlain(card.shortfall, text);
        }
        continue;
      }
      if (!short) continue;
      if (card.lastShortfall !== status.shortfall) {
        card.lastShortfall = status.shortfall;
        setAmount(card.shortfall, 'Need ', status.shortfall, ' more');
      }
      const fraction = Math.min(1000, Math.round(status.fraction * 1000));
      if (card.fraction !== fraction) {
        card.fraction = fraction;
        card.fill.style.transform = `scaleX(${fraction / 1000})`;
      }
    }
  }

  // The highest ownership milestone the selected quantity would reach, if any.
  function renderMilestoneHit(card, quote, locked) {
    const owned = card.ownedCount;
    let tier = null;
    if (!locked && quote.count) {
      for (const t of E.MILESTONES) if (t.count > owned && t.count <= owned + quote.count) tier = t;
    }
    const text = tier
      ? `Reaches ${tier.count} owned → ${E.milestoneMult(tier.count, state).toLocaleString('en-US')}×\u00a0output`
      : '';
    setText(card.milestoneHit, text);
    setHidden(card.milestoneHit, !text);
  }

  function bestBuyLabel(best) {
    const label = quantity !== '1' && (best.kind === 'machine' || best.kind === 'cooler') ? 'Best buy for one' : 'Best buy';
    const cooling = new Map();
    if (best.kind === 'machine') {
      for (const step of best.steps) {
        if (step.kind === 'cooler') cooling.set(step.id, (cooling.get(step.id) || 0) + 1);
      }
    }
    const additions = [...cooling].map(([id, count]) => `+${count} ${E.lookup('cooler', id).name}${count === 1 ? '' : 's'}`);
    return additions.length ? `${label} (${additions.join(', ')} for heat)` : label;
  }

  function showBestPurchase(card) {
    const best = card.kind === bestPurchase?.kind && card.def.id === bestPurchase.id;
    if (best) setText(card.best.lastElementChild, bestBuyLabel(bestPurchase));
    setHidden(card.best, !best);
    card.el.classList.toggle('is-best', best);
  }

  function recentTapRate(now) {
    let expired = 0;
    while (expired < recentTaps.length && recentTaps[expired].at <= now - SHOP_TAP_WINDOW_MS) expired++;
    if (expired) recentTaps.splice(0, expired);
    return recentTaps.length * 1000 / SHOP_TAP_WINDOW_MS;
  }

  function updateShopAdvice() {
    const now = performance.now();
    if (now - lastAdviceAt < (managerBurst() ? MANAGER_DISPLAY_MS : 500)) return;
    lastAdviceAt = now;
    const tapsPerSecond = recentTapRate(now);
    if (adviceObserver && !shopTabsInView && !revealedCards.some(card => card.kind === activeShopTab && card.inView)) return;
    bestPurchase = E.bestBuy(state, tapsPerSecond);
    for (const [kind, tab] of shopTabs) setHidden(tab.star, bestPurchase?.kind !== kind);
    for (const card of revealedCards) {
      if (card.kind !== activeShopTab) continue;
      if (card.kind === 'staff' && card.ownedCount === card.def.prices.length) continue;
      showBestPurchase(card);
      // Advice lines are part of each collapsed row, so fill the whole visible category
      // (well under a millisecond per pass). Rows then keep their height while scrolling.
      const selectedCount = quoteFor(card, card.ownedCount).count;
      const count = selectedCount || 1;
      const quote = E.purchaseQuote(state, card.kind, card.def.id, count, tapsPerSecond);
      // Payback is advice about a purchase plan: for a machine it may include cooling
      // that a tap on the card does not buy. Its qualifiers stay with the estimate.
      let payback = E.formatPayback(quote?.paybackSeconds);
      if (payback && selectedCount === 0) payback += ' for one';
      if (payback && card.kind === 'machine' && quote.steps.length > count) payback += ' with cooling';
      // Only a cash shortage gets a wait estimate. A locked item explains its requirement.
      let eta = card.displayedStatus === 'short' ? E.formatAffordable(quote?.affordableSeconds) : '';
      if (eta === 'Affordable now') eta = '';
      if (eta && selectedCount === 0) eta += ' for one';
      setText(card.payback, payback);
      setText(card.eta, eta);
      setHidden(card.payback, !payback);
      setHidden(card.eta, !eta);
    }
  }

  const managerBudget = $('manager-budget');
  managerBudget.min = E.MANAGER.budgets[0];
  managerBudget.max = E.MANAGER.budgets[E.MANAGER.budgets.length - 1];
  managerBudget.step = E.MANAGER.budgets[1] - E.MANAGER.budgets[0];
  function showManagerBudget() {
    const budget = String(state.managerBudget);
    if (managerBudget.value !== budget) managerBudget.value = budget;
    const label = budget + '% of current cash';
    if (managerBudget.getAttribute('aria-valuetext') !== label) managerBudget.setAttribute('aria-valuetext', label);
    setText($('manager-budget-value'), state.managerBudget + '%');
  }
  managerBudget.addEventListener('input', () => {
    E.setManagerBudget(state, Number(managerBudget.value));
    showManagerBudget();
  });
  managerBudget.addEventListener('change', save);

  // ---------------------------------------------------------------------------
  // The room: a picture of everything you own
  // ---------------------------------------------------------------------------

  let receiptInView = true;
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver(([entry]) => {
      el.room.classList.toggle('outside-view', !entry.isIntersecting);
    }).observe(el.room);
    new IntersectionObserver(([entry]) => {
      receiptInView = entry.isIntersecting;
    }).observe(el.sysadminReceipt.parentElement);
  }
  const roomStageThresholds = [5, 20, 50];
  const dollhouse = RoomScene.mount(el.roomInventory);
  let roomIncome, roomPower, fanPeriodMs;
  function renderRoom(st) {
    const heat = st.throttle < 1 ? 'hot' : st.load >= .88 * st.freeLoad ? 'warm' : 'cool';
    if (el.room.dataset.heat !== heat) {
      el.room.dataset.heat = heat;
      document.documentElement.classList.toggle('room-throttled', heat === 'hot');
    }
    if (roomIncome !== st.income || roomPower !== st.power) {
      roomIncome = st.income;
      roomPower = st.power;
      const neutral = st.power === E.POWER.normal ? st.income : E.stats({ ...state, power: E.POWER.normal }).income;
      const period = Math.round(1800 / (1 + Math.log10(1 + neutral)) / st.power);
      if (fanPeriodMs !== period) {
        fanPeriodMs = period;
        el.room.style.setProperty('--fan-period', period + 'ms');
      }
    }
    const fleet = E.machineCount(state);
    const stage = roomStageThresholds.filter(count => fleet >= count).length;
    if (el.room.dataset.stage !== String(stage)) el.room.dataset.stage = String(stage);
    const animate = (animateStartingRoom || !!roomKey) && !feel.reduced();
    dollhouse.render(state, stage, animate ? ROOM_DROP_LIMIT : 0);
    roomKey = state.location;
    animateStartingRoom = false;
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  let shownPower = null, shownPowerHeat = null, shownBest = null, shownPowerMax = null, shownPowerLabel = '';
  const bestPercent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });
  el.powerSlider.min = E.POWER.min;
  el.powerSlider.step = E.POWER.step;

  function showPowerValue(power, heatMultiplier) {
    if (shownPower === power && shownPowerHeat === heatMultiplier) return;
    shownPower = power;
    shownPowerHeat = heatMultiplier;
    const value = Math.round(power * 100) + '%';
    el.powerSlider.value = power;
    el.powerSlider.setAttribute('aria-valuetext', value);
    setText(el.powerValue, value);
    setText(el.powerReadout, `Income ×${power.toFixed(2)} · Heat ×${heatMultiplier.toFixed(2)}`);
  }

  function renderPower(st, signature) {
    const unlocked = E.powerUnlocked(state, st);
    setHidden(el.powerControl, !unlocked);
    if (!unlocked) return;
    const max = signature.powerMax;
    if (shownPowerMax !== max || shownPowerLabel !== signature.powerLabel) {
      shownPowerMax = max;
      shownPowerLabel = signature.powerLabel;
      shownBest = null;
      el.powerSlider.max = max;
      el.powerControl.style.setProperty('--standard-power-end', ((E.POWER.max - E.POWER.min) / (max - E.POWER.min) * 100) + '%');
      el.powerControl.classList.toggle('has-site-power', !!shownPowerLabel);
      setHidden(el.powerCapLabel, !shownPowerLabel);
      if (shownPowerLabel) setText(el.powerCapLabel, shownPowerLabel + ' · ' + bestPercent.format(max) + ' max');
    }
    showPowerValue(st.power, st.powerHeatMult);
    const best = E.powerSweetSpot(state, st);
    if (shownBest === best) return;
    shownBest = best;
    el.powerBest.dataset.value = String(best);
    el.powerBest.style.left = ((best - E.POWER.min) / (max - E.POWER.min) * 100) + '%';
    setText(el.powerTarget, 'Best power at current cooling: ' + bestPercent.format(best) + '.');
  }

  el.powerSlider.addEventListener('input', () => {
    const next = el.powerSlider.valueAsNumber;
    if (next === state.power) return;
    // Credit elapsed time with the previous setting before changing production.
    // A drag after waking may open the offline report instead.
    if (modalOpen() || !settleBeforePurchaseOrMove()) {
      el.powerSlider.value = state.power;
      return;
    }
    const old = state.power;
    const best = E.powerSweetSpot(state);
    const power = E.setPower(state, next);
    el.powerSlider.value = power;
    if (old === power) return;
    const crossed = mark => (old < mark && power >= mark) || (old > mark && power <= mark);
    if (crossed(E.POWER.normal) || crossed(best)) feel.powerTick();
    showPowerValue(power, E.stats(state).powerHeatMult);
    powerChanged = true;
    scheduleScreenUpdate();
  });
  el.powerSlider.addEventListener('change', save);

  function renderTapBoost(income) {
    if (!el.tapBoost || !E.tappingBoost) return;
    const boostPercent = Math.round(E.tappingBoost(recentTaps, performance.now(), income) * 100);
    if (boostPercent) setText(el.tapBoost, `+${boostPercent}% from tapping`);
    setHidden(el.tapBoost, !boostPercent);
  }

  const incomeLine = el.income.parentElement;
  let incomeInView = true, paintedIncome, paintedStaffIncome;
  function paintIncome(st) {
    if (paintedIncome !== st.income) {
      paintedIncome = st.income;
      setText(el.income, rate(st.income));
    }
    if (paintedStaffIncome !== st.staffIncome) {
      paintedStaffIncome = st.staffIncome;
      setText(el.incomeSource, st.staffIncome ? `including ${rate(st.staffIncome)} from staff` : 'from machines');
    }
  }
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver(([entry]) => {
      incomeInView = entry.isIntersecting;
      if (incomeInView && lastStats) paintIncome(lastStats);
    }, { rootMargin: '48px 0px' }).observe(incomeLine);
  }

  // The browser tab shows the balance ("$1.23M · Mom, It's a Startup"), so progress is visible
  // from other tabs. The game loop pauses while the tab is hidden and settles the time on return,
  // so meanwhile the title estimates the balance from income, within the offline earnings limit.
  const baseTitle = document.title;
  let shownTitle = '';
  function titleBalance() {
    if (!document.hidden || !lastStats || !state) return state?.money ?? 0;
    const away = Math.min(Math.max(0, (Date.now() - state.lastTick) / 1000), lastStats.offlineCapSeconds);
    return state.money + away * lastStats.income;
  }
  function updateTitle(force = false) {
    if (!state) return;
    const text = `${money(titleBalance())} · ${baseTitle}`;
    if (force || text !== shownTitle) document.title = shownTitle = text;
  }
  setInterval(updateTitle, 1000);

  function render(automatic = false) {
    if (uiFrame && !tickDue) { cancelAnimationFrame(uiFrame); uiFrame = 0; }
    if (pendingStaffOrders.length && (!automatic || !managerBurst() || performance.now() >= nextStaffPaint)) showStaffOrders();
    powerChanged = false;
    const st = E.stats(state);
    const previous = lastStats;
    const signature = E.signatureUI(state, st);
    lastStats = st;
    el.heatFill.classList.toggle('automated-heat', !!managerBurst());
    feel.updateMoney(state.money, st.income);
    if (incomeInView || !automatic) paintIncome(st);
    if (previous?.clickValue !== st.clickValue) setText(el.jobValue, '+' + money(st.clickValue));
    if (el.tapEquivalent && (previous?.income !== st.income || previous?.clickValue !== st.clickValue)) {
      if (st.income > 0) {
        const seconds = st.clickValue / st.income;
        setText(el.tapEquivalent, `Each tap ≈ ${Number(seconds.toFixed(2))}s of income`);
      } else setText(el.tapEquivalent, '');
      setHidden(el.tapEquivalent, st.income <= 0);
    }
    renderTapBoost(st.income);
    if (el.tapMultiplier.hidden === signature.doubleTaps) {
      setHidden(el.tapMultiplier, !signature.doubleTaps);
      el.jobBtn.setAttribute('aria-describedby', signature.doubleTaps ? 'tap-equivalent tap-multiplier' : 'tap-equivalent');
    }
    if (el.fireproofBadge.hidden === signature.fireproof) {
      setHidden(el.fireproofBadge, !signature.fireproof);
      $('heat-chip').setAttribute('aria-label', signature.fireproof ? 'Heat and power, fireproof' : 'Heat and power');
    }
    if (previous?.throttle !== st.throttle || previous?.rawIncome !== st.rawIncome) {
      feel.heat(st.throttle < 1);
      setHidden(el.throttle, st.throttle >= 1);
      setHidden(el.reserve, st.throttle < 1);
      if (st.throttle < 1) {
        setText(el.throttle, `${Math.floor(st.throttle * 100)}% speed · −${rate(st.rawIncome - st.income)} · Buy cooling.`);
      }
    }
    if (previous?.freeLoad !== st.freeLoad) {
      setHidden(el.orbitalHeatRule, signature.freeLoad <= 1);
      if (signature.freeLoad > 1) setText(el.orbitalHeatRule, 'Full speed up to ' + percent.format(signature.freeLoad) + ' heat in orbit');
    }
    if (previous?.heat !== st.heat || previous?.cooling !== st.cooling || previous?.freeLoad !== st.freeLoad) {
      if (st.throttle >= 1) {
        const headroom = E.formatNumber(round1(st.freeLoad * st.cooling - st.heat));
        setText(el.reserve, 'Full speed · ' + headroom + (st.freeLoad > 1 ? ' heat to spare' : ' cooling to spare'));
      }
      const pct = Math.round(st.load * 100);
      setText($('heat-percent'), pct + '%');
      setText(el.heatText, `${E.formatNumber(round1(st.heat))} heat / ${E.formatNumber(round1(st.cooling))} cooling (${pct}%)`);
      const capacityUsed = st.load / st.freeLoad;
      setFill(el.heatFill, capacityUsed);
      el.heatFill.classList.toggle('warm', capacityUsed >= 0.9 && capacityUsed <= 1);
      el.heatFill.classList.toggle('hot', capacityUsed > 1);
    }

    setText($('run-number'), 'Run ' + String(state.runs + 1).padStart(2, '0'));
    renderPower(st, signature);
    renderFire(st, signature);
    renderGoal();
    if (el.room.dataset.location !== state.location || el.room.dataset.extraLocation !== (state.extraLocation || '')) {
      const loc = LOCATIONS[state.location];
      el.room.dataset.location = state.location;
      el.room.dataset.extraLocation = state.extraLocation || '';
      setText(el.location, loc.name);
      setText(el.roomTitle, loc.room);
      const terms = [];
      if (E.currentStage(state) > 2) terms.push('Stage ' + E.currentStage(state));
      if (state.extraLocation) terms.push(`Franchise bonus from ${LOCATIONS[state.extraLocation].name}`);
      if (E.hasSite(state, 'mall')) {
        terms.push(`${percent.format(1 - LOCATIONS.mall.effect.priceMult)} off machines and cooling`);
      }
      setText(el.roomTerms, terms.join(' · '));
      setHidden(el.roomTerms, !terms.length);
    }
    renderShop(st);
    if (!pendingStaffOrders.length) {
      renderRoom(st);
      renderShortGoals();
    }
    renderIncident();
    refreshWelcomeBuy();
    rewardControls?.refresh();
    achievementPanel.update(st);
    renderSaveStatus();
    return st;
  }

  const todoToggle = $('goals-toggle');
  const todoPanel = $('goals-panel');
  const todoRows = new Map();
  let nextGoalRefresh = 0;

  function openGoals(open) {
    setHidden(todoPanel, !open);
    todoToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      renderShortGoals(true);
      if (!window.GameShell) $('goals-close').focus({ preventScroll: true });
    } else if (!todoToggle.hidden && !window.GameShell) todoToggle.focus({ preventScroll: true });
  }
  document.addEventListener('game-panel', event => {
    const open = event.detail === 'goals' && !todoToggle.hidden;
    if (open !== !todoPanel.hidden) openGoals(open);
  });
  todoToggle.addEventListener('click', () => openGoals(todoPanel.hidden));
  $('goals-close').addEventListener('click', () => openGoals(false));
  todoPanel.addEventListener('keydown', event => {
    if (event.key === 'Escape') openGoals(false);
  });

  function renderShortGoals(force = false) {
    const available = (state.machines.laptop > 0 || Boolean(state.goals)) && !state.perkChoicePending;
    const justUnlocked = available && todoToggle.hidden;
    setHidden(todoToggle, !available);
    setHidden($('goals-lock'), available);
    if (window.GameShell?.panel === 'goals') setHidden(todoPanel, !available);
    if (!available) return;
    const now = performance.now();
    if (!force && !justUnlocked && now < nextGoalRefresh) return;
    nextGoalRefresh = now + GOAL_REFRESH_MS;
    E.ensureGoals(state);
    const { slots, swapRemainingSeconds } = E.goalList(state);
    const ready = slots.some(goal => goal.ready);
    setHidden(todoToggle.querySelector('.claim-dot'), !ready);
    const toggleLabel = ready ? 'To-do list, reward ready to claim' : 'To-do list';
    if (todoToggle.getAttribute('aria-label') !== toggleLabel) todoToggle.setAttribute('aria-label', toggleLabel);
    if (todoPanel.hidden) return;
    for (const [id, row] of todoRows) {
      if (slots.some(goal => goal.id === id)) continue;
      row.item.remove();
      todoRows.delete(id);
    }
    slots.forEach((goal, index) => {
      let row = todoRows.get(goal.id);
      if (!row) {
        const item = make('li'), copy = make('div');
        const title = make('strong', 'short-goal-title', goal.title);
        const detail = make('span', 'short-goal-detail');
        const button = make('button', 'goal-action');
        button.type = 'button';
        button.addEventListener('click', () => actOnGoal(goal.id, button));
        copy.append(title, detail);
        item.append(copy, button);
        const list = $('goal-slots');
        list.insertBefore(item, list.children[index] || null);
        row = { item, detail, button };
        todoRows.set(goal.id, row);
      }
      const done = Math.floor(Math.min(goal.current, goal.target));
      const needsIncome = goal.ready && lastStats?.income === 0;
      setText(row.detail, needsIncome ? 'Rebuild to collect your reward' : goal.ready ? `Reward · ${goal.rewardSeconds}s of income` :
        `${done.toLocaleString('en-US')} / ${goal.target.toLocaleString('en-US')} · ${goal.rewardSeconds}s reward`);
      setText(row.button, goal.ready ? 'Claim' : 'Swap');
      if (row.button.dataset.ready !== String(goal.ready)) row.button.dataset.ready = String(goal.ready);
      row.button.disabled = needsIncome || (!goal.ready && swapRemainingSeconds > 0);
      const label = (goal.ready ? 'Claim' : 'Swap') + ' · ' + goal.title;
      if (row.button.getAttribute('aria-label') !== label) row.button.setAttribute('aria-label', label);
    });
    setText($('goal-swap-time'), swapRemainingSeconds > 0 ?
      'Next free swap in ' + E.formatDuration(Math.ceil(swapRemainingSeconds)) : 'Free swap available');
  }

  function actOnGoal(id, button) {
    if (modalOpen() || !settleBeforePurchaseOrMove()) return;
    const goal = E.goalList(state).slots.find(slot => slot.id === id);
    if (!goal) return;
    const point = centerOf(button);
    const result = goal.ready ? E.claimGoal(state, id) : E.swapGoal(state, id);
    if (!result.ok) { renderShortGoals(true); return; }
    if (goal.ready) {
      const amount = '+' + money(result.amount);
      feel.goalReward(point, amount);
      setText($('goals-receipt'), 'Claimed ' + amount);
      log(goal.title + ' · ' + amount, 'good');
    } else setText($('goals-receipt'), 'Swapped for a new to-do');
    renderShortGoals(true);
    render();
    save();
    if (!button.isConnected) $('goals-close').focus({ preventScroll: true });
  }

  function renderGoal() {
    const goal = E.goalStrip(state);
    const firstMove = goal.phase === 'move';
    const relocating = firstMove || goal.phase === 'expand';
    const saleBar = goal.phase === 'ready';
    const selling = goal.canSell;
    setHidden(el.reputation, !state.stars);
    if (state.stars) setText(el.reputation, `${state.stars.toLocaleString('en-US')} stars · ${runStarBonus()}`);
    if (el.goal.dataset.phase !== goal.phase) {
      el.goal.dataset.phase = goal.phase;
      el.goalTrack.setAttribute('aria-labelledby', saleBar ? 'goal-detail' : 'goal-title');
    }
    UIIcons.paint(el.goalIcon, relocating ? 'move' : 'sale');
    const amount = Math.floor(Math.min(goal.current, goal.target));
    const title = saleBar ? `Sell now for +${goal.pendingStars.toLocaleString('en-US')} stars` :
      `${firstMove ? 'Move out' : relocating ? 'Expand' : 'Sell the startup'}: ${exactMoney(amount)} / ${shortMoney(goal.target)} this run`;
    setText(el.goalTitle, title);
    let detail = '';
    if (selling && goal.nextStarAt) {
      const sale = saleBar ? '' : `Sell for +${goal.pendingStars.toLocaleString('en-US')} stars · `;
      detail = sale + `Next star at ${shortMoney(goal.nextStarAt)} all-time`;
      if (selling && goal.doubleAt) detail += ` · Doubles your bonus at ${exactMoney(goal.doubleAt, 'ceil')}`;
    }
    if (!firstMove && !selling && !detail) {
      detail = state.lifetime < E.PRESTIGE.unlockLifetime
        ? `Sell from ${shortMoney(E.PRESTIGE.unlockLifetime)} this run.`
        : `Next sale star at ${shortMoney(goal.nextStarAt)} all-time.`;
    }
    setText(el.goalDetail, detail);
    setHidden(el.goalDetail, !detail);
    setFill(el.goalFill, goal.progress);
    const pct = String(Math.floor(goal.progress * 100));
    if (el.goalTrack.getAttribute('aria-valuenow') !== pct) el.goalTrack.setAttribute('aria-valuenow', pct);
    const moveReady = relocating && goal.ready;
    setText(el.moveBtn, firstMove ? 'Move out' : 'Expand');
    setHidden(el.moveBtn, !moveReady);
    setHidden(el.sellBtn, !selling);
    const boardAvailable = !firstMove && state.stars >= E.BOARD_STARS;
    setHidden($('board-btn'), !boardAvailable);
    setHidden(el.goalActions, !moveReady && !selling && !boardAvailable);
    const challenge = E.CHALLENGES.find(def => def.id === state.challenge);
    const challengeLine = $('board-completion');
    setHidden(challengeLine, !challenge);
    if (challenge) {
      const complete = state.challengeRewards.includes(challenge.id);
      setText(challengeLine, complete ? `✓ ${challenge.name} complete · ${challenge.reward}` : `${challenge.name} · ${challenge.twist}`);
      if (complete && !announcedRewards.has(challenge.id)) {
        announcedRewards.add(challenge.id);
        feel.challengeComplete(challenge);
        log(`Board challenge complete: ${challenge.name}. ${challenge.reward}`, 'big');
      }
    }
    el.moveBtn.classList.toggle('awaiting-tap', moveReady && !state.flags[firstMove ? 'moveChoiceSeen' : 'expandChoiceSeen:' + E.nextStage(state).number]);
    if (selling && el.modal.open && saleQuote?.isConnected) renderSaleQuote();
    if (moveReady && !previousMoveReady) feel.move(firstMove ? 'Move-out unlocked!' : 'A new site is available!');
    previousMoveReady = moveReady;
    renderNextStep();
    renderContracts();
  }

  // One compact "Next step" line under the long-term objective. economy.js picks the step;
  // this shows it, links to the shop row it is about, and announces only when the advice
  // itself changes (never each new dollar amount).
  const nextStepUI = { box: $('next-step'), text: $('next-step-text'), action: $('next-step-action'),
    announce: $('next-step-announcement') };
  const NEXT_STEP_TIPS = { heat: 'heat', sibling: 'staff' }; // transient tips this line replaces
  let nextStep = null, nextStepKey, nextStepFor = null;

  function nextStepCopy(step) {
    if (step.id === 'heat') return { text: `Heat is costing ${rate(step.loss)}.`, action: 'Open Cooling' };
    if (step.id === 'sibling') {
      return { text: `Hire Little Sibling (${money(step.price)}) to run jobs automatically.`, action: 'View Staff' };
    }
    const offer = `Old Laptop: ${money(step.price)}, earns ${rate(step.earns)} by itself.`;
    return step.ready ? { text: offer, action: 'View laptop' } : { text: `${offer} Earn ${money(step.shortfall)} more by running jobs.`, action: '' };
  }

  function renderNextStep() {
    const step = guidance.tipsEnabled() ? E.nextStep(state, E.stats(state)) : null;
    const key = !step ? '' : step.id === 'laptop' ? 'laptop:' + (step.ready ? 'ready' : 'short') : step.id;
    // A new page, an imported save or a Tips change is not news; only changes during play are announced.
    const quiet = nextStepFor !== state || nextStepKey === undefined;
    nextStep = step;
    setHidden(nextStepUI.box, !step);
    if (step) {
      const copy = nextStepCopy(step);
      nextStepUI.box.dataset.step = step.id;
      setText(nextStepUI.text, copy.text);
      setText(nextStepUI.action, copy.action);
      setHidden(nextStepUI.action, !copy.action);
    }
    if (key !== nextStepKey && !quiet) {
      const recovered = nextStepKey === 'heat' ? 'Full speed again.' : '';
      const news = step ? 'Next step: ' + nextStepCopy(step).text : '';
      nextStepUI.announce.textContent = [recovered, news].filter(Boolean).join(' ');
    }
    nextStepKey = key;
    nextStepFor = state;
  }

  // The tip this line already covers, so the same advice never appears twice.
  const nextStepTip = () => (nextStep && !nextStepUI.box.hidden ? NEXT_STEP_TIPS[nextStep.id] : undefined);

  // Open the panel the step is about and bring its row into view. Buying still happens
  // on the row itself, through the normal purchase flow.
  function revealShopRow(kind, item) {
    window.GameShell?.open(kind === 'staff' ? 'staff' : 'shop');
    const tab = shopTabs.get(kind)?.button;
    if (kind !== 'staff' && tab && !tab.hidden && tab.getAttribute('aria-selected') !== 'true') tab.click();
    const target = item ? document.querySelector(`.card[data-kind="${kind}"][data-item="${item}"]`) : tab;
    if (!target || target.hidden || !target.isConnected) return;
    const scroller = $('sheet-scroll');
    const view = scroller.getBoundingClientRect(), box = target.getBoundingClientRect();
    const controls = kind === 'staff' ? 0 : (document.querySelector('.shop-controls')?.offsetHeight || 0);
    const top = view.top + controls + 8, bottom = view.bottom - 8;
    if (box.top < top) scroller.scrollTop -= top - box.top;
    else if (box.bottom > bottom) scroller.scrollTop += Math.min(box.bottom - bottom, box.top - top);
    // An unaffordable row is a disabled button; its details control names the same item.
    const focusable = target.disabled ? target.closest('.card-row')?.querySelector('summary') : target;
    (focusable || target).focus({ preventScroll: true });
    if (item) {
      target.classList.remove('guided');
      void target.offsetWidth;
      target.classList.add('guided');
      setTimeout(() => target.classList.remove('guided'), 1600);
    }
  }

  nextStepUI.action.addEventListener('click', () => {
    if (nextStep?.id === 'heat') revealShopRow('cooler');
    else if (nextStep?.id === 'laptop') revealShopRow('machine', 'laptop');
    else if (nextStep?.id === 'sibling') revealShopRow('staff', 'sibling');
  });

  // ---------------------------------------------------------------------------
  // Client contracts. economy.js owns the terms, progress and rewards; this shows the board in
  // the Goals sheet and one status line under the goal, and signs or ends contracts.
  // ---------------------------------------------------------------------------
  const contractUI = {
    line: $('contract-line'), lineText: $('contract-line-text'), lineAction: $('contract-line-action'),
    announce: $('contract-announcement'), lock: $('contracts-lock'), intro: $('contracts-intro'),
    active: $('contract-active'), offers: $('contract-offers'), locked: $('contracts-locked'),
    receipt: $('contracts-receipt'), dot: $('contracts-dot'), end: $('contract-end'),
    track: $('contract-track'), fill: $('contract-fill'), heading: $('contracts-heading'),
  };
  const contractOfferRows = new Map();
  let contractKey, contractFor = null, contractEndArmedUntil = 0;
  const contractMinutes = seconds => (seconds % 60 === 0 ? `${seconds / 60} min` : E.formatDuration(seconds));
  const contractClock = seconds => {
    const whole = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  };
  const contractDef = id => E.CONTRACTS.find(def => def.id === id);
  const wholePercent = fraction => `${Math.round(fraction * 100)}%`;

  function contractTermsText(def, terms) {
    const time = contractMinutes(terms.durationSeconds);
    if (def.requirement === 'income') return `Keep machine income at ${rate(terms.target)} or more for ${time}.`;
    if (def.requirement === 'capacity') return `Build machine income up to ${rate(terms.target)}, then hold it for ${time}.`;
    if (def.requirement === 'headroom') return `Keep heat at ${wholePercent(def.maxLoad)} of cooling or less for ${time}.`;
    return `Run Power at ${wholePercent(def.minPower)} or more, at full speed, for ${time}.`;
  }

  // Why the contract isn't counting, in a few words for the strip and in full for the board.
  function contractHold(status) {
    const def = status.def;
    if (def.requirement === 'capacity' && status.value < status.need) {
      return { state: 'building', short: 'building capacity',
        long: `Building capacity · ${rate(status.value)} of ${rate(status.need)} machine income` };
    }
    if (def.requirement === 'income' || def.requirement === 'capacity') {
      return { state: 'paused', short: 'paused, income too low',
        long: `Paused · machine income ${rate(status.value)}, needs ${rate(status.need)}` };
    }
    if (def.requirement === 'headroom') {
      return { state: 'paused', short: 'paused, heat too high',
        long: `Paused · heat ${wholePercent(status.value)} of cooling, needs ${wholePercent(status.need)} or less` };
    }
    if (status.value < status.need - 1e-9) {
      return { state: 'paused', short: `paused, Power below ${wholePercent(status.need)}`,
        long: `Paused · Power ${wholePercent(status.value)}, needs ${wholePercent(status.need)} or more` };
    }
    return { state: 'paused', short: 'paused, machines slowed by heat',
      long: 'Paused · machines are slowed by heat. Add cooling to resume.' };
  }

  function announceContract(text) {
    contractUI.announce.textContent = text;
  }

  function contractSeenKey(offers) {
    return offers.filter(offer => offer.available).map(offer => offer.id).join(',');
  }

  function markContractsSeen() {
    const key = contractSeenKey(E.contractOffers(state, lastStats ?? E.stats(state)));
    if (key && state.flags.contractsSeen !== key) {
      state.flags.contractsSeen = key;
      renderContracts();
    }
  }

  function buildOfferRow(def) {
    const item = make('li', 'contract-card');
    const top = make('div', 'contract-top');
    const icon = make('span', 'contract-icon');
    icon.setAttribute('aria-hidden', 'true');
    UIIcons.paint(icon, def.icon);
    const names = make('div', 'contract-names');
    names.append(make('strong', null, def.name), make('span', 'contract-client', def.client));
    const reward = make('span', 'contract-reward');
    const amount = make('strong');
    reward.append(amount, make('small', null, `${def.rewardSeconds}s of income`));
    top.append(icon, names, reward);
    const terms = make('p', 'contract-terms');
    const button = make('button', 'contract-sign');
    button.type = 'button';
    button.addEventListener('click', () => signContractFromBoard(def.id));
    item.append(top, make('p', 'contract-pitch', def.pitch), terms, make('p', 'contract-tradeoff', def.tradeoff), button);
    return { item, reward: amount, terms, button };
  }

  function renderContracts() {
    const st = lastStats ?? E.stats(state);
    const offers = E.contractOffers(state, st);
    const status = E.contractStatus(state, st);
    const locked = offers.every(offer => offer.lock === 'machines') && !status;
    const available = offers.filter(offer => offer.available);
    const seenKey = contractSeenKey(offers);
    const newOffers = !status && available.length > 0 && state.flags.contractsSeen !== seenKey;
    setHidden(contractUI.dot, !newOffers);

    // The status line under the goal appears only while a contract is signed, so opening a
    // panel never moves the room. New offers light the Goals tab's dot instead.
    const hold = status && !status.met ? contractHold(status) : null;
    setHidden(contractUI.line, !status);
    if (status) {
      const lineState = hold ? hold.state : 'running';
      if (contractUI.line.dataset.state !== lineState) contractUI.line.dataset.state = lineState;
      const pct = Math.floor(status.progress * 100);
      setText(contractUI.lineText, `${status.def.name} · ${pct}% · ` +
        (hold ? hold.short : `${contractClock(status.remainingSeconds)} left`));
    }

    // Announce changes in what the player should do, never each passing second.
    const key = status ? `${status.id}:${hold ? hold.state : 'running'}` : '';
    if (contractFor === state && contractKey !== undefined && key !== contractKey && status) {
      announceContract(hold ? `${status.def.name}: ${hold.long}.` : `${status.def.name} is on track.`);
    }
    contractKey = key;
    contractFor = state;

    // The board.
    setHidden(contractUI.lock, !locked);
    if (locked) setText(contractUI.lock, offers[0].lockText);
    setHidden(contractUI.intro, locked);
    setHidden(contractUI.active, !status);
    setHidden(contractUI.offers, locked || Boolean(status));
    if (status) {
      const card = contractUI.active;
      if (card.dataset.id !== status.id) {
        card.dataset.id = status.id;
        UIIcons.paint($('contract-active-icon'), status.def.icon);
        setText($('contract-active-name'), status.def.name);
        setText($('contract-active-client'), status.def.client);
        setText($('contract-active-tradeoff'), status.def.tradeoff);
      }
      if (card.dataset.state !== (hold ? hold.state : 'running')) card.dataset.state = hold ? hold.state : 'running';
      setText($('contract-active-reward'), '+' + money(status.contract.reward));
      setText($('contract-active-terms'), contractTermsText(status.def, status.contract));
      setText($('contract-active-status'), hold ? hold.long : `On track · ${contractClock(status.remainingSeconds)} left`);
      setFill(contractUI.fill, status.progress);
      const pct = String(Math.floor(status.progress * 100));
      if (contractUI.track.getAttribute('aria-valuenow') !== pct) contractUI.track.setAttribute('aria-valuenow', pct);
      const armed = performance.now() < contractEndArmedUntil;
      setText(contractUI.end, armed ? 'Tap again to end · progress is lost' : 'End contract');
      if (contractUI.end.dataset.confirm !== String(armed)) contractUI.end.dataset.confirm = String(armed);
    } else if (!locked) {
      for (const [id, row] of contractOfferRows) {
        if (available.some(offer => offer.id === id)) continue;
        row.item.remove();
        contractOfferRows.delete(id);
      }
      available.forEach((offer, index) => {
        let row = contractOfferRows.get(offer.id);
        if (!row) {
          row = buildOfferRow(offer.def);
          contractOfferRows.set(offer.id, row);
          contractUI.offers.insertBefore(row.item, contractUI.offers.children[index] || null);
        }
        const reward = money(offer.reward);
        setText(row.reward, '+' + reward);
        setText(row.terms, contractTermsText(offer.def, offer));
        setText(row.button, 'Sign · ' + reward);
        const label = `Sign ${offer.def.name} for ${reward}`;
        if (row.button.getAttribute('aria-label') !== label) row.button.setAttribute('aria-label', label);
      });
    }
    const next = offers.find(offer => offer.lock && offer.lock !== 'machines');
    setText(contractUI.locked, !locked && next ? `More clients: ${next.def.name}. ${next.lockText}` : '');
  }

  function signContractFromBoard(id) {
    if (modalOpen() || !settleBeforePurchaseOrMove()) return;
    const result = E.signContract(state, id);
    if (!result.ok) { renderContracts(); return; }
    const def = contractDef(id);
    contractEndArmedUntil = 0;
    log(`Signed ${def.name} with ${def.client}.`, 'good');
    setText(contractUI.receipt, '');
    announceContract(`Signed ${def.name}. ${contractTermsText(def, result.contract)}`);
    contractKey = undefined; // The next render records the new state without announcing over this.

    render();
    save();
    $('sheet-scroll').scrollTop = 0;
    contractUI.active.focus({ preventScroll: true });
  }

  contractUI.end.addEventListener('click', () => {
    if (!state.contract || modalOpen()) return;
    const now = performance.now();
    if (now >= contractEndArmedUntil) {
      contractEndArmedUntil = now + 4000;
      renderContracts();
      return;
    }
    if (!settleBeforePurchaseOrMove()) return;
    const result = E.endContract(state);
    contractEndArmedUntil = 0;
    if (!result.ok) return;
    const def = contractDef(result.contract.id);
    log(`Ended ${def.name} early. ${def.client} found someone else.`);
    announceContract(`Ended ${def.name}. Choose another client when you're ready.`);
    render();
    save();
    contractUI.heading.focus({ preventScroll: true });
  });

  contractUI.lineAction.addEventListener('click', () => {
    window.GameShell?.open('goals');
    $('sheet-scroll').scrollTop = 0;
    markContractsSeen();
  });
  document.addEventListener('game-panel', event => {
    if (event.detail === 'goals') markContractsSeen();
  });

  function contractComplete(notice) {
    const def = contractDef(notice.id);
    const amount = '+' + money(notice.reward);
    log(`${def.name} for ${def.client} complete · ${amount}`, 'big');
    setText(contractUI.receipt, `Last contract: ${def.name} paid ${money(notice.reward)}.`);
    announceContract(`${def.name} complete. ${def.client} paid ${money(notice.reward)}.`);
    const anchor = !contractUI.line.hidden ? contractUI.line : el.room;
    feel.goalReward(centerOf(anchor), amount);
  }

  const round1 = (n) => Math.round(n * 10) / 10;

  function setText(node, text) {
    const child = node.firstChild;
    if (child && child.nodeType === Node.TEXT_NODE && !child.nextSibling) {
      if (child.data !== text) child.data = text;
    } else if (node.textContent !== text) node.textContent = text;
  }

  function setHidden(node, hidden) {
    if (node.hidden !== hidden) node.hidden = hidden;
  }

  // Remove finished or cancelled one-shot effects, including when switching motion
  // preferences, so a later toggle cannot replay a room entrance or an old unlock.
  const oneShots = new Map([
    ['rack-drop', 'arriving'], ['shop-shimmer', 'can-shimmer'], ['shop-reveal', 'reveal-flash'],
  ]);
  function finishOneShot(event) {
    const cls = oneShots.get(event.animationName);
    if (cls) event.target.classList.remove(cls);
  }
  document.addEventListener('animationend', finishOneShot);
  document.addEventListener('animationcancel', finishOneShot);

  function setFill(node, fraction) {
    const amount = Math.round(Math.max(0, Math.min(1, fraction)) * 10000) / 10000;
    const transform = 'scaleX(' + amount + ')';
    if (node.style.transform !== transform) node.style.transform = transform;
  }

  const fireStories = {
    basement: "Mom stands at the top of the basement stairs holding the good dish towel. Nobody makes eye contact.",
    warehouse: "The Arctic Warehouse finally thaws. Facilities would like a word.",
    office: "The fire drill gets five stars for realism. The office manager takes away your clipboard.",
    dam: 'The dam survives. The soggy claim form takes longer to dry.',
    penthouse: 'The building manager adds a line about server racks to the lease.',
    bunker: 'The bunker alarm demands a written explanation.',
    orbital: 'Ground control would like its fire blanket back.',
    volcano: 'The insurer asks whether the lava was already there.',
    mall: "For the first time in years, the mall directory lights up. Several stores ask for a refund.",
  };
  const fireFeedback = { alarmRepeatMs: 1800, momentMs: 3000 };
  let fireMomentTimer = 0, nextAlarmTone = 0;

  function clearFireMoment() {
    clearTimeout(fireMomentTimer);
    fireMomentTimer = 0;
    el.room.classList.remove('fire-burning', 'fire-flare');
    setHidden(el.fireFlash, true);
    setText(el.fireMoment, '');
    setText(el.firePayout, '');
  }

  function renderFire(st, signature) {
    const fire = E.fireStatus(state, st);
    const watching = !suspended && !document.hidden && !modalOpen();
    setHidden(el.fireRisk, signature.fireproof || !fire.risk);
    if (el.fireRisk.dataset.stage !== fire.stage) el.fireRisk.dataset.stage = fire.stage;
    if (fire.risk) {
      setText(el.fireRiskValue, Math.min(99, Math.ceil(fire.risk * 100)) + '%');
      setFill(el.fireRiskFill, fire.risk);
    }
    if (el.room.dataset.fireStage !== fire.stage) el.room.dataset.fireStage = fire.stage;
    const charred = String(fire.charred);
    if (el.room.dataset.charred !== charred) el.room.dataset.charred = charred;
    setHidden(el.fireRebuild, !fire.charred);
    if (fire.charred) {
      const machines = E.machineCount(state);
      setText(el.fireRebuild, 'Rebuilding after the fire · ' + machines + '/' + E.FIRE.charredUntil + ' machines');
      const level = String(1 - Math.min(1, machines / E.FIRE.charredUntil));
      if (el.room.style.getPropertyValue('--char-level') !== level) el.room.style.setProperty('--char-level', level);
    } else if (el.room.style.getPropertyValue('--char-level')) el.room.style.removeProperty('--char-level');
    const alarm = fire.stage === 'alarm';
    setHidden(el.fireEdge, !watching || (!alarm && fire.stage !== 'smoke'));
    setHidden(el.fireAlarm, !alarm);
    if (!watching && fireMomentTimer) clearFireMoment();
    if (alarm) {
      const seconds = Math.ceil(fire.secondsToFire);
      const countdown = fire.secondsToFire == null ? 'Cooling down' :
        Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
      setText(el.fireCountdown, countdown);
    }
    if (watching && alarm && fire.secondsToFire != null && !fire.graceSeconds) {
      const now = performance.now();
      if (now >= nextAlarmTone) {
        nextAlarmTone = now + fireFeedback.alarmRepeatMs;
        feel.fireAlarm();
      }
    } else nextAlarmTone = 0;
  }

  function handleFireNotice(notice) {
    const firstStory = (id, text, cls) => {
      if (state.flags[id]) return;
      state.flags[id] = true;
      log(text, cls);
    };
    if (notice.type === 'fire-smoke') {
      firstStory('storyFireSmoke', 'A thin grey curl lifts off the rack. The room smells like toast. Nobody made toast.', 'warn');
    } else if (notice.type === 'fire-alarm') {
      firstStory('storyFireAlarm', 'The smoke detector joins the group chat. It has one message. Lower Power or add cooling!', 'warn');
    } else if (notice.type === 'fire') {
      const location = notice.location;
      const headline = '' + LOCATIONS[location].room.toUpperCase() + ' BURNED DOWN';
      const machines = notice.machines + (notice.machines === 1 ? ' machine' : ' machines');
      const coolers = notice.coolers + (notice.coolers === 1 ? ' cooler' : ' coolers');
      log(headline + ' · Lost ' + machines + ' and ' + coolers + '.', 'warn');
      firstStory('storyFire:' + location, fireStories[location], 'big');
      const receipt = notice.payout > 0 ? '+' + insuranceMoney(notice.payout) + ' insurance payout' : '';
      if (receipt) log(receipt, 'good');
      guidance.burn(notice.payout);
      if (!suspended && !document.hidden && !modalOpen()) {
        clearFireMoment();
        el.room.classList.add('fire-burning');
        el.room.classList.toggle('fire-flare', !feel.reduced());
        setText(el.fireMoment, headline);
        setText(el.firePayout, receipt);
        setHidden(el.fireFlash, feel.reduced());
        feel.fireCrash();
        fireMomentTimer = setTimeout(clearFireMoment, fireFeedback.momentMs);
      }
    } else return;
    save();
  }

  for (const type of ['animationend', 'animationcancel']) {
    el.fireFlash.addEventListener(type, () => setHidden(el.fireFlash, true));
    el.room.addEventListener(type, event => {
      if (event.animationName === 'fire-sweep') el.room.classList.remove('fire-flare');
    });
  }

  function renderIncident() {
    const pending = state.event;
    const incident = pending || state.active;
    if (pending !== previousOffer) {
      previousOffer = pending;
      el.incident.classList.toggle('incident-new', Boolean(pending) && !feel.reduced());
      if (pending) feel.incident();
    }
    if (el.incident.hidden !== !incident) {
      el.incident.hidden = !incident;
      el.footer.classList.toggle('incident-visible', !!incident);
    }
    if (!incident) return;

    const def = incidentTypes.get(incident.id);
    el.incident.classList.toggle('warning', def.id === 'heatwave');
    setText(el.incidentTitle, (def.id === 'heatwave' && !pending ? 'Heat wave' : def.title));
    setText(el.incidentTime, Math.ceil(incident.remaining) + 's remaining');
    const duration = pending ? CONFIG.eventOfferSeconds : def[incident.side].duration;
    setFill(incidentRemaining, incident.remaining / duration);
    setHidden(el.incidentActions, !pending);

    if (!pending) {
      setText(el.incidentDetail, 'In effect: ' + E.activeOutcome(state).summary + '.');
      return;
    }
    setText(el.incidentDetail, def.text);
    let acceptLabel = def.accept.label;
    if (pending.cash != null) acceptLabel += ' · +' + money(pending.cash);
    if (pending.price != null) acceptLabel += ' · ' + money(pending.price, 'ceil');
    if (pending.machineId) acceptLabel += ' · ' + E.lookup('machine', pending.machineId).name;
    setText(el.accept, acceptLabel);
    setText(el.decline, def.decline.label);
    el.accept.disabled = pending.price != null && state.money < pending.price;
  }

  function resolutionText(notice) {
    const def = incidentTypes.get(notice.id);
    if (notice.type === 'expired') return def.title + ' — offer expired.';
    return def.id === 'heatwave' ? 'The heat wave ended. Cooling is back to normal.' :
      'The rush job ended. The temporary income and heat boosts are over.';
  }

  function handleNotices(notices) {
    for (const notice of notices) {
      if (notice.type === 'fire' || notice.type.startsWith('fire-')) {
        handleFireNotice(notice);
      } else if (notice.type === 'contract-complete') {
        contractComplete(notice);
      } else if (notice.type === 'offer') {
        const def = incidentTypes.get(notice.event.id);
        log(def.title, def.id === 'heatwave' ? 'warn' : 'big');
      } else if (notice.type === 'ended' || (notice.type === 'expired' && !notice.away && !notice.result?.outcome.duration)) {
        log(resolutionText(notice));
      }
    }
  }

  function answerIncident(choice) {
    const offer = state.event;
    if (!offer || suspended || document.visibilityState !== 'visible') return;
    // Settle to the click so an expired offer cannot be accepted between frames.
    updateClock(Date.now(), true, false);
    if (state.event === offer && !modalOpen()) {
      const result = E.respondToEvent(state, choice);
      if (result.ok && !state.active) {
        const label = result.outcome.label;
        log(result.def.title + ' — ' + label + '.', choice === 'accept' ? 'good' : '');
      }
    }
    render();
    save();
  }

  function renderSaveStatus() {
    if (!storageOk) {
      setText(el.saveStatus, "This browser won't let the game save. Progress will be lost when you close the tab.");
      return;
    }
    if (!lastSavedAt) return;
    const ago = Math.floor((Date.now() - lastSavedAt) / 1000);
    setText(el.saveStatus, ago < 2 ? 'Saved just now' : `Saved ${ago}s ago`);
  }

  // ---------------------------------------------------------------------------
  // Modals
  // ---------------------------------------------------------------------------

  function openModal(title, bodyNodes, actions, onClose) {
    el.modalTitle.textContent = title;
    el.modalBody.textContent = '';
    el.modalBody.append(...bodyNodes);
    el.modalActions.textContent = '';
    for (const a of actions) {
      const b = make('button', 'btn' + (a.style ? ' ' + a.style : ''), a.label);
      b.type = 'button';
      if (a.id) b.id = a.id;
      b.addEventListener('click', () => {
        if (a.beforeClose && !a.beforeClose()) return;
        el.modal.close();
        if (a.onClick) a.onClick();
      });
      el.modalActions.appendChild(b);
    }
    el.modal.onclose = onClose || null;
    if (!el.modal.open) el.modal.showModal();
    const primary = el.modalActions.querySelector('.primary') || el.modalActions.lastChild;
    if (primary) primary.focus();
  }

  function para(text, cls) {
    return make('p', cls, text);
  }

  function showBoardRoom() {
    if (state.stars < E.BOARD_STARS) return;
    const list = make('ul', 'board-list');
    for (const challenge of E.CHALLENGES) {
      const status = E.challengeStatus(state, challenge.id);
      const row = make('li', 'board-card');
      row.dataset.challenge = challenge.id;
      row.dataset.status = status;
      const title = make('div', 'board-card-title');
      const badge = make('span', 'board-status', status[0].toUpperCase() + status.slice(1));
      title.append(make('strong', null, challenge.name), badge);
      row.append(title, para(challenge.desc), para(challenge.twist, 'board-twist'), para('Reward: ' + challenge.reward, 'board-reward'));
      list.appendChild(row);
    }
    const actions = [];
    if (state.challenge && !state.challengeRewards.includes(state.challenge)) {
      actions.push({ id: 'abandon-challenge', label: 'Abandon challenge', style: 'danger', onClick() {
        const challenge = E.CHALLENGES.find(def => def.id === state.challenge);
        if (!E.abandonChallenge(state)) return;
        log(`Left ${challenge.name}. This run continues with ordinary rules.`);
        render();
        save();
      } });
    }
    actions.push({ label: 'Close', style: 'primary' });
    openModal('Board Room', [
      para('Choose a challenge when you sell. Reach the next sale to keep its reward forever.'), list,
    ], actions);
  }

  function nextChallengePicker() {
    const options = E.CHALLENGES.filter(def => !state.challengeRewards.includes(def.id));
    if (!options.length) return null;
    const wrap = make('div', 'challenge-picker');
    const label = make('label', null, 'Next run is a Board challenge');
    label.htmlFor = 'challenge-pick';
    const select = make('select');
    select.id = 'challenge-pick';
    select.add(new Option('No challenge · ordinary run', ''));
    for (const challenge of options) select.add(new Option(challenge.name, challenge.id));
    const detail = para('', 'board-reward');
    detail.setAttribute('aria-live', 'polite');
    select.addEventListener('change', () => {
      const choice = options.find(def => def.id === select.value);
      setText(detail, choice ? `${choice.twist} Reward: ${choice.reward}` : '');
    });
    wrap.append(label, select, detail);
    return {wrap, select};
  }

  function showLocationMap() {
    const sites = E.runSites(state);
    const route = make('ol', 'run-map');
    route.setAttribute('aria-label', 'Locations this run');
    for (const [i, id] of sites.entries()) {
      const loc = LOCATIONS[id];
      const current = i === sites.length - 1;
      const stop = make('li', 'map-stop');
      if (current) stop.setAttribute('aria-current', 'location');
      const pin = UIIcons.paint(make('span', 'map-pin'), loc.icon || 'home');
      pin.setAttribute('aria-hidden', 'true');
      const label = make('div', 'map-label');
      label.append(make('strong', null, loc.name), make('span', null,
        `Stage ${i + 1} · ${current ? 'You are here' : i === 0 ? 'Started here' : 'Branch'}`));
      if (loc.signature) label.append(para(loc.signature));
      if (loc.desc) label.append(para(loc.desc));
      if (i === 1 && state.extraLocation) {
        const extra = LOCATIONS[state.extraLocation];
        label.append(para(`Franchise branch · ${extra.name}. ${extra.desc}`));
      }
      stop.append(pin, label);
      route.appendChild(stop);
    }
    const body = [route];
    const next = E.nextStage(state);
    if (next) body.push(para(`Next: ${next.name} at ${shortMoney(next.target)} earned this run.`, 'map-hint'));
    openModal('Map of this run', body, [{ label: 'Close' }]);
  }

  function refreshWelcomeBuy(force = false) {
    if (!away || !el.modal.open || !away.button?.isConnected) return;
    const now = performance.now();
    if (!force && now < away.nextAdvice) return;
    away.nextAdvice = now + WELCOME_ADVICE_MS;
    // Manual taps have aged out of the ten-second window by the time this screen opens.
    const plan = E.bestBuy(state, 0);
    away.plan = plan;
    setHidden(away.copy, !plan);
    const affordable = plan && state.money >= plan.cost;
    setHidden(away.button, !affordable);
    if (!plan) return;
    const items = new Map();
    for (const step of plan.steps) {
      const name = E.lookup(step.kind, step.id).name;
      items.set(name, (items.get(name) || 0) + 1);
    }
    const bundle = [...items].map(([name, count]) => count > 1 ? count + ' × ' + name : name).join(' + ');
    const price = exactMoney(plan.cost, 'ceil');
    const seconds = E.secondsToAfford(plan.cost, state.money, E.stats(state).income);
    const wait = seconds > 0 ? E.formatDuration(Math.ceil(seconds)) : '';
    setText(away.copy, affordable ? `Best buy now: ${bundle} (${price})` :
      `Saving up for ${bundle} (${price})` + (wait ? ` · affordable in ${wait}` : ' · run jobs to earn cash'));
  }

  function showAway(report) {
    if (!away) away = { seconds: 0, credited: 0, earned: 0, siblingJobs: 0, throttleSeconds: 0, resolutions: new Set() };
    away.seconds += report.seconds;
    away.credited += report.credited;
    away.earned += report.earned;
    away.siblingJobs += report.siblingJobs || 0;
    away.throttleSeconds += report.throttle * report.credited;
    for (const notice of report.notices) {
      if (notice.type === 'contract-complete') {
        away.resolutions.add(`${contractDef(notice.id).name} complete (+${money(notice.reward)})`);
      } else if (notice.away) {
        const title = incidentTypes.get(notice.id).title;
        away.resolutions.add(title + (notice.type === 'ended' ? ' — effect ended' : ' — offer expired'));
      }
    }
    if (report.priorityLapsed) away.resolutions.add('Priority request lapsed');

    const earnedLine = para(money(away.earned), 'big-number');
    const body = [
      para(`While you were away for ${E.formatDuration(away.seconds)}, your datacenter earned`),
      earnedLine,
      para(`Credited ${E.formatDuration(away.credited)} · Offline limit ${report.offlineCapSeconds / 3600}h`, 'muted'),
    ];
    const averageSpeed = away.credited > 0 ? away.throttleSeconds / away.credited : 1;
    if (averageSpeed < 1) {
      body.push(para(`With overheating, machines averaged ${(averageSpeed * 100).toFixed(1)}% speed during credited time.`, 'muted'));
    }
    if (away.siblingJobs) body.push(para(`Little Sibling ran ${away.siblingJobs.toLocaleString('en-US')} ${away.siblingJobs === 1 ? 'job' : 'jobs'}.`));
    if (away.resolutions.size) body.push(para([...away.resolutions].join(' · '), 'muted'));
    if (rewardedEnabled && E.canDoubleOffline(state, report)) away.rewardReport = report;
    if (away.rewardReport) {
      away.earnedLine = earnedLine;
      const watch = make('button', 'btn', 'Double your offline earnings');
      watch.type = 'button';
      watch.id = 'offline-watch';
      watch.dataset.adOffer = '';
      watch.hidden = true;
      const detail = para('', 'muted');
      detail.hidden = true;
      const receipt = para('', 'reward-receipt');
      receipt.setAttribute('role', 'status');
      watch.addEventListener('click', () => rewardControls?.watchReturn());
      away.watch = watch;
      away.rewardDetail = detail;
      away.rewardReceipt = receipt;
      body.push(watch, detail, receipt);
    }
    const copy = para('', 'welcome-buy-copy');
    copy.id = 'welcome-recommendation';
    body.push(copy);
    if (report.earned > 0) log(`While you were away (${E.formatDuration(report.seconds)}), your datacenter earned ${money(report.earned)}.`, 'good');
    let bought;
    openModal('Welcome back!', body, [
      { label: 'Nice' },
      { id: 'welcome-buy', label: 'Buy it', style: 'primary', beforeClose() {
        if (suspended || document.hidden) return false;
        const shown = away.plan;
        const now = Date.now();
        const anotherAbsence = now - state.lastTick >= AWAY_NOTICE_SECONDS * 1000;
        updateClock(now, true, false);
        if (anotherAbsence) return false;
        bought = E.buyRecommendation(state, shown);
        if (!bought.ok) refreshWelcomeBuy(true);
        return bought.ok;
      }, onClick() {
        // The originating shop card can be on another tab. The room is the shared feedback surface.
        feel.spend(el.room, bought.cost, false);
        feel.purchase(bought.purchases.length);
        for (const item of bought.purchases) {
          const card = cards.find(card => card.kind === item.kind && card.def.id === item.id);
          purchaseLog(card, { cost: item.cost, count: 1 });
        }
        render();
        save();
      } },
    ], () => {
      away = null;
      rewardControls?.refresh();
      state.nextEventIn = Math.max(state.nextEventIn, CONFIG.eventReturnGraceSeconds);
    });
    away.copy = copy;
    away.button = $('welcome-buy');
    refreshWelcomeBuy(true);
    rewardControls?.refresh();
    (away.button.hidden ? el.modalActions.firstElementChild : away.button).focus({ preventScroll: true });
  }

  function locationChoices(ids, primary) {
    const list = make('div', 'choice-list');
    for (const id of ids) {
      const loc = LOCATIONS[id];
      const b = make('button', 'choice');
      b.type = 'button';
      if (primary) b.dataset.extraLocation = id;
      else b.dataset.location = id;
      b.append(UIIcons.paint(make('span', 'choice-pin'), loc.icon));
      if (loc.signature) {
        b.append(make('span', 'site-name', loc.name), make('strong', 'site-rule', loc.signature));
        if (loc.effect.machinePriceMult > 1) {
          b.append(make('span', 'site-caveat', 'Machines cost ' + percent.format(loc.effect.machinePriceMult - 1) + ' more.'));
        }
        if (id === 'bunker' && state.challenge === 'bootstrapped') {
          b.append(make('span', 'site-caveat', 'Staff are unavailable during Bootstrapped.'));
        }
      } else {
        b.append(make('strong', null, loc.name), make('span', null, loc.desc));
      }
      b.addEventListener('click', () => {
        if (!primary) {
          const extras = E.franchiseChoices(state, id);
          if (extras.length) {
            openModal('Choose your Franchise branch', [
              para(`Your room will be in the ${LOCATIONS[id].name}. Pick another stage-2 site as a branch. Its bonus stays with you through later expansions.`),
              locationChoices(extras, id),
            ], [{ label: 'Back', onClick: showMoveChoice }]);
            return;
          }
        }
        if (!settleBeforePurchaseOrMove()) return;
        const move = E.moveTo(state, primary || id, Date.now(), primary ? id : null);
        if (move.ok) {
          el.modal.close();
          for (const card of cards) card.quote = null;
          roomKey = '';
          checkStory(render());
          if (move.freeHires?.length) {
            const names = move.freeHires.map(hire => E.lookup('staff', hire).name).join(' and ');
            const receipt = 'Hired for free: ' + names;
            log(receipt, 'good');
            feel.showMoment(receipt, false);
          }
          save();
        }
      });
      list.appendChild(b);
    }
    return list;
  }

  function showMoveChoice() {
    if (!E.canMove(state)) return;
    const next = E.nextStage(state);
    const first = next.number === 2;
    state.flags[first ? 'moveChoiceSeen' : 'expandChoiceSeen:' + next.number] = true;
    el.moveBtn.classList.remove('awaiting-tap');
    save();
    const ids = E.moveDestinations(state);
    const body = [para(first
      ? `You earned ${shortMoney(next.target)} this run. Pick your first space outside the basement.`
      : `You earned ${shortMoney(next.target)} this run. Your team and equipment move with you. Earlier sites stay open.`)];
    const machine = E.lookup('machine', first && !state.runs ? 'gpu' : next.machineUnlock);
    const unlock = make('p', 'stage-unlock');
    const name = first && state.runs ? 'GPU Rig and ' + machine.name : machine.name;
    unlock.append(UIIcons.paint(make('span'), machine.icon), make('span', null, 'Unlocks: ' + name));
    body.push(unlock, locationChoices(ids));
    openModal(`Stage ${next.number} · ${next.name}`, body, [{ label: 'Not yet' }]);
  }

  function renderSaleQuote() {
    const gained = E.pendingStars(state);
    const total = state.stars + gained;
    setText(saleQuote.querySelector('.sale-gain'), `+${gained.toLocaleString('en-US')} stars of Investor Reputation`);
    setText(saleQuote.querySelector('.sale-total'), `${total.toLocaleString('en-US')} total stars`);
    setText(saleQuote.querySelector('.sale-bonus'), `Income and job pay: ${starBonus(state.stars)} → ${starBonus(total)}`);
    setHidden(saleQuote.querySelector('.sale-double'), state.stars === 0 || gained !== state.stars);
    if (saleChallengePicker) setHidden(saleChallengePicker.wrap, total < E.BOARD_STARS);
  }

  function showRunSummary() {
    if (modalOpen() || !settleBeforePurchaseOrMove() || !E.canSell(state)) return;
    const summary = E.runSummary(state, Date.now());
    const list = make('dl');
    list.id = 'run-summary';
    const rows = [
      ['Money earned this run', money(summary.earnings)],
      ['Best income/s', rate(summary.bestIncome)],
      ['Machines owned', summary.machines.toLocaleString('en-US')],
      ['Run length', summary.durationSeconds === null ? 'Not recorded' : E.formatDuration(summary.durationSeconds)],
      ['Sites this run', E.runSites(state).map(id => LOCATIONS[id].name).join(' → ')],
    ];
    for (const [label, value] of rows) {
      const row = make('div');
      row.append(make('dt', null, label), make('dd', null, value));
      list.appendChild(row);
    }
    openModal(`Run ${state.runs + 1} summary`, [list], [
      { label: 'Not yet' }, { label: 'Review sale', style: 'primary', onClick: confirmSale },
    ]);
  }

  function showPerkOffer(gained = 0) {
    const tier = E.nextPerkOffer(state);
    if (!tier) return;
    const receipt = gained ? `Sold for +${gained.toLocaleString('en-US')} stars` : 'Sale complete';
    setText(el.perkTier, `${receipt} · ${tier.stars}-star offer`);
    el.perkOptions.replaceChildren();
    for (const perk of tier.options) {
      const button = make('button', 'perk-choice');
      button.type = 'button';
      button.dataset.perk = perk.id;
      const icon = UIIcons.paint(make('span', 'perk-icon'), perk.icon);
      icon.setAttribute('aria-hidden', 'true');
      button.append(icon, make('strong', null, perk.name), make('span', 'perk-desc', perk.desc));
      button.addEventListener('click', () => {
        const choice = E.pickPerk(state, perk.id, Date.now());
        if (!choice.ok) return;
        log(`Investor perk chosen: ${perk.name}.`, 'big');
        save();
        if (choice.started) {
          el.perkDialog.close();
          beginRun();
        } else showPerkOffer();
      });
      el.perkOptions.appendChild(button);
    }
    if (!el.perkDialog.open) el.perkDialog.showModal();
    el.perkOptions.firstElementChild.focus({ preventScroll: true });
    guidance.update(lastStats, true);
    if (gained) {
      el.perkDialog.appendChild($('fx-canvas'));
      feel.celebrateSale(el.perkTier);
    }
  }

  function beginRun(gained = 0) {
    if (el.perkDialog.contains($('fx-canvas'))) $('moment-banner').before($('fx-canvas'));
    resetRunView();
    animateStartingRoom = true;
    const st = render();
    checkStory(st);
    save();
    const details = [];
    if (gained) details.push(`Sold for +${gained.toLocaleString('en-US')} stars`);
    if (state.machines.laptop) details.push(`Starter Kit: ${state.machines.laptop} laptops ready`);
    if (state.coolers.fan) details.push(`${state.coolers.fan} Box Fan${state.coolers.fan === 1 ? '' : 's'}`);
    if (state.upgrades.includes('macros')) details.push('Keyboard Macros');
    if (E.runStartCash(state)) details.push(`${exactMoney(E.runStartCash(state))} starting cash`);
    if (state.staff.sibling) details.push(`Little Sibling Lv. ${state.staff.sibling}`);
    if (state.staff.sysadmin) details.push('Sysadmin hired');
    const challenge = E.CHALLENGES.find(def => def.id === state.challenge);
    if (challenge) details.push(challenge.name + ' · ' + challenge.twist);
    details.push(`${runStarBonus()} income`);
    feel.beginRun(state.runs + 1, details.join(' · '));
    if (gained) feel.celebrateSale($('moment-banner'));
    el.room.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    el.jobBtn.focus({ preventScroll: true });
  }

  function confirmSale() {
    if (modalOpen() || !settleBeforePurchaseOrMove() || !E.canSell(state)) return;
    saleQuote = make('div', 'sale-quote');
    saleQuote.append(make('strong', 'sale-gain'), make('span', 'sale-total'), make('span', 'sale-bonus'),
      make('strong', 'sale-double', 'This doubles your bonus.'));
    const picker = nextChallengePicker();
    saleChallengePicker = picker;
    renderSaleQuote();
    openModal('Sell the startup?', [
      saleQuote,
      para('Keep your Investor Reputation, investor perks, achievements, decorations, all-time earnings, stats and records.' +
        (state.challengeRewards.length ? ' Your Board rewards carry over too.' : '')),
      para('Your sites, machines, cooling, upgrades and staff go with the company. Current incidents and offers end. Your starting perks apply when you reopen in the basement.'),
      ...(picker ? [picker.wrap] : []),
    ], [
      { label: 'Not yet', style: 'primary' },
      { label: 'Sell', style: 'sale-confirm', onClick: () => {
        if (!settleBeforePurchaseOrMove()) return;
        const result = E.sellStartup(state, Date.now(), picker?.select.value || null);
        if (!result.ok) return;
        log(`Sold the startup for ${result.gained.toLocaleString('en-US')} stars of Investor Reputation.`, 'big');
        save();
        if (E.nextPerkOffer(state)) showPerkOffer(result.gained);
        else beginRun(result.gained);
      } },
    ]);
  }

  function confirmReset() {
    openModal('Reset everything?', [
      para('This deletes your save and starts over in the basement with $0. It cannot be undone.'),
    ], [
      { label: 'Cancel', style: 'primary' },
      { label: 'Yes, wipe it', style: 'danger', onClick: resetGame },
    ]);
  }

  function resetRunView() {
    decorStudio.close();
    if (pendingStaffOrders.length) showStaffOrders();
    lastManagerPurchase = -Infinity;
    nextStaffPaint = 0;
    clearFireMoment();
    nextAlarmTone = 0;
    guidance.reset();
    todoPanel.hidden = true;
    todoToggle.setAttribute('aria-expanded', 'false');
    $('goal-slots').replaceChildren();
    todoRows.clear();
    nextGoalRefresh = 0;
    setText($('goals-receipt'), '');
    el.sysadminReceipt.hidden = true;
    clearTimeout(receiptTimer);
    receiptFading = false;
    priority.reset();
    feel.resetRun();
    rememberRevealedItems(true);
    roomKey = '';
    installedKey = null;
    for (const card of cards) {
      if (card.milestone) { card.milestone.lastOwned = null; card.milestone.shownOwned = null; }
    }
  }

  function resetGame() {
    wipeSave();
    achievementPanel.reset();
    state = E.newState(Date.now());
    resetRunView();
    el.log.textContent = '';
    el.log.classList.remove('full-log');
    log('Save wiped. Back to the basement.');
    const st = render();
    checkStory(st);
    save();
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  function runManualJob(ev) {
    const value = E.click(state, Date.now());
    if (!value) return;
    recentTaps.push({ at: performance.now(), amount: value });
    const p = ev.detail || ev.pointerType ? { x: ev.clientX, y: ev.clientY } : centerOf(el.jobBtn);
    feel.tap(p.x, p.y, value, lastStats?.income || 0);
    // A manual job changes only cash, lifetime earnings and click count. Let input
    // share one shop refresh per frame while income and heat stay on their game timer.
    if (!lastStats) { render(); return; }
    scheduleScreenUpdate();
  }
  el.jobBtn.addEventListener('click', runManualJob);
  el.room.addEventListener('click', ev => {
    if (decorStudio.roomClick(ev)) return;
    if (!ev.target.closest('button, a, input, [role="button"]')) runManualJob(ev);
  });
  el.room.addEventListener('contextmenu', ev => ev.preventDefault());
  el.jobBtn.addEventListener('contextmenu', ev => ev.preventDefault());

  // Keyboard shortcuts on a computer: Space runs a job, 1–4 pick ×1/×10/×100/Max, and
  // M/C/U/H open the Machines, Cooling, Upgrades and Hires (Staff) shop tabs. Held keys don't
  // repeat jobs, typing in a field is never intercepted, and dialogs keep their own keys.
  const SHORTCUT_QUANTITY = { 1: '1', 2: '10', 3: '100', 4: 'max' };
  const SHORTCUT_TABS = { m: 'machine', c: 'cooler', u: 'upgrade', h: 'staff' };
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || !state) return;
    if (document.querySelector('dialog[open]')) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === ' ') {
      // Space on a focused button or link already presses that control.
      if (target?.closest('button, a, summary, [role="button"]')) return;
      event.preventDefault();  // no page scroll
      if (!event.repeat && !el.jobBtn.disabled) runManualJob(new Event('keyboard'));
      return;
    }
    if (event.repeat) return;
    const amount = SHORTCUT_QUANTITY[key];
    if (amount) {
      const radio = quantityControl.querySelector(`input[value="${amount}"]`);
      if (radio && !radio.checked) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }
    const tab = shopTabs.get(SHORTCUT_TABS[key]);
    if (tab && !tab.button.hidden) tab.button.click();
  });
  el.moveBtn.addEventListener('click', showMoveChoice);
  $('location-map')?.addEventListener('click', showLocationMap);
  el.sellBtn.addEventListener('click', showRunSummary);
  // Settings → Numbers: Standard ($4.20Qa), Scientific ($4.20e15) or Engineering ($4.20e15 / $42.0e15).
  // A display preference for this device; the save never changes.
  const notationButton = $('notation-toggle');
  const notationNames = { standard: 'Standard', scientific: 'Scientific', engineering: 'Engineering' };
  function paintNotation() {
    setText(notationButton, 'Numbers: ' + notationNames[E.getNotation()]);
  }
  function refreshNumberText() {
    paintedIncome = paintedStaffIncome = undefined;
    feel.refreshMoneyText();
    for (const card of cards) {
      card.displayedQuote = card.lastShortfall = card.lockedText = card.statValue = card.detailValue = null;
      delete card.cost.dataset.amountKey;
      delete card.shortfall.dataset.amountKey;
    }
    shopStructure = '';
    shopMoney = undefined;
    if (lastStats) setText(el.jobValue, '+' + money(lastStats.clickValue));
    render();
    updateTitle(true);
  }
  notationButton.addEventListener('click', () => {
    const next = E.NOTATIONS[(E.NOTATIONS.indexOf(E.getNotation()) + 1) % E.NOTATIONS.length];
    E.setNotation(next);
    try { localStorage.setItem(NOTATION_KEY, next); } catch { /* Kept for this session. */ }
    paintNotation();
    refreshNumberText();
  });
  paintNotation();

  $('board-btn').addEventListener('click', showBoardRoom);
  $('stats-board-btn').addEventListener('click', showBoardRoom);
  el.perkDialog.addEventListener('cancel', event => event.preventDefault());
  el.resetBtn.addEventListener('click', confirmReset);
  el.accept.addEventListener('click', () => answerIncident('accept'));
  el.decline.addEventListener('click', () => answerIncident('decline'));
  for (const type of ['animationend', 'animationcancel']) {
    el.incident.addEventListener(type, event => {
      if (event.animationName === 'incident-attention') el.incident.classList.remove('incident-new');
    });
  }

  // A hidden page can keep receiving throttled intervals. Leave its saved clock anchored
  // at departure so the whole absence gets one offline cap and one welcome-back summary.
  function suspend() {
    if (suspended || reloadingSave) return;
    if (pendingStaffOrders.length) render();
    suspended = true;
    clearFireMoment();
    setHidden(el.fireEdge, true);
    nextAlarmTone = 0;
    achievementPanel.suspend();
    updateClock(Date.now(), false);
    save();
  }

  function resume() {
    if (!suspended || adPlaying || document.visibilityState !== 'visible') return;
    suspended = false;
    frame(false);
    save();
  }

  document.addEventListener('visibilitychange', () => {
    feel.visibility();
    if (document.visibilityState === 'hidden') suspend();
    else resume();
  });
  window.addEventListener('pagehide', suspend);
  window.addEventListener('pageshow', resume);
  document.addEventListener('freeze', save);

  // ---------------------------------------------------------------------------
  // Game loop
  // ---------------------------------------------------------------------------

  let receiptTimer = 0, receiptFading = false;
  let receiptBuys = 0, receiptItems = 0, receiptIncludesSysadmin = false;
  const sysadminLabel = 'Sysadmin', managerLabel = 'Manager';
  function managerBurst() {
    return state.staff.manager && state.managerEnabled && el.room.dataset.stage === String(roomStageThresholds.length) &&
      performance.now() - lastManagerPurchase < MANAGER_DISPLAY_MS;
  }

  function staffOrderText(items) {
    if (items.length === 1) {
      const {buyer, name, count} = items[0];
      return `${buyer} bought ${count} × ${name}`;
    }
    const buyers = new Map();
    for (const {buyer, name, count} of items) {
      if (!buyers.has(buyer)) buyers.set(buyer, new Map());
      const counts = buyers.get(buyer);
      counts.set(name, (counts.get(name) || 0) + count);
    }
    return [...buyers].map(([buyer, counts]) => buyer + ' bought ' +
      [...counts].map(([name, count]) => `${count} × ${name}`).join(' + ')).join(' · ');
  }

  function showStaffOrders() {
    const orders = pendingStaffOrders.splice(0);
    const rows = document.createDocumentFragment();
    for (const order of orders) writeLogRow(staffOrderText(order), 'good staff-transaction', rows);
    el.log.prepend(rows);
    nextStaffPaint = performance.now() + MANAGER_DISPLAY_MS;
    const enter = el.sysadminReceipt.hidden || receiptFading;
    const compact = managerBurst();
    if (compact) {
      if (enter || !el.sysadminReceipt.classList.contains('compact-receipt')) {
        receiptBuys = receiptItems = 0;
        receiptIncludesSysadmin = false;
      }
      for (const order of orders) {
        // A Manager bundle is one decision, including its cooling. Each
        // Sysadmin purchase is an individual cooler.
        let includesManager = false;
        for (const item of order) {
          receiptItems += item.count;
          if (item.buyer === sysadminLabel) {
            receiptIncludesSysadmin = true;
            receiptBuys += item.count;
          } else includesManager = true;
        }
        if (includesManager) receiptBuys++;
      }
      const buyer = receiptIncludesSysadmin ? 'Staff' : 'Manager';
      setText(el.sysadminReceipt, `${buyer} · ${receiptBuys} ${receiptBuys === 1 ? 'buy' : 'buys'} · ${receiptItems} ${receiptItems === 1 ? 'item' : 'items'}`);
    } else setText(el.sysadminReceipt, staffOrderText(orders.flat()));
    if (el.sysadminReceipt.classList.contains('compact-receipt') !== !!compact) {
      el.sysadminReceipt.classList.toggle('compact-receipt', !!compact);
      if (compact) el.sysadminReceipt.title = 'Every purchase is listed in the Log.';
      else el.sysadminReceipt.removeAttribute('title');
    }
    receiptFading = false;
    el.sysadminReceipt.hidden = false;
    if (enter && receiptInView) feel.staffReceipt(false);
    clearTimeout(receiptTimer);
    receiptTimer = setTimeout(() => {
      receiptFading = true;
      if (receiptInView) feel.staffReceipt(true);
      receiptTimer = setTimeout(() => { el.sysadminReceipt.hidden = true; receiptFading = false; }, STAFF_RECEIPT_FADE_MS);
    }, STAFF_RECEIPT_MS - STAFF_RECEIPT_FADE_MS);
  }

  function runLiveStaff(now) {
    if (!state.staff.sysadmin && !state.staff.manager) return;
    const items = [];
    if (state.staff.sysadmin && state.staff.sysadminEnabled) {
      for (const {id, count} of E.runSysadmin(state)) {
        items.push({buyer: sysadminLabel, name: E.lookup('cooler', id).name, count});
      }
    }
    if (state.staff.manager && state.managerEnabled) {
      for (const plan of E.runManager(state, now, recentTapRate(performance.now()), true)) {
        lastManagerPurchase = performance.now();
        for (const {kind, id} of plan.steps) items.push({buyer: managerLabel, name: E.lookup(kind, id).name, count: 1});
      }
    }
    if (!items.length) return;
    pendingStaffOrders.push(items);
    save();
  }

  function flushBeforeControl(event) {
    if (pendingStaffOrders.length && !el.jobBtn.contains(event.target) && !el.room.contains(event.target)) render();
  }
  document.addEventListener('click', flushBeforeControl, true);
  document.addEventListener('input', flushBeforeControl, true);
  document.addEventListener('focusin', flushBeforeControl, true);

  function updateClock(now, foreground, allowSpawn = true) {
    if (state.perkChoicePending) return;
    const gap = (now - state.lastTick) / 1000;
    const live = foreground && liveGap(gap);
    if (!live) recentTaps.length = 0;
    const inGame = !modalOpen();
    const report = E.catchUp(state, now, { live, countLive: live && inGame, allowSpawn: allowSpawn && inGame });
    if (!live && !suspended && state.priorityWasFlying) {
      report.priorityLapsed = true;
      delete state.priorityWasFlying;
    }
    handleNotices(report.notices);
    if (report.seconds >= AWAY_NOTICE_SECONDS) showAway(report);
    if (live && inGame && gap > 0) runLiveStaff(now);
    priority.tick(now, live, gap, allowSpawn);
    if (live && inGame) backups.trackLive(report.seconds, now);
  }

  function liveGap(seconds) {
    return !suspended && document.visibilityState === 'visible' && seconds >= 0 && seconds <= CONFIG.eventLiveGapSeconds;
  }

  function modalOpen() { return el.modal.open || el.perkDialog.open || el.settingsDialog?.open || el.photoDialog.open || achievementPanel.isOpen(); }

  // A click can arrive ahead of the first timer after sleep. Pay for elapsed time
  // at the old production rate before a purchase or move changes that rate.
  function settleBeforePurchaseOrMove() {
    if (suspended || document.visibilityState !== 'visible') return false;
    updateClock(Date.now(), true);
    if (!away) return true;
    render();
    save();
    return false;
  }

  function scheduleScreenUpdate(clockTick = false) {
    if (suspended || document.hidden || reloadingSave) return;
    tickDue ||= clockTick;
    if (uiFrame) return;
    uiFrame = requestAnimationFrame(() => {
      uiFrame = 0;
      const clock = tickDue;
      tickDue = false;
      if (suspended || document.hidden || reloadingSave) return;
      if (clock) { paintClockTick(); return; }
      if (powerChanged || !lastStats) { render(); return; }
      feel.updateMoney(state.money, lastStats.income);
      renderTapBoost(lastStats.income);
      renderShop(lastStats);
      renderGoal();
      achievementPanel.update(lastStats);
      if (state.event?.price != null) el.accept.disabled = state.money < state.event.price;
    });
  }

  function paintClockTick() {
    if (state.perkChoicePending) { guidance.update(lastStats); return; }
    const st = render(true);
    if (!pendingStaffOrders.length) updateShopAdvice();
    checkStory(st);
    guidance.update(st);
    if (Date.now() - lastSavedAt >= SAVE_EVERY_MS) save();
  }

  function frame(foreground) {
    if (reloadingSave || suspended || document.hidden) return;
    updateClock(Date.now(), foreground);
    paintClockTick();
  }

  function timerTick() {
    if (reloadingSave || suspended || document.hidden) return;
    updateClock(Date.now(), true);
    scheduleScreenUpdate(true);
  }

  function start() {
    buildShop();
    requestPersistentStorage();
    const saved = readSave();
    state = saved ? E.deserialize(saved, Date.now()) : E.newState(Date.now());
    guidance.initialize(!!saved);
    E.ensureGoals(state);
    previousOffer = state.event;
    previousMoveReady = E.canMove(state);
    rememberRevealedItems();
    if (saved) log('Save loaded. Welcome back.');
    suspended = document.visibilityState !== 'visible';
    if (E.nextPerkOffer(state)) {
      render();
      showPerkOffer();
    } else frame(false); // opening a running game settles elapsed time as an absence
    setInterval(timerTick, FRAME_MS);

    // Small hook for debugging and playtesting from the browser console.
    window.game = {
      get state() { return state; },
      give(amount) { E.earn(state, amount); render(); },
      skip(seconds) { state.lastTick -= seconds * 1000; },  // pretend you were away
      spawnBonus: priority.force,
      save, reset: resetGame,
    };
  }

  function createDecorationStudio() {
    const openButton = $('decorate-btn'), done = $('decor-done'), workbench = $('decor-workbench');
    const heading = $('decor-heading'), slots = $('decor-slots'), picker = $('decor-picker');
    const items = $('decor-items'), use = $('decor-use'), reset = $('decor-default');
    const back = $('decor-picker-close'), dot = $('decor-dot'), toast = $('decor-toast');
    const shot = $('decor-snapshot'), photo = el.photoDialog, preview = $('decor-photo-preview');
    const download = $('decor-download'), share = $('decor-share'), photoStatus = $('decor-photo-status');
    const catalog = new Map(E.DECORATIONS.map(item => [item.id, item]));
    let editing = false, slot = null, selected = null, previousState, equipped;
    let unlockedCount = -1, toastUntil = 0, picture = null, photoURL = '', captureId = 0;

    function paintRoom() {
      const look = slot && selected ? { ...state.decor.equipped, [slot]: selected } : state.decor.equipped;
      dollhouse.setDecor(look, editing, slot);
      equipped = state.decor.equipped;
    }

    function paintSelection() {
      for (const button of items.children) button.setAttribute('aria-pressed', String(button.dataset.decorItem === selected));
      const current = state.decor.equipped[slot] || null;
      use.disabled = !selected || current === selected;
      setText(use, selected && current === selected ? 'In room' : 'Use');
      setText($('decor-room-help'), selected ? (current === selected ? 'In room · ' : 'Preview · ') + catalog.get(selected).name : 'Choose an item to preview');
      reset.disabled = !current && !selected;
    }

    function populate() {
      items.replaceChildren();
      for (const item of E.decorPicker(state, slot)) {
        const button = make('button', 'decor-item');
        button.type = 'button';
        button.dataset.decorItem = item.id;
        button.disabled = !item.unlocked;
        const art = make('span', 'decor-art');
        art.setAttribute('aria-hidden', 'true');
        art.innerHTML = RoomScene.thumbnail(item.id);
        button.append(art, make('span', 'decor-item-name', item.name));
        if (!item.unlocked) {
          const lock = make('span', 'decor-lock');
          UIIcons.paint(lock, 'lock');
          button.append(lock, make('small', 'decor-hint', 'How to unlock: ' + item.hint));
        }
        items.append(button);
      }
      paintSelection();
    }

    function chooseSlot(id, focus = true) {
      if (!editing) return;
      slot = id;
      selected = id ? state.decor.equipped[id] || null : null;
      const category = E.DECOR_SLOTS.find(entry => entry.id === id);
      setText(heading, category?.name || 'Choose a spot');
      setText($('decor-category'), category ? 'Room collection' : 'Decorate');
      setHidden(slots, !!id);
      setHidden(picker, !id);
      setHidden(back, !id);
      if (id) { populate(); items.scrollTop = 0; }
      else setText($('decor-room-help'), 'Tap a spot to decorate');
      setText($('decor-status'), '');
      paintRoom();
      if (focus) heading.focus({ preventScroll: true });
    }

    function setEditing(on) {
      editing = on;
      if (on) {
        window.GameShell.close();
        E.refreshDecor(state);
        if (E.markDecorSeen(state)) save();
        setHidden(dot, true);
      }
      document.body.classList.toggle('decorating', on);
      openButton.setAttribute('aria-expanded', String(on));
      setHidden(done, !on);
      setHidden($('decor-tools'), !on);
      setHidden(workbench, !on);
      if (on) chooseSlot(null);
      else {
        slot = selected = null;
        paintRoom();
        openButton.focus({ preventScroll:true });
      }
    }

    for (const entry of E.DECOR_SLOTS) {
      const button = make('button', null, entry.name);
      button.type = 'button';
      button.addEventListener('click', () => chooseSlot(entry.id));
      slots.append(button);
    }
    openButton.addEventListener('click', () => setEditing(true));
    done.addEventListener('click', () => setEditing(false));
    back.addEventListener('click', () => chooseSlot(null));
    items.addEventListener('click', event => {
      const card = event.target.closest('[data-decor-item]');
      if (!card || card.disabled) return;
      selected = card.dataset.decorItem;
      paintRoom(); paintSelection();
      setText($('decor-status'), 'Previewing ' + catalog.get(selected).name);
    });
    function apply(id) {
      if (!E.equipDecor(state, slot, id)) return;
      selected = id;
      paintRoom(); paintSelection();
      setText($('decor-status'), id ? catalog.get(id).name + ' is in your room.' : 'Default restored.');
      save();
    }
    use.addEventListener('click', () => apply(selected));
    reset.addEventListener('click', () => apply(null));
    document.addEventListener('keydown', event => {
      if (!editing || event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      if (slot) chooseSlot(null); else setEditing(false);
    });
    function roomClick(event) {
      if (!editing) return false;
      const handle = event.target.closest('[data-decor-slot]');
      if (handle) chooseSlot(handle.dataset.decorSlot);
      return true;
    }

    function releasePicture() {
      captureId++;
      if (photoURL) URL.revokeObjectURL(photoURL);
      photoURL = ''; picture = null;
      preview.removeAttribute('src');
      setHidden(preview, true); setHidden(download, true); setHidden(share, true);
    }
    shot.addEventListener('click', async () => {
      releasePicture();
      const id = captureId;
      setText(photoStatus, 'Preparing your snapshot…');
      photo.showModal();
      try {
        const file = await RoomSnapshot.capture(el.room.querySelector('.dollhouse'));
        if (captureId !== id || !photo.open) return;
        picture = file;
        photoURL = URL.createObjectURL(file);
        preview.src = photoURL;
        setHidden(preview, false); setHidden(download, false);
        setHidden(share, !RoomSnapshot.canShare(file));
        setText(photoStatus, '');
      } catch {
        if (captureId === id) setText(photoStatus, 'Couldn’t capture the room. Close this window and try again.');
      }
    });
    $('decor-photo-close').addEventListener('click', () => photo.close());
    photo.addEventListener('close', releasePicture);
    download.addEventListener('click', () => { if (picture) RoomSnapshot.download(picture); });
    share.addEventListener('click', async () => {
      if (!picture) return;
      try { await navigator.share({ files:[picture] }); }
      catch (error) { if (error.name !== 'AbortError') setText(photoStatus, 'Sharing didn’t open. You can download the PNG instead.'); }
    });

    function sync(s, justAchieved) {
      const loaded = previousState !== s;
      if (loaded) {
        previousState = s;
        unlockedCount = -1;
        toastUntil = 0;
        setHidden(toast, true);
      }
      if (equipped !== s.decor.equipped) paintRoom();
      // Reconcile a loaded collection once. After that, moves and sales grant
      // their own items, and only new achievements need a collection check.
      const added = (loaded || justAchieved) && E.refreshDecor(s).length > 0;
      if (unlockedCount !== s.decor.unlocked.length) {
        unlockedCount = s.decor.unlocked.length;
        if (editing && slot) populate();
        setHidden(dot, !s.decor.unseen.length);
      }
      if (!toastUntil && !s.decor.pending.length) return added;
      const now = performance.now();
      if (toastUntil) {
        if (now < toastUntil) return added;
        toastUntil = 0;
        setHidden(toast, true);
      }
      if (!s.decor.pending.length || document.hidden || modalOpen()) return added;
      const notice = E.takeDecorNotice(s);
      if (notice) {
        const first = catalog.get(notice.ids[0]);
        const title = notice.summary ? notice.ids.length + ' decoration' + (notice.ids.length === 1 ? '' : 's') + ' unlocked' : 'Decoration unlocked: ' + first.name;
        $('decor-toast-icon').innerHTML = RoomScene.thumbnail(first.id);
        setText($('decor-toast-text'), title);
        setHidden(toast, false);
        toastUntil = now + 3400;
        feel.decorUnlock();
        return true;
      }
      return added;
    }
    return { sync, roomClick, close: () => { if (editing) setEditing(false); } };
  }

  function createAchievementPanel({ state, feel, log, save }) {
    const opener = $('achievements-btn');
    const dialog = $('achievements-dialog');
    const count = $('achievement-count');
    const summary = $('trophy-total');
    const tabs = [$('achievements-tab'), $('stats-tab')];
    const views = [$('achievements-view'), $('stats-view')];
    const grid = $('achievement-grid');
    const statsList = $('stats-list');
    const toast = $('achievement-toast');
    const byId = new Map(E.ACHIEVEMENTS.map(def => [def.id, def]));
    const badges = [];
    const statCells = [];
    const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
    const cash = value => '$' + whole.format(Math.floor(value));
    const statRows = [
      ['decor', 'Collection', s => 'Decor ' + s.decor.unlocked.length + '/' + E.DECORATIONS.length],
      ['runs', 'Completed sales', s => whole.format(s.runs)],
      ['stars', 'Investor Reputation', s => whole.format(s.stars) + ' stars'],
      ['reputationBonus', 'Income and job pay bonus', s => starBonus(s.stars)],
      ['allTimeEarnings', 'All-time earnings', s => cash(s.allTimeEarnings)],
      ['lifetime', 'This run’s earnings', s => cash(s.lifetime)],
      ['sites', 'Sites this run', s => E.runSites(s).map(id => LOCATIONS[id].name).join(' → ')],
      ['fastestMove', 'Fastest first move', s => s.records.fastestMoveSeconds === null ? 'Not recorded' : E.formatDuration(s.records.fastestMoveSeconds)],
      ['bestRun', 'Best run earnings', s => cash(s.records.bestRunEarnings)],
      // Prices are whole dollars. Parallel fractional earnings can leave the
      // subtraction a fraction of a cent below the amount actually spent.
      ['moneySpent', 'Money spent this run', s => '$' + whole.format(Math.max(0, E.runStartCash(s) + s.lifetime + (s.runInsurancePaid || 0) - s.money))],
      ['clicks', 'Jobs by hand', s => whole.format(s.clicks)],
      ['clickValue', 'Pay per hand tap', (_s, st) => money(st.clickValue)],
      ['siblingJobs', 'Jobs by Little Sibling', s => whole.format(Math.floor(s.counters.siblingJobs))],
      ['staffIncome', 'Little Sibling income/s', (_s, st) => rate(st.staffIncome)],
      ['sysadminPurchases', 'Sysadmin cooling purchases', s => whole.format(s.counters.sysadminPurchases)],
      ['liveSeconds', 'Time played', s => E.formatDuration(s.counters.liveSeconds)],
      ['machinesBought', 'Machines bought', s => whole.format(s.counters.machinesBought)],
      ['coolersBought', 'Coolers bought', s => whole.format(s.counters.coolersBought)],
      ['highestIncome', 'Highest income/s', s => E.formatRate(s.counters.highestIncome)],
      ['incidentsHandled', 'Incidents handled', s => whole.format(s.counters.incidentsAccepted + s.counters.incidentsDeclined)],
      ['bonusesCaught', 'Bonuses caught', s => whole.format(s.counters.bonusesCaught)],
      ['bonusesMissed', 'Bonuses missed', s => whole.format(s.counters.bonusesMissed)],
      ['fires', 'Fires', s => whole.format(s.counters.fires)],
      ['insurancePaid', 'Insurance paid', s => insuranceMoney(s.counters.insurancePaid)],
      ['bonusCashEarned', 'Bonus cash earned', s => cash(s.counters.bonusCashEarned)],
      ['timeToMove', 'Time to first move', s => {
        if (s.location === 'basement') return 'Not yet';
        return s.counters.moveTimeRecorded
          ? E.formatDuration(s.counters.timeToMove) : 'Not recorded';
      }],
    ];
    let activeTab = 0;
    let displayedCount = -1;
    let nextPaint = 0;
    let toastTimer = 0;

    function showCount(unlocked) {
      if (displayedCount === unlocked) return;
      displayedCount = unlocked;
      const total = byId.size;
      const displayed = rewardedEnabled ? total : E.ACHIEVEMENTS.filter(d => !d.rewardedOnly || state().achievements.includes(d.id)).length;
      setText(count, unlocked + '/' + displayed);
      setText(summary, unlocked + ' of ' + displayed + ' unlocked');
      opener.setAttribute('aria-label', 'Achievements and stats, ' + summary.textContent);
    }

    function buildViews() {
      if (badges.length) return;
      const badgeItems = document.createDocumentFragment();
      for (const def of E.ACHIEVEMENTS) {
        if (def.rewardedOnly && !rewardedEnabled && !state().achievements.includes(def.id)) continue;
        const item = make('li', 'achievement-badge');
        item.dataset.achievement = def.id;
        const icon = make('span', 'badge-icon');
        icon.setAttribute('aria-hidden', 'true');
        const copy = make('div', 'badge-copy');
        const name = make('h3', 'badge-name');
        const desc = make('p', 'badge-desc');
        copy.append(name, desc);
        let bar = null;
        if (def.progress) {
          bar = make('progress', 'badge-progress');
          bar.max = 100;
          copy.appendChild(bar);
        }
        item.append(icon, copy);
        badgeItems.appendChild(item);
        badges.push({ def, item, icon, name, desc, bar });
      }
      grid.appendChild(badgeItems);
      for (const [id, label, read] of statRows) {
        const row = make('div', 'trophy-stat');
        const value = make('dd');
        value.dataset.stat = id;
        row.append(make('dt', null, label), value);
        statsList.appendChild(row);
        statCells.push({ value, read });
      }
    }

    let lastPerkKey;
    function paintPerks(s) {
      const key = JSON.stringify([s.stars, s.perks, s.challenge, s.challengeRewards]);
      if (key === lastPerkKey) return;
      lastPerkKey = key;
      const list = $('perk-list');
      list.replaceChildren();
      for (const tier of E.PERK_TIERS) {
        const perk = tier.options.find(option => option.id === s.perks[tier.stars]);
        if (!perk) continue;
        const item = make('li');
        item.append(make('strong', null, `${perk.name}`), make('span', null, perk.desc));
        list.appendChild(item);
      }
      const next = E.nextPerkTier(s);
      const counts = E.repeatPerkCounts(s);
      if (next?.repeatable || counts.income || counts.tap) {
        for (const perk of E.REPEAT_PERKS) {
          const count = perk.id === 'incomeDividend' ? counts.income : counts.tap;
          const item = make('li');
          item.append(make('strong', null, `${perk.name} ×${count}`), make('span', null, perk.desc));
          list.appendChild(item);
        }
      }
      setText($('next-perk'), next ? (next.stars <= s.stars ? `Your ${next.stars}-star offer is ready at your next sale.` :
        `Next offer at ${next.stars.toLocaleString('en-US')} stars`) : '');
      setHidden($('stats-board'), s.stars < E.BOARD_STARS);
      const rewards = E.CHALLENGES.filter(def => s.challengeRewards.includes(def.id));
      setText($('board-rewards'), rewards.length ? rewards.map(def => `${def.name} · ${def.reward}`).join('\n') :
        'Complete a Board challenge to earn a permanent reward.');
    }

    function paintView(s, st) {
      if (activeTab === 1) {
        paintPerks(s);
        for (const { value, read } of statCells) setText(value, read(s, st));
        return;
      }
      const earned = new Set(s.achievements);
      for (const badge of badges) {
        const { def, item, name, desc, icon, bar } = badge;
        const unlocked = earned.has(def.id);
        if (badge.unlocked !== unlocked) {
          badge.unlocked = unlocked;
          const secret = def.hidden && !unlocked;
          item.classList.toggle('is-unlocked', unlocked);
          UIIcons.paint(icon, secret ? 'lock' : def.icon);
          setText(name, secret ? '???' : def.name);
          setText(desc, secret ? 'Hidden achievement' : def.desc);
          name.setAttribute('aria-label', name.textContent + (unlocked ? ', unlocked' : ', locked'));
          if (bar) {
            bar.hidden = unlocked || Boolean(secret);
            if (!bar.hidden) bar.setAttribute('aria-label', def.name + ' progress');
            else bar.removeAttribute('aria-label');
          }
        }
        if (bar && !bar.hidden) {
          const percent = Math.floor(100 * Math.min(1, Math.max(0, def.progress(s, st))));
          if (bar.value !== percent || !bar.hasAttribute('value')) bar.value = percent;
        }
      }
    }

    function selectTab(index, focus) {
      activeTab = index;
      for (let i = 0; i < tabs.length; i++) {
        const selected = i === index;
        tabs[i].setAttribute('aria-selected', String(selected));
        tabs[i].tabIndex = selected ? 0 : -1;
        views[i].hidden = !selected;
      }
      const s = state();
      paintView(s, E.stats(s));
      nextPaint = performance.now() + 500;
      if (focus) tabs[index].focus({ preventScroll: true });
    }

    function positionToast() {
      // A native dialog sits above the page. Keep the same live region visible
      // when a returning player unlocks achievements over the welcome dialog.
      const host = document.activeElement?.closest('dialog[open]') || document.querySelector('dialog[open]') || $('notice-slot');
      if (toast.parentNode !== host) host.appendChild(toast);
    }

    function hideToast() {
      clearTimeout(toastTimer);
      toastTimer = 0;
      toast.classList.remove('is-visible');
      setText($('achievement-toast-text'), '');
      setText($('achievement-toast-icon'), '');
    }

    function notify(ids) {
      const defs = ids.map(id => byId.get(id));
      const single = defs.length === 1;
      const title = single ? 'Achievement unlocked: ' + defs[0].name : defs.length + ' achievements unlocked';
      const icon = single ? defs[0].icon : 'trophy';
      const entry = single ? title : title + ': ' + defs.map(def => def.name).join(', ');
      log(entry, 'good');
      feel.purchase(1);
      positionToast();
      UIIcons.paint($('achievement-toast-icon'), icon);
      setText($('achievement-toast-text'), title);
      toast.classList.add('is-visible');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(hideToast, 3600);
    }

    function update(st) {
      const s = state();
      const ids = E.newAchievements(s, st);
      if (ids.length) s.achievements.push(...ids);
      const decorChanged = decorStudio.sync(s, ids.length > 0);
      if (ids.length || decorChanged) save();
      if (ids.length) notify(ids);
      showCount(s.achievements.length);
      if (!dialog.open && window.GameShell?.panel !== 'stats') return;
      const now = performance.now();
      if (ids.length || now >= nextPaint) {
        nextPaint = now + 500;
        paintView(s, st);
      }
    }

    function showStatsInSheet() {
      buildViews();
      views[1].setAttribute('aria-labelledby', 'sheet-title');
      $('sheet-stat-values').appendChild(views[1]);
      selectTab(1, false);
    }
    document.addEventListener('game-panel', event => {
      if (!dialog.open && event.detail === 'stats') showStatsInSheet();
    });
    dialog.addEventListener('close', () => {
      if (window.GameShell?.panel === 'stats') showStatsInSheet();
    });
    opener.addEventListener('click', () => {
      if (dialog.open) return;
      buildViews();
      views[1].setAttribute('aria-labelledby', 'stats-tab');
      dialog.appendChild(views[1]);
      dialog.showModal();
      selectTab(0, true);
      if (toastTimer) positionToast();
    });
    $('achievements-close').addEventListener('click', () => dialog.close());
    for (const [index, tab] of tabs.entries()) {
      tab.addEventListener('click', () => selectTab(index, false));
      tab.addEventListener('keydown', event => {
        let target;
        if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = tabs.length - 1;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') target = 1 - index;
        else return;
        event.preventDefault();
        selectTab(target, true);
      });
    }
    document.addEventListener('close', event => {
      if (toast.parentNode === event.target) positionToast();
    }, true);

    function reset() {
      hideToast();
      if (dialog.open) dialog.close();
      displayedCount = -1;
      nextPaint = 0;
      for (const view of views) view.scrollTop = 0;
    }
    return { update, isOpen: () => dialog.open, suspend: hideToast, reset };
  }

  // The offer lives only in this page. The room and the economy can update
  // independently while the button crosses its own clipped layer.
  function createPriorityRequest() {
    const { durationSeconds, returnGraceSeconds } = E.BONUS;
    const track = $('priority-track'), button = $('priority-request'), receipt = $('priority-receipt');
    let grace = returnGraceSeconds, endsAt = 0, flight = null, receiptTimer = 0;

    function withdraw(keepAwayNotice = false) {
      if (!keepAwayNotice) delete state.priorityWasFlying;
      endsAt = 0;
      button.hidden = track.hidden = true;
      button.classList.remove('priority-active');
      flight?.cancel();
      flight = null;
    }
    function spawn(now) {
      if (endsAt || grace > 0 || modalOpen() || E.machineCount(state) === 0) return false;
      endsAt = now + durationSeconds * 1000;
      E.markBonusAppeared(state);
      state.priorityWasFlying = true;
      state.priorityWaitSeconds = E.nextBonusGap(state);
      track.hidden = button.hidden = false;
      button.classList.add('priority-active');
      // The track is one button-width shorter than the room. Percentage transforms
      // remain inside it after a resize. Reduced mode retains the linear travel.
      flight = track.animate([
        { transform: 'translateX(0)', opacity: 1 },
        { transform: 'translateX(94%)', opacity: 1, offset: 0.94 },
        { transform: 'translateX(100%)', opacity: 0 },
      ], { duration: durationSeconds * 1000, easing: 'linear', fill: 'forwards' });
      save(); // Reloading during the flight must not replay the discovery request.
      return true;
    }
    function tick(now, live, gap, allowSpawn) {
      if (!live || modalOpen()) {
        if (endsAt) withdraw(suspended);
        if (!live) grace = returnGraceSeconds;
        return;
      }
      grace = Math.max(0, grace - gap);
      if (E.machineCount(state) === 0) return;
      // The first machine starts the clock. Only eligible live seconds use up a gap.
      const remaining = state.priorityWaitSeconds ?? E.nextBonusGap(state);
      state.priorityWaitSeconds = Math.max(0, remaining - gap);
      if (endsAt && now >= endsAt) {
        withdraw();
        E.missBonus(state);
        save();
      }
      if (allowSpawn && state.priorityWaitSeconds === 0) spawn(now);
    }
    function force() {
      const now = Date.now();
      return liveGap((now - state.lastTick) / 1000) && spawn(now);
    }
    function reset() {
      withdraw();
      grace = returnGraceSeconds;
      clearTimeout(receiptTimer);
      receipt.textContent = '';
    }
    button.addEventListener('click', event => {
      if (!endsAt || modalOpen() || suspended || document.visibilityState !== 'visible') return;
      // Settle time at the old rate and let a late input expire before rolling a reward.
      updateClock(Date.now(), true, false);
      if (!endsAt) return;
      const p = event.detail || event.pointerType ? { x: event.clientX, y: event.clientY } : centerOf(button);
      withdraw();
      const reward = E.claimBonus(state);
      const jackpot = reward.tier === 'jackpot';
      const label = '+' + exactMoney(reward.amount) + (jackpot ? ' JACKPOT!' : ' PRIORITY!');
      feel.priorityReward(p, label, jackpot);
      if (feel.reduced()) {
        receipt.classList.toggle('jackpot', jackpot);
        receipt.textContent = label;
        clearTimeout(receiptTimer);
        receiptTimer = setTimeout(() => { receipt.textContent = ''; }, 1500);
      }
      log('Priority request · ' + label, jackpot ? 'big' : 'good');
      render();
      save();
    });
    return { tick, force, reset };
  }

  function createSettingsPanel(api) {
    const dialog = $('settings-dialog');
    if (!dialog) return;
    const opener = $('settings-btn');
    const output = $('backup-code');
    const input = $('backup-input');
    const file = $('backup-file');
    const confirmation = $('backup-confirmation');
    const exportButton = $('backup-export');
    const previewButton = $('backup-preview');
    const copyReal = $('preview-copy');
    let pending = null;
    let previewOrigin = null;
    let importRevision = 0;
    let exportRevision = 0;

    function clearPreview() {
      importRevision++;
      pending = null;
      confirmation.hidden = true;
      $('backup-import-status').textContent = '';
    }

    function showPreview(candidate, origin) {
      $('backup-summary').textContent = api.preview(candidate);
      pending = candidate;
      previewOrigin = origin;
      confirmation.hidden = false;
      $('backup-cancel').focus();
    }

    if (channel.preview) {
      $('preview-badge').hidden = false;
      copyReal.hidden = false;
      copyReal.addEventListener('click', () => {
        clearPreview();
        try {
          showPreview(channel.readRealSave(localStorage, window.Backup.readSave, Date.now()), copyReal);
        } catch (error) {
          $('backup-import-status').textContent = error.message;
        }
      });
    }

    function refreshSnapshots() {
      if (!dialog.open) return;
      const list = $('snapshot-list');
      list.replaceChildren();
      const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      for (const snapshot of api.snapshots()) {
        const item = make('li');
        const detail = make('div');
        detail.append(make('strong', null, date.format(snapshot.at)), make('span', null, api.preview(snapshot.state)));
        const button = make('button', 'btn snapshot-restore', 'Restore');
        button.type = 'button';
        button.setAttribute('aria-label', 'Restore snapshot from ' + date.format(snapshot.at));
        button.addEventListener('click', () => {
          clearPreview();
          showPreview(snapshot.state, button);
        });
        item.append(detail, button);
        list.appendChild(item);
      }
      $('backup-previous').hidden = !api.canUndo();
    }

    opener.addEventListener('click', () => {
      dialog.showModal();
      dialog.querySelector('.settings-sections').scrollTop = 0;
      refreshSnapshots();
      $('settings-close').focus();
    });
    $('settings-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      clearPreview();
      exportRevision++;
      exportButton.disabled = false;
      $('backup-output').hidden = true;
      $('backup-export-status').textContent = '';
      $('feedback-status').textContent = '';
      $('feedback-info').hidden = true;
      output.value = input.value = file.value = '';
    });
    $('settings-version').textContent = 'v' + api.version;
    $('backup-share').hidden = typeof navigator.share !== 'function';
    exportButton.addEventListener('click', async () => {
      const revision = ++exportRevision;
      exportButton.disabled = true;
      $('backup-output').hidden = true;
      $('backup-export-status').textContent = '';
      try {
        const code = await api.exportCode();
        if (revision !== exportRevision) return;
        output.value = code;
        $('backup-output').hidden = false;
        output.focus();
        output.setSelectionRange(0, 0);
        output.scrollTop = 0;
      } catch {
        if (revision === exportRevision) $('backup-export-status').textContent = 'Could not create a backup. Try exporting again.';
      } finally {
        if (revision === exportRevision) exportButton.disabled = false;
      }
    });

    async function copy(box, status, success) {
      try {
        await navigator.clipboard.writeText(box.value);
        status.textContent = success;
      } catch {
        if (!dialog.open) return;
        box.hidden = false;
        box.focus();
        box.select();
        try {
          if (document.execCommand('copy')) { status.textContent = success; return; }
        } catch { /* Keep the text selected for manual copying. */ }
        status.textContent = 'Text selected. Use your device’s Copy command.';
      }
    }
    $('backup-copy').addEventListener('click', () => copy(output, $('backup-export-status'), 'Backup code copied.'));
    $('backup-share').addEventListener('click', async () => {
      try {
        await navigator.share({ title: "Mom, It's a Startup backup", text: output.value });
      } catch (error) {
        if (error.name !== 'AbortError') $('backup-export-status').textContent = 'Sharing is unavailable. Use Copy or Download.';
      }
    });
    $('backup-download').addEventListener('click', () => {
      const now = new Date();
      const day = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
      const download = document.createElement('a');
      const url = URL.createObjectURL(new Blob([output.value], { type: 'text/plain;charset=utf-8' }));
      download.href = url;
      download.download = 'mom-startup-backup-' + day + '.txt';
      dialog.appendChild(download);
      download.click();
      download.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    async function previewImport(selectedFile) {
      clearPreview();
      const revision = importRevision;
      try {
        if (selectedFile) {
          if (selectedFile.size > window.Backup.MAX_CODE_CHARS + 4) throw Error('Large file');
          const code = await selectedFile.text();
          if (revision !== importRevision) return;
          input.value = code;
        }
        const decoded = await api.decode(input.value.trim());
        if (revision === importRevision) showPreview(decoded, selectedFile ? $('backup-pick') : previewButton);
      } catch (error) {
        if (revision === importRevision) {
          $('backup-import-status').textContent = error.message === window.Backup?.NO_GZIP
            ? error.message : "That code doesn't look right. Check you copied all of it.";
        }
      }
    }
    input.addEventListener('input', clearPreview);
    previewButton.addEventListener('click', () => previewImport());
    $('backup-pick').addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const selectedFile = file.files[0];
      file.value = '';
      if (selectedFile) previewImport(selectedFile);
    });
    $('backup-cancel').addEventListener('click', () => {
      clearPreview();
      (previewOrigin?.isConnected ? previewOrigin : previewButton).focus();
    });
    $('backup-replace').addEventListener('click', () => {
      if (!pending) return;
      try { api.replace(pending); }
      catch { $('backup-import-status').textContent = 'Could not store this backup on this device. Your current game is still here.'; }
    });
    $('backup-undo').addEventListener('click', () => {
      try { api.undo(); }
      catch { $('backup-import-status').textContent = 'Could not restore the previous save. Your current game is still here.'; }
    });

    const packageId = 'io.github.les2232.basementdatacenter';
    const appReferrer = 'android-app://' + packageId;
    let fromPlayApp = document.referrer === appReferrer || document.referrer.startsWith(appReferrer + '/');
    // The Android referrer is supplied on launch; a restore reloads this same app tab.
    try {
      const appTabKey = channel.key('basement-datacenter-play-app-tab');
      if (fromPlayApp) sessionStorage.setItem(appTabKey, '1');
      else fromPlayApp = sessionStorage.getItem(appTabKey) === '1';
    } catch { /* Use the launch referrer when session storage is unavailable. */ }
    if (fromPlayApp) {
      const link = $('feedback-store');
      link.href = 'market://details?id=' + packageId;
      link.removeAttribute('target');
    }
    $('feedback-copy').addEventListener('click', () => {
      const box = $('feedback-info');
      box.value = api.gameInfo();
      copy(box, $('feedback-status'), 'Game info copied. Paste it into your feedback.');
    });
    return { refreshSnapshots };
  }

  function loadRewardControls() {
    const script = document.createElement('script');
    script.src = './ads.js';
    script.onload = () => {
      rewardControls = createRewardControls();
      rewardControls.start();
    };
    document.head.appendChild(script);
  }

  function createRewardControls() {
    const panel = $('overtime-panel'), button = $('overtime-watch'), detail = $('overtime-detail');
    const notice = $('overtime-notice'), toggle = $('reward-toggle'), privacy = $('ad-privacy');
    const pref = channel.key('basement-datacenter.show-ad-offers');
    let showOffers = true;
    try { showOffers = localStorage.getItem(pref) !== 'off'; } catch { /* Local preference for this session. */ }
    const { boostSeconds, boostMultiplier } = adConfig.rewards;
    const boostText = `Watch an ad for ${boostMultiplier}× machine income for ${boostSeconds / 60} minutes.`;
    let available = false, selectedNotice;
    let dialogs = [], previousFocus;
    const overlays = new Set();

    // A native modal otherwise sits above Google's iframe and intercepts its input.
    // Save the dialog itself, so an ad never accepts or discards a welcome-back offer.
    function yieldDialogs(source, open) {
      if (open) {
        if (!overlays.size) {
          previousFocus = document.activeElement;
          dialogs = [...document.querySelectorAll('dialog[open]')];
          for (const dialog of dialogs) {
            dialog.addEventListener('close', e => e.stopImmediatePropagation(), { capture: true, once: true });
            dialog.close();
          }
        }
        overlays.add(source);
      } else if (overlays.delete(source) && !overlays.size) {
        for (const dialog of dialogs) if (dialog.isConnected && !dialog.open) dialog.showModal();
        if (dialogs.length && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        dialogs = [];
        previousFocus = null;
      }
    }

    const ads = window.RewardedAds.create(window, adConfig, {
      onOffer(ready) { available = ready; refresh(); },
      onPrivacy(ready) { setHidden(privacy, !ready); },
      onConsentDialog(open) { yieldDialogs('consent', open); },
      onPause() {
        suspend();
        adPlaying = true;
        feel.visibility();
        guidance.syncPlayback();
        yieldDialogs('ad', true);
      },
      onResume() {
        adPlaying = false;
        yieldDialogs('ad', false);
        feel.visibility();
        guidance.syncPlayback();
        resume();
      },
      onUnavailable() {
        if (selectedNotice?.isConnected && showOffers) {
          setText(selectedNotice, 'No ad right now, try later.');
          refresh();
        }
        selectedNotice = null;
      },
    });

    function refresh() {
      const boost = E.overtimeStatus(state);
      const offline = Boolean(away?.rewardReport && E.canDoubleOffline(state, away.rewardReport));
      ads.setEligible(showOffers && (boost.available || offline));
      const active = boost.activeSeconds > 0;
      const ready = showOffers && available && boost.available;
      setHidden(button, !showOffers || (!active && !ready));
      button.disabled = active;
      if (active) {
        setText(button, 'Overtime Boost · ' + E.formatDuration(Math.ceil(boost.activeSeconds)) + ' left');
        setText(detail, `Machines are earning ${boostMultiplier}× income.`);
      } else {
        setText(button, 'Overtime Boost');
        setText(detail, ready ? boostText : boost.cooldownSeconds > 0
          ? 'Overtime Boost returns in ' + E.formatDuration(Math.ceil(boost.cooldownSeconds)) + '.' : '');
      }
      setHidden(panel, !showOffers || (button.hidden && !detail.textContent && !notice.textContent));
      if (away?.watch) {
        const show = showOffers && available && offline;
        setHidden(away.watch, !show);
        setHidden(away.rewardDetail, !show);
        if (show) setText(away.rewardDetail, 'Watch an ad to collect another ' + money(away.rewardReport.earned) + '.');
      }
    }

    function watchReturn() {
      const summary = away, report = summary?.rewardReport, saveAtStart = state;
      if (!showOffers || !available || !report || !E.canDoubleOffline(state, report)) return;
      selectedNotice = summary.rewardReceipt;
      setText(selectedNotice, '');
      ads.show(() => {
        if (state !== saveAtStart) return;
        const bonus = E.doubleOffline(state, report);
        if (bonus > 0) {
          summary.earned += bonus;
          setText(summary.earnedLine, money(summary.earned));
          setText(summary.rewardReceipt, 'Offline earnings doubled. Extra ' + money(bonus) + ' received.');
          log('Doubled the offline payout. Extra ' + money(bonus) + ' received.', 'good');
          save();
        }
        selectedNotice = null;
        refresh();
      });
    }

    button.addEventListener('click', () => {
      if (!showOffers || !available || !E.overtimeStatus(state).available) return;
      const saveAtStart = state;
      selectedNotice = notice;
      setText(notice, '');
      ads.show(() => {
        if (state !== saveAtStart) return;
        // The ad elapsed at the old rate. Start the bonus at its actual completion.
        updateClock(Date.now(), false, false);
        if (E.startOvertime(state)) {
          log(`Overtime started. Machines earn ${boostMultiplier}× for ${boostSeconds / 60} minutes.`, 'good');
          save();
        }
        selectedNotice = null;
        refresh();
      });
    });
    function showPreference() {
      toggle.setAttribute('aria-pressed', String(showOffers));
      setText(toggle, 'Show ad offers: ' + (showOffers ? 'On' : 'Off'));
    }
    toggle.addEventListener('click', () => {
      showOffers = !showOffers;
      try { localStorage.setItem(pref, showOffers ? 'on' : 'off'); } catch { /* The choice still applies here. */ }
      setText(notice, '');
      if (away?.rewardReceipt) setText(away.rewardReceipt, '');
      showPreference();
      refresh();
    });
    privacy.addEventListener('click', () => {
      el.settingsDialog.close();
      ads.managePrivacy();
    });
    setHidden($('reward-settings'), false);
    showPreference();
    return {
      start() { ads.setSound(feel.soundOn()); refresh(); ads.start(); },
      setSound: on => ads.setSound(on), refresh, watchReturn,
    };
  }

  // Presentation only. Actions report what happened after the economy has updated.
  function createFeel() {
    const id = (name) => document.getElementById(name);
    const money = id('money');
    const job = id('job-btn');
    const flow = id('income-flow');
    const streakLabel = id('tap-streak');
    const tapReceipt = id('tap-receipt');
    const streakMeter = id('streak-meter');
    const banner = id('moment-banner');
    const canvas = id('fx-canvas');
    const ctx = canvas.getContext('2d');
    const effectsButton = id('effects-toggle');
    const soundButton = id('sound-toggle');
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const moneyText = window.Economy.formatMoney;
    const rollMs = 300, pulseGapMs = 250, streakMs = 1500, bannerMs = 1500;
    const tapFloat = { baseSize: 18, maxSize: 30, pixelsPerSecondOfIncome: 60, life: 0.65 };
    const saleStars = { count: 24, size: 20, speed: 190, life: .9, gravity: 90, color: '#ffdc83' };
    const saleChime = { notes: [659, 831, 988, 1319], duration: .22, spacing: .075, gain: .11, hapticMs: 32 };
    const particleCap = 150, slowFrameMs = 22, voiceCap = 8, heatToneGapMs = 10000;
    const colors = ['#6be9a8', '#a4efff', '#ffda89', '#eee9ff'];
    const effectsKey = channel.key('basement-datacenter.effects'), soundKey = channel.key('basement-datacenter.sound');
    function read(key, fallback) {
      try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
    }
    function store(key, value) {
      try { localStorage.setItem(key, value); } catch { /* Preferences still work for this session. */ }
    }
    let motionPreference = read(effectsKey, 'full');
    let sound = read(soundKey, 'on') !== 'off';
    const reduced = () => media.matches || motionPreference === 'reduced';
    const hidden = () => adPlaying || document.visibilityState !== 'visible';

    let audio, master, interacted = false;
    const voices = new Map();
    function openAudio() {
      if (!sound || !interacted || hidden()) return;
      try {
        if (!audio) {
          const Audio = window.AudioContext || window.webkitAudioContext;
          if (!Audio) return;
          audio = new Audio();
          master = audio.createGain();
          master.gain.value = 0.25;
          master.connect(audio.destination);
        }
        if (audio.state === 'suspended') audio.resume().catch(() => {});
      } catch { /* A browser may not grant an audio device. */ }
    }
    function unlockAudio(event) {
      if (!event.isTrusted) return;
      if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ' &&
          !(event.target === el.powerSlider && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key))) return;
      interacted = true;
      openAudio();
    }
    document.addEventListener('pointerup', unlockAudio, { capture: true, passive: true });
    el.powerSlider.addEventListener('pointerdown', unlockAudio, { passive: true });
    document.addEventListener('keydown', unlockAudio, { capture: true });
    function silence() {
      for (const [voice, envelope] of voices) {
        voice.onended = null;
        try { voice.stop(); } catch { /* The voice has already ended. */ }
        voice.disconnect(); envelope.disconnect();
      }
      voices.clear();
      if (audio && audio.state === 'running') audio.suspend().catch(() => {});
    }
    // Each oscillator has its own short envelope. Future arpeggio notes also reserve a voice.
    function note(hz, seconds, amplitude, wave = 'sine', delay = 0, endHz = hz) {
      if (!sound || hidden() || !audio || audio.state !== 'running' || voices.size >= voiceCap) return;
      const osc = audio.createOscillator(), envelope = audio.createGain();
      const start = audio.currentTime + delay, end = start + seconds;
      osc.type = wave;
      osc.frequency.setValueAtTime(hz, start);
      osc.frequency.exponentialRampToValueAtTime(endHz, end);
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(amplitude, start + Math.min(0.008, seconds / 4));
      envelope.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(envelope); envelope.connect(master);
      voices.set(osc, envelope);
      osc.onended = () => { voices.delete(osc); osc.disconnect(); envelope.disconnect(); };
      osc.start(start); osc.stop(end + 0.005);
    }
    function vibrate(ms) {
      if (sound && interacted && !hidden() && navigator.vibrate && navigator.userActivation?.hasBeenActive !== false) {
        try { navigator.vibrate(ms); } catch { /* Unsupported or denied. */ }
      }
    }

    // Ask the browser for the visible card bounds after layout. Milestone feedback
    // can arrive mid-shop update, when a synchronous measurement would reflow it.
    const milestoneBounds = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        milestoneBounds.unobserve(entry.target);
        if (hidden() || reduced()) continue;
        const r = entry.intersectionRect;
        const x = r.width && r.height ? r.x + r.width / 2 : window.innerWidth / 2;
        const y = r.width && r.height ? r.y + r.height / 2 : window.innerHeight / 2;
        burst(x, y, 48, true);
      }
    }) : null;
    const motions = new Map();
    const tapBounce = {
      node: job, frames: [{ transform: 'scale(.978, .956)' }, { transform: 'scale(1.007, 1.018)', offset: .55 }, { transform: 'scale(1)' }],
      timing: { duration: 190, easing: 'ease-out' }, animation: null,
    };
    const streakDrain = {
      node: streakMeter, frames: [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }],
      timing: { duration: streakMs, easing: 'linear' }, animation: null,
    };
    function restartTapMotion(effect) {
      if (reduced() || hidden() || !effect.node.animate) return;
      if (!effect.animation) effect.animation = effect.node.animate(effect.frames, effect.timing);
      else {
        effect.animation.currentTime = 0;
        if (effect.animation.playState !== 'running') effect.animation.play();
      }
    }
    function animate(node, frames, options) {
      if (!node || reduced() || hidden() || !node.animate) return;
      motions.get(node)?.cancel();
      const animation = node.animate(frames, options);
      motions.set(node, animation);
      animation.onfinish = () => { if (motions.get(node) === animation) motions.delete(node); };
    }
    function stopMotions() {
      milestoneBounds?.disconnect();
      for (const effect of [tapBounce, streakDrain]) {
        effect.animation?.cancel();
        effect.animation = null;
      }
      for (const animation of motions.values()) animation.cancel();
      motions.clear();
    }

    const particles = [];
    const tileSize = 16, bitTiles = 12, paperAngles = 8;
    const labels = new Map();
    const patchGrid = 48, patchPadding = 12, slowPaintMs = 1000 / 30;
    let atlas, width = 0, height = 0, originX = 0, originY = 0;
    let viewportWidth = 0, viewportHeight = 0, resizeNeeded = true, patchDirty = true;
    let left = 0, top = 0, right = 0, bottom = 0;
    let frameId = 0, lastFrame = 0, slowScore = 0, nextPaint = 0;
    let from = 0, target = null, changeAt = 0, rolling = false, lastPulse = -Infinity;
    let tickBalanceUntil = 0;
    const balanceRecoveryMs = 1800;
    let lastDollar = NaN, lastIncome = NaN;
    let lastTap = -Infinity, streak = 0, lastHeatTone = -Infinity, wasHot = false;
    let moneyVisible = true, lastTapLabel = null, lastSparkles = -Infinity;
    const busyScore = 6, busySparkleGapMs = 240, nearbyTapPx = 32;
    if (typeof IntersectionObserver === 'function') {
      new IntersectionObserver(([entry]) => {
        moneyVisible = entry.isIntersecting;
        if (target !== null) {
          rolling = false;
          if (moneyVisible) paintMoney(target);
        }
      }, { rootMargin: '48px 0px' }).observe(money);
    }
    let bannerTimer = 0, streakTimer = 0;
    streakMeter.style.transformOrigin = 'left center';
    function requestFrame() {
      if (!hidden() && !frameId) frameId = requestAnimationFrame(frame);
    }
    window.addEventListener('resize', () => {
      resizeNeeded = patchDirty = true;
      if (particles.length) { nextPaint = 0; requestFrame(); }
    }, { passive: true });
    function eraseDrawing() {
      if (ctx && right > left && bottom > top) ctx.clearRect(left, top, right - left, bottom - top);
      left = width; top = height; right = bottom = 0;
    }
    function clearCanvas() {
      particles.length = 0;
      lastTapLabel = null;
      eraseDrawing();
      canvas.hidden = true;
      patchDirty = true;
      nextPaint = 0;
    }
    function qualityDivisor() { return slowScore >= 6 ? 4 : slowScore >= 2 ? 2 : 1; }
    function particleRoom() { return Math.floor(particleCap / qualityDivisor()); }

    function addParticle(p) {
      // Save the whole sprite's flight bounds once, including the apex of its arc.
      const endX = p.x + p.vx * p.life;
      const apex = p.gravity ? Math.min(p.life, Math.max(0, -p.vy / p.gravity)) : p.life;
      const yAt = t => p.y + (p.vy + p.gravity * t / 2) * t;
      p.minX = Math.min(p.x, endX) - p.w / 2;
      p.maxX = Math.max(p.x, endX) + p.w / 2;
      p.minY = Math.min(p.y, yAt(apex)) - p.h / 2;
      p.maxY = Math.max(p.y, yAt(p.life)) + p.h / 2;
      particles.push(p);
      patchDirty = true;
    }
    function fitPatch() {
      if (!patchDirty) return;
      patchDirty = false;
      if (resizeNeeded) {
        resizeNeeded = false;
        viewportWidth = window.innerWidth;
        viewportHeight = window.innerHeight;
      }
      let x1 = viewportWidth, y1 = viewportHeight, x2 = 0, y2 = 0;
      for (const p of particles) {
        if (p.maxX <= 0 || p.maxY <= 0 || p.minX >= viewportWidth || p.minY >= viewportHeight) continue;
        x1 = Math.min(x1, p.minX); y1 = Math.min(y1, p.minY);
        x2 = Math.max(x2, p.maxX); y2 = Math.max(y2, p.maxY);
      }
      if (x1 >= x2 || y1 >= y2) { canvas.hidden = true; return; }
      const x = Math.max(0, Math.floor((x1 - patchPadding) / patchGrid) * patchGrid);
      const y = Math.max(0, Math.floor((y1 - patchPadding) / patchGrid) * patchGrid);
      const endX = Math.min(viewportWidth, Math.ceil((x2 + patchPadding) / patchGrid) * patchGrid);
      const endY = Math.min(viewportHeight, Math.ceil((y2 + patchPadding) / patchGrid) * patchGrid);
      const w = endX - x, h = endY - y;
      // A little spare space prevents reallocations as fingertips and random trajectories move.
      // Release a large patch once a simultaneous celebration at a different origin ends.
      const fits = originX <= Math.max(0, x1) && originY <= Math.max(0, y1) &&
        originX + width >= Math.min(viewportWidth, x2) && originY + height >= Math.min(viewportHeight, y2);
      const inside = originX + width <= viewportWidth && originY + height <= viewportHeight;
      if (!fits || !inside || width * height > w * h * 2) {
        eraseDrawing();
        originX = x; originY = y;
        if (width !== w) width = canvas.width = w;
        if (height !== h) height = canvas.height = h;
        canvas.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
      }
      if (canvas.hidden) canvas.hidden = false;
    }

    // Rasterize the bit glyphs and rotating paper shapes once. Every frame uses integer sprite blits.
    function sprites() {
      if (atlas) return atlas;
      atlas = document.createElement('canvas');
      atlas.width = (bitTiles + colors.length * paperAngles) * tileSize;
      atlas.height = tileSize;
      const g = atlas.getContext('2d');
      g.font = 'bold 12px Archivo, sans-serif'; g.textAlign = 'center';
      for (let i = 0; i < bitTiles; i++) {
        g.fillStyle = colors[i % colors.length];
        g.fillText('10$'[i % 3], i * tileSize + tileSize / 2, 12);
      }
      for (let c = 0; c < colors.length; c++) {
        g.fillStyle = colors[c];
        for (let a = 0; a < paperAngles; a++) {
          const tile = bitTiles + c * paperAngles + a;
          g.save();
          g.translate((tile + 0.5) * tileSize, tileSize / 2);
          g.rotate(a * Math.PI / paperAngles);
          g.fillRect(-3, -1.5, 6, 3);
          g.restore();
        }
      }
      return atlas;
    }
    function labelSprite(text, color, size) {
      const key = size + color + text;
      let sprite = labels.get(key);
      if (sprite) return sprite;
      sprite = document.createElement('canvas');
      sprite.width = Math.ceil(text.length * size * 0.67) + 4;
      sprite.height = size + 7;
      const g = sprite.getContext('2d');
      g.font = 'bold ' + size + 'px Archivo, sans-serif'; g.textAlign = 'center'; g.fillStyle = color;
      g.fillText(text, sprite.width / 2, size + 1);
      // Tap values recur. Shop prices vary, so bound the retained label images.
      if (labels.size >= 24) labels.delete(labels.keys().next().value);
      labels.set(key, sprite);
      return sprite;
    }
    function burst(x, y, count, confetti = false) {
      if (!ctx || reduced() || hidden()) return;
      const limit = particleRoom();
      const n = Math.min(limit - particles.length, Math.ceil(count / qualityDivisor()));
      const image = sprites();
      const born = performance.now();
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = confetti ? 65 + Math.random() * 230 : 35 + Math.random() * 90;
        addParticle({ x, y, born, vx: Math.cos(a) * speed, vy: -Math.abs(Math.sin(a)) * speed - 30,
          life: confetti ? 0.75 + Math.random() * 0.55 : 0.38 + Math.random() * 0.27,
          image, w: tileSize, h: tileSize, gravity: confetti ? 260 : 80,
          tile: confetti ? bitTiles + (i % colors.length) * paperAngles : i % bitTiles,
          spin: confetti ? 1 + Math.floor(Math.random() * paperAngles) : 0 });
      }
      requestFrame();
    }
    function floatLabel(x, y, text, color, size = 18, life = tapFloat.life, isTap = false) {
      if (!ctx || reduced() || hidden()) return;
      // When frames fall behind, refresh the amount at the fingertip instead
      // of repainting several overlapping copies of it on every frame.
      if (isTap && slowScore >= busyScore && lastTapLabel &&
          Math.abs(lastTapLabel.x - x) < nearbyTapPx && Math.abs(lastTapLabel.y - y) < nearbyTapPx) {
        const index = particles.indexOf(lastTapLabel);
        if (index !== -1) particles.splice(index, 1);
      }
      if (particles.length >= particleRoom()) particles.shift();
      const image = labelSprite(text, color, size);
      const half = image.width / 2;
      x = Math.max(half, Math.min((viewportWidth || window.innerWidth) - half, x));
      const label = { x, y, vx: 0, vy: -48, born: performance.now(), life,
        image, w: image.width, h: image.height, gravity: 0, tile: 0, spin: 0 };
      addParticle(label);
      if (isTap) lastTapLabel = label;
      requestFrame();
    }
    function drawParticles(now) {
      if (!ctx || !particles.length) return;
      fitPatch();
      eraseDrawing();
      for (let i = particles.length - 1; i >= 0; --i) {
        const p = particles[i];
        const age = Math.max(0, now - p.born) / 1000;
        if (age >= p.life) { particles.splice(i, 1); patchDirty = true; continue; }
        if (canvas.hidden) continue;
        const x = Math.round(p.x + p.vx * age - originX - p.w / 2);
        const y = Math.round(p.y + (p.vy + p.gravity * age / 2) * age - originY - p.h / 2);
        if (x >= width || y >= height || x + p.w <= 0 || y + p.h <= 0) continue;
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x + p.w); bottom = Math.max(bottom, y + p.h);
        ctx.globalAlpha = Math.min(1, (p.life - age) / (p.life * 0.45));
        const tile = p.tile + (p.spin ? (p.spin + Math.floor(age * 15)) % paperAngles : 0);
        ctx.drawImage(p.image, tile * tileSize, 0, p.w, p.h, x, y, p.w, p.h);
      }
      ctx.globalAlpha = 1;
      if (!particles.length) { canvas.hidden = true; nextPaint = 0; }
    }
    function moneyAt(now) {
      const progress = Math.min(1, Math.max(0, (now - changeAt) / rollMs));
      return progress === 1 ? target : target + (from - target) * (1 - progress) ** 3;
    }
    function paintMoney(value) {
      const dollar = Math.floor(value);
      if (lastDollar === dollar) return;
      lastDollar = dollar;
      const text = moneyText(value);
      setText(money, text);
    }
    function frame(now) {
      frameId = 0;
      if (hidden()) return;
      const elapsed = lastFrame ? now - lastFrame : 0;
      if (lastFrame) slowScore = Math.max(0, Math.min(12, slowScore + (elapsed > slowFrameMs ? 2 : -0.25)));
      lastFrame = now;
      if (elapsed > slowFrameMs && slowScore >= busyScore) tickBalanceUntil = now + balanceRecoveryMs;
      if (particles.length > particleRoom()) {
        particles.splice(0, particles.length - particleRoom()); patchDirty = true;
      }
      if (particles.length && (slowScore < 3 || now + 1 >= nextPaint)) {
        // A missed draw never slows down the flight or the balance animation. Keep a stable
        // 30Hz cadence on a busy device; draw on every animation frame when it keeps up.
        nextPaint = slowScore < 3 || !nextPaint || now - nextPaint >= slowPaintMs
          ? now + slowPaintMs : nextPaint + slowPaintMs;
        drawParticles(now);
      }
      if (rolling) {
        rolling = now >= tickBalanceUntil && now - changeAt < rollMs;
        paintMoney(rolling ? moneyAt(now) : target);
      }
      if (particles.length || rolling) requestFrame();
      else lastFrame = 0;
    }
    function updateMoney(value, income) {
      const now = performance.now();
      if (target === null || hidden() || !moneyVisible) {
        from = target = value;
        rolling = false;
        if (moneyVisible) paintMoney(value);
      } else if (target !== value) {
        const previous = target;
        from = rolling ? moneyAt(now) : target;
        target = value; changeAt = now;
        // When frames fall behind, show the exact balance with each game update.
        // Resume interpolation once the device has had time to catch up.
        rolling = now >= tickBalanceUntil;
        if (!rolling) paintMoney(value);
        if (value > previous && value - previous >= previous * 0.1 && now - lastPulse >= pulseGapMs) {
          lastPulse = now;
          animate(money, [{ transform: 'scale(1)' }, { transform: 'scale(1.055)', offset: 0.35 },
            { transform: 'scale(1)' }], { duration: 215, easing: 'ease-out' });
        }
        if (rolling || particles.length) requestFrame();
      }
      if (lastIncome !== income) {
        lastIncome = income;
        const period = (2.4 / (1 + Math.log10(1 + income) * 0.65)).toFixed(2) + 's';
        flow.style.setProperty('--flow-period', period);
        flow.classList.toggle('flowing', income > 0);
      }
    }
    function clearStreak() {
      clearTimeout(streakTimer);
      streak = 0; lastTap = -Infinity;
      job.classList.remove('has-streak');
      streakLabel.textContent = '';
      if (tapReceipt) tapReceipt.textContent = '';
    }
    function tap(x, y, amount, income) {
      if (hidden()) return;
      const now = performance.now();
      streak = now - lastTap < streakMs ? streak + 1 : 1;
      lastTap = now;
      if (streak > 1) {
        job.classList.add('has-streak');
        setText(streakLabel, '×' + streak + ' streak!');
        restartTapMotion(streakDrain);
      }
      clearTimeout(streakTimer);
      streakTimer = setTimeout(clearStreak, streakMs);
      restartTapMotion(tapBounce);
      const paid = '+' + moneyText(amount);
      if (reduced()) {
        if (tapReceipt) setText(tapReceipt, 'Earned ' + paid);
      } else {
        const seconds = income > 0 ? amount / income : 0;
        const size = Math.min(tapFloat.maxSize, tapFloat.baseSize + Math.round(seconds * tapFloat.pixelsPerSecondOfIncome));
        floatLabel(x, y - 6, paid, '#c3ffdb', size, tapFloat.life, true);
      }
      if (slowScore < busyScore || now - lastSparkles >= busySparkleGapMs) {
        burst(x, y, 8);
        lastSparkles = now;
      }
      const pitch = 580 + Math.min(streak, 20) * 9 + Math.random() * 42;
      note(pitch, 0.045, 0.12, 'triangle', 0, pitch * 0.64);
      requestFrame();
    }
    function center(node) {
      const r = node.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    function staffReceipt(fadeOut) {
      const frames = fadeOut ? [{ opacity: 1 }, { opacity: 0 }] :
        [{ transform: 'translateY(3px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }];
      animate(el.sysadminReceipt, frames, { duration: STAFF_RECEIPT_FADE_MS, easing: 'ease-out' });
    }
    function spend(card, amount, willDisappear) {
      if (reduced() || hidden()) return;
      const bounds = card.getBoundingClientRect();
      floatLabel(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2,
        '−' + moneyText(amount, 'ceil'), '#ffb69b');
      // Installing an upgrade removes its real button on this render. Let its image
      // finish the same purchase feedback without holding space or intercepting a tap.
      let surface = card;
      if (willDisappear) {
        surface = card.cloneNode(true);
        surface.classList.add('installed-card-pop');
        surface.inert = true;
        surface.setAttribute('aria-hidden', 'true');
        Object.assign(surface.style, { left: bounds.left + 'px', top: bounds.top + 'px',
          width: bounds.width + 'px', height: bounds.height + 'px' });
        document.body.appendChild(surface);
        setTimeout(() => surface.remove(), 215);
      }
      animate(surface, [{ transform: 'scale(.987)' }, { transform: 'scale(1.012)', offset: 0.45 },
        { transform: 'scale(1)' }], { duration: 215, easing: 'ease-out' });
    }
    function purchase(count) {
      note(659, 0.11, 0.13, 'sine');
      note(count > 1 ? 1046 : 880, count > 1 ? 0.21 : 0.13, 0.095, 'sine', 0.054);
      vibrate(8);
    }
    function fireAlarm() {
      note(520, .18, .10, 'triangle');
      note(730, .22, .10, 'triangle', .21);
      vibrate([24, 100, 24]);
    }
    function fireCrash() {
      note(168, .44, .17, 'sawtooth', 0, 40);
      note(310, .16, .12, 'triangle', .055, 70);
      note(95, .36, .13, 'sine', .13, 34);
      vibrate([36, 60, 55]);
    }
    const powerDetent = { hz: 540, endHz: 360, duration: 0.035, gain: 0.065, hapticMs: 5 };
    function powerTick() {
      note(powerDetent.hz, powerDetent.duration, powerDetent.gain, 'triangle', 0, powerDetent.endHz);
      vibrate(powerDetent.hapticMs);
    }
    function goalReward(point, label) {
      purchase(1);
      floatLabel(point.x, point.y, label, '#b0ffe2');
    }
    function priorityReward(point, label, jackpot) {
      burst(point.x, point.y, jackpot ? 72 : 24, jackpot);
      floatLabel(point.x, point.y - 12, label, jackpot ? '#ffdd79' : '#b0ffe2', jackpot ? 23 : 18, 1.35);
      if (jackpot) {
        [523, 659, 784, 1046, 1568].forEach((hz, i) => note(hz, .21, .12, 'triangle', i * .07));
      } else {
        note(784, .12, .12); note(1175, .18, .10, 'sine', .07);
      }
      vibrate(jackpot ? 35 : 16);
    }
    const runBannerMs = 3400;
    function showMoment(text, bigger, sale = false, detail = '') {
      if (hidden()) return;
      clearTimeout(bannerTimer);
      banner.textContent = text;
      if (detail) banner.appendChild(make('span', 'run-start-detail', detail));
      const duration = detail ? runBannerMs : bannerMs;
      banner.classList.toggle('move-moment', bigger);
      banner.classList.toggle('sale-moment', sale);
      banner.classList.add('moment-visible');
      animate(banner, [
        { opacity: 0, transform: 'translate(-50%, calc(-50% + 12px)) scale(.98)' },
        { opacity: 1, transform: 'translate(-50%, -50%)', offset: 0.14 },
        { opacity: 1, transform: 'translate(-50%, -50%)', offset: 0.82 },
        { opacity: 0, transform: 'translate(-50%, calc(-50% - 7px))', offset: 1 },
      ], { duration, easing: 'ease-out' });
      bannerTimer = setTimeout(() => banner.classList.remove('moment-visible'), duration);
    }
    function beginRun(number, detail) { showMoment(`Run ${number} begins`, false, true, detail); }
    function challengeComplete(challenge) {
      showMoment(`${challenge.name} complete!`, false, true, challenge.reward);
      celebrateSale($('board-completion'));
    }
    function shake() {
      const layout = document.querySelector('.layout');
      animate(layout, [{ transform: 'translateY(0)' }, { transform: 'translateY(-3px)' },
        { transform: 'translateY(2px)' }, { transform: 'translateY(-1px)' }, { transform: 'translateY(0)' }],
      { duration: 155, easing: 'ease-out' });
    }
    const machineLabels = { 'Old Laptop': 'LAPTOPS', 'Desktop Tower': 'TOWERS', 'Rack Server': 'RACK SERVERS', 'GPU Rig': 'GPU RIGS', 'AI Training Cluster': 'AI TRAINING CLUSTERS', 'Quantum Mainframe': 'QUANTUM MAINFRAMES', 'Exascale Array': 'EXASCALE ARRAYS' };
    function milestone(card, machineName, multiplier) {
      if (!reduced() && !hidden()) {
        if (milestoneBounds) milestoneBounds.observe(card);
        else burst(window.innerWidth / 2, window.innerHeight / 2, 48, true);
      }
      showMoment('' + (machineLabels[machineName] || machineName.toUpperCase()) + ' ' + multiplier.toLocaleString('en-US') + '×!', false);
      shake();
      [523, 659, 784, 1046].forEach((hz, i) => note(hz, 0.15, 0.12, 'triangle', i * 0.062));
      vibrate(26);
    }
    function move(message) {
      burst(window.innerWidth * 0.5, window.innerHeight * 0.55, 88, true);
      showMoment(message, true);
      shake();
      [523, 659, 784, 1046, 1319].forEach((hz, i) => note(hz, 0.21, 0.105, 'triangle', i * 0.073));
    }
    function resetRun() {
      clearCanvas(); clearStreak(); stopMotions();
      clearTimeout(bannerTimer);
      banner.classList.remove('moment-visible', 'sale-moment');
      target = null;
    }
    function celebrateSale(anchor) {
      if (ctx && !reduced() && !hidden()) {
        const { x, y } = center(anchor);
        const { count, size, speed, gravity, life, color } = saleStars;
        const image = labelSprite('+', color, size);
        const born = performance.now();
        for (let i = 0; i < count; i++) {
          const angle = Math.PI * 2 * i / count;
          const velocity = speed * (.6 + .4 * Math.random());
          addParticle({ x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, gravity,
            life, born, image, w: image.width, h: image.height, tile: 0, spin: 0 });
        }
        requestFrame();
      }
      saleChime.notes.forEach((hz, i) => note(hz, saleChime.duration, saleChime.gain, 'sine', i * saleChime.spacing));
      vibrate(saleChime.hapticMs);
    }
    function decorUnlock() {
      note(587, .10, .055, 'sine'); note(880, .14, .05, 'sine', .09);
      vibrate(9);
    }
    function incident() {
      note(466, 0.085, 0.1, 'sine'); note(622, 0.14, 0.095, 'sine', 0.105);
      vibrate(18);
    }
    function heat(throttled) {
      const now = performance.now();
      if (throttled && !wasHot && now - lastHeatTone >= heatToneGapMs) {
        note(139, 0.20, 0.15, 'triangle', 0, 96);
        lastHeatTone = now;
      }
      wasHot = throttled;
    }
    function syncPrefs() {
      const reducedMotion = reduced();
      if (tapReceipt) tapReceipt.textContent = '';
      document.body.classList.toggle('effects-reduced', reducedMotion);
      effectsButton.textContent = 'Effects: ' + (reducedMotion ? 'Reduced' : 'Full');
      effectsButton.setAttribute('aria-pressed', String(reducedMotion));
      effectsButton.setAttribute('aria-label', media.matches ? 'Reduced effects follow your device motion setting' : 'Reduced visual effects');
      effectsButton.disabled = media.matches;
      soundButton.textContent = $('settings-dialog') ? 'Sound and haptics: ' + (sound ? 'On' : 'Off') : (sound ? 'Sound on' : 'Sound off');
      soundButton.setAttribute('aria-label', 'Sound and haptics');
      soundButton.setAttribute('aria-pressed', String(sound));
      if (reducedMotion) {
        clearCanvas(); stopMotions();
        setHidden(el.fireFlash, true);
        el.room.classList.remove('fire-flare');
      }
    }
    function toggleEffects() {
      if (media.matches) return;
      motionPreference = reduced() ? 'full' : 'reduced';
      store(effectsKey, motionPreference); syncPrefs();
    }
    function toggleSound() {
      sound = !sound;
      store(soundKey, sound ? 'on' : 'off'); syncPrefs();
      if (sound) openAudio(); else silence();
      rewardControls?.setSound(sound);
    }
    function visibility() {
      document.body.classList.toggle('effects-paused', hidden());
      if (hidden()) {
        if (frameId) cancelAnimationFrame(frameId);
        frameId = 0; lastFrame = 0; slowScore = 0; rolling = false;
        if (target !== null) paintMoney(target);
        clearStreak(); clearCanvas(); stopMotions(); silence();
        clearTimeout(bannerTimer); banner.classList.remove('moment-visible');
      } else if (audio && sound && interacted) openAudio();
    }
    effectsButton.addEventListener('click', toggleEffects);
    soundButton.addEventListener('click', toggleSound);
    if (media.addEventListener) media.addEventListener('change', syncPrefs);
    else media.addListener(syncPrefs);
    clearCanvas(); syncPrefs(); visibility();
    // Repaint the balance on the next update (e.g. after the number style changes).
    const refreshMoneyText = () => { target = null; };
    return { reduced, soundOn: () => sound, updateMoney, refreshMoneyText, tap, spend, purchase, staffReceipt, powerTick, fireAlarm, fireCrash, goalReward, priorityReward, milestone, move, showMoment, celebrateSale, challengeComplete, beginRun, resetRun, decorUnlock, incident, heat, visibility, toggleEffects, toggleSound, syncPrefs };
  }

  function createNewsAndTips() {
    const ticker = $('news-ticker'), headline = $('news-headline'), clip = headline.parentElement;
    const bubble = $('first-tip'), tipText = $('first-tip-text'), announce = $('tip-announcement');
    const recent = [], queue = new Map();
    const historyKey = channel.key('basement-datacenter.news-history');
    try {
      const previous = JSON.parse(localStorage.getItem(historyKey));
      if (Array.isArray(previous)) recent.push(...previous.filter(id => E.HEADLINES.some(h => h.id === id)).slice(-E.NEWS.historySize));
    } catch { /* A missing history starts a new edition. */ }
    const tipCheckMs = 300, inset = 8;
    let running = null, animation, tickerWidth = 0, mode = '', pauseUntil = 0;
    let lastMilestone = -Infinity, lastSale = -Infinity, runs = 0, nextCheck = 0;
    let lastFire = -Infinity, lastPayout = -Infinity;
    let current = null, anchor = null, tipTimer = 0, layoutFrame = 0;
    const tab = kind => shopTabs.get(kind)?.button;

    function preference(id, name, onChange) {
      const button = $(id + '-toggle'), storageKey = channel.key('basement-datacenter.' + id);
      let enabled = true;
      try { enabled = localStorage.getItem(storageKey) !== 'off'; } catch { /* The control works in memory. */ }
      function paint() {
        setText(button, name + (enabled ? ' on' : ' off'));
        button.setAttribute('aria-pressed', String(enabled));
      }
      button.addEventListener('click', () => {
        enabled = !enabled;
        try { localStorage.setItem(storageKey, enabled ? 'on' : 'off'); } catch { /* Keep this session's setting. */ }
        paint(); onChange(enabled);
      });
      paint();
      return () => enabled;
    }
    const tickerOn = preference('ticker', 'Ticker', enabled => {
      ticker.hidden = !enabled;
      if (enabled) rotate(); else { animation?.cancel(); animation = null; }
    });
    const tipsOn = preference('tips', 'Tips', enabled => {
      if (!enabled) { hideTip(); queue.clear(); } else update(lastStats, true);
      nextStepKey = undefined; // Show or hide the Next step line without announcing it.
      renderNextStep();
    });

    function playHeadline() {
      if (!running || !tickerOn()) return;
      animation?.cancel();
      mode = feel.reduced() ? 'fade' : 'scroll';
      ticker.dataset.mode = mode;
      tickerWidth = clip.clientWidth;
      headline.style.fontSize = '';
      const width = headline.offsetWidth;
      if (mode === 'fade') {
        if (width > tickerWidth && tickerWidth) headline.style.fontSize = (13 * tickerWidth / width) + 'px';
        animation = headline.animate([{ opacity: 0 }, { opacity: 1, offset: .04 },
          { opacity: 1, offset: .96 }, { opacity: 0 }], E.NEWS.reducedMs);
      } else {
        const start = Math.max(0, (tickerWidth - width) / 2);
        const travelMs = (start + width) / E.NEWS.pixelsPerSecond * 1000;
        const duration = E.NEWS.holdMs + travelMs;
        const from = `translateX(${start}px)`;
        animation = headline.animate([{ transform: from }, { transform: from, offset: E.NEWS.holdMs / duration },
          { transform: `translateX(-${width}px)` }], duration);
      }
      animation.onfinish = rotate;
      syncPlayback();
    }
    function rotate() {
      if (!state || !tickerOn()) return;
      const now = performance.now();
      running = E.pickHeadline(state, recent, { hour: new Date().getHours(), throttled: (lastStats?.throttle ?? 1) < 1,
        milestone: now - lastMilestone < E.NEWS.recentEventMs, afterSale: now - lastSale < E.NEWS.recentEventMs,
        afterFire: now - lastFire < E.NEWS.recentEventMs, afterPayout: now - lastPayout < E.NEWS.recentEventMs }, Math.random());
      recent.push(running.id);
      if (recent.length > E.NEWS.historySize) recent.shift();
      try { localStorage.setItem(historyKey, JSON.stringify(recent)); } catch { /* Keep the last ten in this session. */ }
      setText(headline, running.text);
      playHeadline();
    }
    function syncPlayback() {
      const paused = performance.now() < pauseUntil;
      if (ticker.dataset.paused !== String(paused)) ticker.dataset.paused = String(paused);
      if (!animation) return;
      if (paused || document.hidden || adPlaying) {
        if (animation.playState === 'running') animation.pause();
      } else if (animation.playState === 'paused') animation.play();
    }
    ticker.addEventListener('click', () => { pauseUntil = performance.now() + E.NEWS.pauseMs; syncPlayback(); });
    document.addEventListener('visibilitychange', syncPlayback);
    if (typeof ResizeObserver === 'function') new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      if (width > 0 && width !== tickerWidth) playHeadline();
    }).observe(clip);

    function hideTip() {
      clearTimeout(tipTimer);
      bubble.hidden = true;
      current = anchor = null;
      announce.textContent = '';
      if (el.perkDialog.contains(bubble)) $('notice-slot').append(bubble, announce);
    }
    function onScreen(node) {
      if (!node?.isConnected) return null;
      const r = node.getBoundingClientRect();
      return r.width && r.height && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0 ? r : null;
    }
    const tipVisibility = new Map();
    const tipObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      for (const entry of entries) tipVisibility.set(entry.target, entry.isIntersecting && entry.intersectionRatio > 0);
    }) : null;
    function canShowTipAt(node) {
      if (!node?.isConnected) return false;
      if (!tipObserver) return !!onScreen(node);
      if (!tipVisibility.has(node)) {
        tipVisibility.set(node, false);
        tipObserver.observe(node);
      }
      return tipVisibility.get(node);
    }
    function place() {
      if (current && !onScreen(anchor)) hideTip();
    }
    function positionSoon() {
      if (!current || layoutFrame) return;
      layoutFrame = requestAnimationFrame(() => { layoutFrame = 0; place(); });
    }
    window.addEventListener('scroll', positionSoon, { capture: true, passive: true });
    window.addEventListener('resize', positionSoon);
    bubble.addEventListener('click', hideTip);
    const targets = {
      decor: () => $('decorate-btn'),
      smoke: () => $('fire-risk'),
      perk: () => $('perk-title'), priority: () => $('priority-track'), incident: () => el.incident,
      heat: () => el.heatText, power: () => el.powerControl, move: () => el.moveBtn, expand: () => el.moveBtn, sale: () => el.sellBtn, mall: () => el.roomTitle,
      dam: () => $('heat-chip'), volcano: () => $('heat-chip'), orbital: () => $('heat-chip'),
      bunker: () => el.fireproofBadge, penthouse: () => el.tapMultiplier,
      cluster: () => activeShopTab === 'machine' ? document.querySelector('.card[data-item="cluster"]') : tab('machine'),
      mainframe: () => activeShopTab === 'machine' ? document.querySelector('.card[data-item="mainframe"]') : tab('machine'),
      manager: () => activeShopTab === 'staff' ? $('staff-manager') : tab('staff'),
      board: () => !$('board-btn').hidden ? $('board-btn') : $('stats-board-btn'),
      staff: () => tab('staff'), bulk: () => quantityControl.querySelector('[value="10"]').parentElement,
      best: () => revealedCards.find(c => c.kind === activeShopTab && !c.best.hidden && (!adviceObserver || c.inView))?.el,
    };

    function update(st, immediate = false) {
      const now = performance.now();
      if (!immediate && now < nextCheck) return;
      nextCheck = now + tipCheckMs;
      if (runs < state.runs) lastSale = now;
      runs = state.runs;
      if (tickerOn()) {
        if (mode !== (feel.reduced() ? 'fade' : 'scroll')) playHeadline();
        syncPlayback();
      }
      if (!tipsOn() || document.hidden) return;
      const covered = nextStepTip();
      if (covered) {
        if (current?.id === covered) hideTip();
        queue.delete(covered);
        state.flags['tip:' + covered] = true;
      }
      const view = { throttled: st?.throttle < 1, powerUnlocked: !el.powerControl.hidden, priority: !$('priority-request').hidden,
        best: !state.flags['tip:best'] && !!targets.best() };
      for (const tip of E.pendingTips(state, view, queue)) queue.set(tip.id, tip);
      for (const id of queue.keys()) if (state.flags['tip:' + id]) queue.delete(id);
      if (!current && !queue.size) return;
      const dialog = document.querySelector('dialog[open]');
      const goalsOpen = $('goals-toggle')?.getAttribute('aria-expanded') === 'true';
      const urgent = !dialog && !goalsOpen && queue.has('smoke') && state.fireRisk >= E.FIRE.smokeRisk && canShowTipAt(targets.smoke());
      if (urgent && current && current.id !== 'smoke') hideTip();
      if (current && (goalsOpen || (dialog && !dialog.contains(bubble)) ||
          current.id === 'perk' && !el.perkDialog.open || !canShowTipAt(anchor))) hideTip();
      if (current || goalsOpen) return;
      for (const [id, tip] of urgent ? [['smoke', queue.get('smoke')]] : queue) {
        if (id === 'smoke' && state.fireRisk < E.FIRE.smokeRisk) { queue.delete(id); continue; }
        if (id === 'perk' && !state.perkChoicePending || id === 'priority' && !view.priority ||
            id === 'incident' && !state.event || (id === 'move' || id === 'expand') && !E.canMove(state) || id === 'sale' && !E.canSell(state)) {
          queue.delete(id);
          continue;
        }
        if (dialog && (id !== 'perk' || dialog !== el.perkDialog)) continue;
        const node = targets[id]();
        if (!canShowTipAt(node)) continue;
        if (dialog) dialog.append(bubble, announce);
        anchor = node; current = tip;
        queue.delete(id);
        state.flags['tip:' + id] = true;
        setText(tipText, tip.text);
        bubble.setAttribute('aria-label', tip.text + ' Dismiss tip.');
        bubble.dataset.tip = id;
        bubble.hidden = false;
        positionSoon();
        announce.textContent = tip.text;
        tipTimer = setTimeout(hideTip, E.TIP_VISIBLE_MS);
        save();
        break;
      }
    }

    function initialize(saved) {
      if (!state.flags['tips:initialized']) {
        if (saved) Object.assign(state.flags, E.legacyTipFlags(state));
        state.flags['tips:initialized'] = true;
      }
      runs = state.runs;
      ticker.hidden = !tickerOn();
      if (tickerOn()) rotate();
    }
    return { initialize, update, syncPlayback, tipsEnabled: tipsOn, milestone: () => { lastMilestone = performance.now(); },
      burn(payout) {
        lastFire = performance.now();
        if (payout > 0) lastPayout = lastFire;
        if (current?.id === 'smoke') hideTip();
        queue.delete('smoke');
      },
      reset() {
        hideTip(); queue.clear();
        tipObserver?.disconnect(); tipVisibility.clear();
        lastMilestone = lastFire = lastPayout = -Infinity;
        if (!state.runs) lastSale = -Infinity;
        state.flags['tips:initialized'] = true;
      } };
  }

  const feel = createFeel();
  const guidance = createNewsAndTips();
  const priority = createPriorityRequest();
  const decorStudio = createDecorationStudio();
  const achievementPanel = createAchievementPanel({ state: () => state, feel, log, save });
  const backups = createSaveBackups(window.Backup);
  const settingsPanel = el.settingsDialog ? createSettingsPanel(backups) : null;
  window.addEventListener('storage', event => {
    if (event.key === SAVE_KEY) backups.changedInAnotherTab();
  });
  start();
  if (rewardedEnabled) loadRewardControls();
  if (!channel.preview && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    // Chrome blocks manifest fetches for file:// copies of the game.
    const manifest = document.querySelector('link[rel="manifest"]');
    manifest.href = manifest.dataset.href;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // The game can still run online if the browser disables offline storage.
      });
    }
  }
})();
