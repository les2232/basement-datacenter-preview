/*
 * Mom, It's a Startup: economy rules.
 *
 * This file is pure game logic: no buttons, no screen, no saving to disk.
 * That keeps the math in one place and lets us test it automatically in Node
 * (see tests/ and tools/simulate.js). The page loads it as window.Economy.
 *
 * Every number we expect to tune during playtesting lives in the tables
 * directly below. Change a value, reload the page, play.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Tunable numbers (starting assumptions: adjust these through playtesting)
  // ---------------------------------------------------------------------------

  const adConfig = typeof module !== 'undefined' && module.exports ? require('./ads-config.js') : root.ADS;
  // A tab upgrading its offline cache can still have an older page that never
  // loaded the config. Ordinary production must start even then.
  const REWARDS = adConfig?.rewards ?? {
    boostMultiplier: 1, boostSeconds: 0, cooldownSeconds: 0,
    offlineMinSeconds: Infinity, offlineMultiplier: 1, achievementBoosts: 0,
  };
  const overtimeCycleSeconds = REWARDS.boostSeconds + REWARDS.cooldownSeconds;

  const CONFIG = {
    clickValue: 1,                    // base pay for a job, before adding the machine-income share
    jobIncomeShare: 0.10,             // fraction of one second of actual machine income paid per hand tap
    siblingIncomeShare: 0.02,         // fraction paid per automated job
    tapBoostWindowMs: 3000,           // measure recent hand earnings over this much live time
    baseCooling: 5,                   // the basement is cold; this much cooling is free
    moveGoal: 1_000_000,                 // lifetime $ needed to unlock the move-out choice
    offlineCapSeconds: 2 * 60 * 60,   // base cap, before offline-power upgrades
    sysadminSpendShare: 0.5,          // fraction of cash the sysadmin may spend on a single cooler
    revealFraction: 0.5,              // an item appears once lifetime earnings reach half its base price
    maxBulkBuy: 1000,                 // safety limit for "Max" purchases

    // Incidents: short events that ask for a quick decision while you're playing.
    firstEventSeconds: 90,            // seconds of play before the first incident
    eventGapMinSeconds: 90,           // cooldown in seconds of live play after an incident
    eventGapMaxSeconds: 180,
    eventOfferSeconds: 20,            // time to answer an offer
    eventLiveGapSeconds: 1.5,         // slower frames are accounted as time away
    eventReturnGraceSeconds: 60,      // minimum time before a new offer after returning
    eventMinMachines: 1,              // keep offers out of the opening tutorial
  };

  // Each threshold multiplies the income of all machines of that type, including earlier purchases.
  const MILESTONES = [
    { count: 10, mult: 2 },
    { count: 25, mult: 2 },
    { count: 50, mult: 2 },
    { count: 100, mult: 2 },
  ];

  const POWER = { min: 0.5, max: 1.25, step: 0.05, normal: 1, heatExponent: 1.5, achievementSeconds: 60 };
  const FIRE = { dangerLoad: 1.6, extremeLoad: 2.5, dangerSeconds: 45, extremeSeconds: 20,
    smokeRisk: 0.3, alarmRisk: 0.7, alarmSeconds: 15, decaySeconds: 20, graceSeconds: 10,
    charredUntil: 10, rebuildTarget: 50, insurancePrice: 5000, refundFraction: 0.5 };
  const PRESTIGE = { bonusPerStar: 0.10, divisor: 1e6, unlockLifetime: 1e7 };
  const MANAGER = { minStars: 12, price: 1500, budgets: [25, 50, 75, 100], defaultBudget: 50, intervalMs: 500 };
  const BOARD_STARS = 24;
  const BOARD_RULES = { domeCooling: 0.44, coolingReward: 1.10, basePayReward: 1.10, bootstrappedInvestorShare: 0.70,
    handsIncome: 0.5, handPayReward: 1.15, shortagePrice: 2, machinePriceReward: 0.95 };
  const percent = fraction => Math.round(fraction * 100);
  const CHALLENGES = [
    { id: 'heat-dome', name: 'Heat Dome', icon: 'heat', desc: 'The board rented a greenhouse. The servers are not tomatoes.',
      get twist() { return `Cooling capacity falls by ${percent(1 - BOARD_RULES.domeCooling)}% this run.`; },
      get reward() { return `+${percent(BOARD_RULES.coolingReward - 1)}% cooling forever.`; },
      effect: { get coolingMult() { return BOARD_RULES.domeCooling; } },
      permanent: { get coolingMult() { return BOARD_RULES.coolingReward; } } },
    { id: 'bootstrapped', name: 'Bootstrapped', icon: 'wallet', desc: 'The investors want to see how you managed before they showed up.',
      get twist() { return `Start empty and hire no staff this run. Your investor bonus counts at ${percent(BOARD_RULES.bootstrappedInvestorShare)}% this run.`; },
      get reward() { return `+${percent(BOARD_RULES.basePayReward - 1)}% base job pay forever.`; },
      permanent: { get clickMult() { return BOARD_RULES.basePayReward; } } },
    { id: 'hands-only', name: 'Hands Only', icon: 'tap', desc: 'Someone promised the board a more hands-on management style.',
      get twist() { return `Machines earn ${percent(1 - BOARD_RULES.handsIncome)}% less this run.`; },
      get reward() { return `+${percent(BOARD_RULES.handPayReward - 1)}% hand tap pay forever.`; },
      effect: { get incomeMult() { return BOARD_RULES.handsIncome; } },
      permanent: { get handPayMult() { return BOARD_RULES.handPayReward; } } },
    { id: 'supply-shortage', name: 'Supply Shortage', icon: 'move', desc: 'Your usual parts supplier is on back order. So is the backup.',
      get twist() { return `Machines and coolers cost ${BOARD_RULES.shortagePrice}× this run.`; },
      get reward() { return `Machines cost ${percent(1 - BOARD_RULES.machinePriceReward)}% less forever.`; } },
  ];
  const CHALLENGE_BY_ID = new Map(CHALLENGES.map(challenge => [challenge.id, challenge]));
  const GOALS = {
    slots: 3, swapSeconds: 600, minSizingSeconds: 120, sizingSeconds: 240, maxSizingSeconds: 360,
    sizingClicksPerSecond: 1, minimumEarnings: 2500, handJobs: 200,
    heatMin: 0.8, heatMax: 1, heatSeconds: 60, closeToMove: 0.75,
    firstBadge: 10, secondBadge: 100,
  };
  const GOAL_TEMPLATES = {
    machine: { rewardSeconds: 5 }, earnings: { rewardSeconds: 4 }, priority: { rewardSeconds: 45 },
    jobs: { rewardSeconds: 4 }, upgrade: { rewardSeconds: 12 }, incident: { rewardSeconds: 45 },
    heat: { rewardSeconds: 20 }, milestone: { rewardSeconds: 10 }, move: { rewardSeconds: 30 },
  };
  const AFTER_FIRST_SALE = 1, CLUSTER_FLEET_GOAL = 50;
  const MALL_EQUIPMENT_PRICE_MULT = 0.20;
  const AI_TRAINING_CLUSTER = { baseCost: 2000000, growth: 1.28, income: 8500, heat: 1200 };
  const MODEL_DISTILLATION = { cost: 80000000, clusterIncomeMult: 2 };
  const QUANTUM_MAINFRAME = { minStage: 3, baseCost: 2000000, growth: 1.105, income: 1400, heat: 14 };
  const ERROR_CORRECTION = { cost: 8000000000, incomeMult: 2 };
  const EXASCALE_ARRAY = { minStage: 4, baseCost: 500_000_000, growth: 1.23, income: 250_000, heat: 500 };
  const OPTICAL_BUS = { cost: 150_000_000_000, incomeMult: 2 };
  const ARRAY_FLEET_GOAL = 25;
  const MAINFRAME_FLEET_GOAL = 25;
  const LATE_PERKS = {
    labTier: 96, dividendTier: 192, labIncomeMult: 1.25, coolingMult: 1.30,
    fleetSize: MILESTONES[MILESTONES.length - 1].count, fleetIncomeMult: 1.45,
    handPayMult: 1.40, repeatBonus: 0.10, repeatStep: 2,
  };
  const percentGain = mult => Math.round((mult - 1) * 100);
  const PERK_TIERS = [
    { stars: 3, options: [
      { id: 'starterKit', name: 'Starter Kit', icon: 'tools', effect: { laptops: 5, fans: 1, macros: true, cash: 2000 },
        get desc() { const { laptops, fans, macros, cash } = this.effect;
          return `Start each run with ${laptops} Old Laptops, ${fans} Box Fan${fans === 1 ? '' : 's'}${macros ? ', Keyboard Macros' : ''} and $${cash.toLocaleString('en-US')}.`; } },
      { id: 'seedFunding', name: 'Seed Funding', icon: 'wallet', effect: { cash: 5000 },
        get desc() { return `Start each run with $${this.effect.cash.toLocaleString('en-US')} to spend.`; } },
    ] },
    { stars: 6, options: [
      { id: 'familyBusiness', name: 'Family Business', icon: 'staff', effect: { sibling: 2 },
        get desc() { return `Little Sibling starts each run at level ${this.effect.sibling}.`; } },
      { id: 'itRetainer', name: 'IT on Retainer', icon: 'tools', effect: { sysadmin: 1 },
        desc: 'Start each run with the Sysadmin already hired.' },
    ] },
    { stars: 12, options: [
      { id: 'bulkSupplier', name: 'Bulk Supplier', icon: 'box', effect: { machinePriceMult: 0.85 },
        get desc() { return `Pay ${Math.round((1 - this.effect.machinePriceMult) * 100)}% less for every machine.`; } },
      { id: 'industrialFans', name: 'Industrial Fans', icon: 'fan', effect: { coolingMult: 1.5 },
        get desc() { return `Get ${Math.round((this.effect.coolingMult - 1) * 100)}% more cooling from all sources.`; } },
    ] },
    { stars: 24, options: [
      { id: 'vipClients', name: 'VIP Clients', icon: 'sale', effect: { bonusGapMult: 0.5 },
        get desc() { return `Priority requests appear ${1 / this.effect.bonusGapMult}× as often during live play.`; } },
      { id: 'overachiever', name: 'Overachiever', icon: 'trophy', effect: { milestoneMult: 2.3 },
        get desc() { return `Each ownership milestone multiplies that machine’s income by ${this.effect.milestoneMult}.`; } },
    ] },
    { stars: 48, options: [
      { id: 'franchise', name: 'Franchise', icon: 'office', effect: { extraBranch: true },
        desc: 'Open one extra Stage 2 branch when you first move. Its bonus stays active through every expansion this run.' },
      { id: 'angelInvestors', name: 'Angel Investors', icon: 'star', effect: { bonusPerStar: 0.12 },
        get desc() { return `Each star adds ${Math.round(this.effect.bonusPerStar * 100)}% to income and job pay.`; } },
    ] },
    { stars: LATE_PERKS.labTier, options: [
      { id: 'coldReading', name: 'Cold Reading', icon: 'news',
        effect: { machineMult: { cluster: LATE_PERKS.labIncomeMult, mainframe: LATE_PERKS.labIncomeMult } },
        get desc() { return `Clusters and Mainframes earn ${percentGain(this.effect.machineMult.mainframe)}% more.`; } },
      { id: 'fanClub', name: 'Fan Club Treasurer', icon: 'fan', effect: { coolingMult: LATE_PERKS.coolingMult },
        get desc() { return `Your fan club pays its dues in airflow. All cooling increases by ${percentGain(this.effect.coolingMult)}%.`; } },
    ] },
    { stars: LATE_PERKS.dividendTier, options: [
      { id: 'benchMemo', name: 'Bench Memo', icon: 'goals', effect: { fleetSize: LATE_PERKS.fleetSize, fleetIncomeMult: LATE_PERKS.fleetIncomeMult },
        get desc() { return `Own ${this.effect.fleetSize} of one model and that whole fleet earns ${percentGain(this.effect.fleetIncomeMult)}% more. Someone finally read the manual.`; } },
      { id: 'thumbDividend', name: 'Thumb Dividend', icon: 'tap', effect: { handPayMult: LATE_PERKS.handPayMult },
        get desc() { return `Hand taps pay ${percentGain(this.effect.handPayMult)}% more.`; } },
    ] },
  ];
  const REPEAT_PERKS = [
    { id: 'incomeDividend', name: 'Outlet Royalties', icon: 'power', desc: `Add +${LATE_PERKS.repeatBonus * 100}% to your repeatable machine-income bonus.` },
    { id: 'tapDividend', name: 'Thumb Royalties', icon: 'tap', desc: `Add +${LATE_PERKS.repeatBonus * 100}% to your repeatable hand-tap bonus.` },
  ];
  const perkIndex = new Map(PERK_TIERS.flatMap(tier => tier.options.map(option => [option.id, { tier, option }])));
  function perkEffect(state, id) {
    const { tier, option } = perkIndex.get(id);
    return state?.perks?.[tier.stars] === id ? option.effect : null;
  }
  const INVESTOR_STAR_GOAL = 10, ANGEL_STAR_GOAL = 50, FAST_RUN_MOVE_SECONDS = 2 * 60;

  const BONUS = {
    firstGapMinSeconds: 45, firstGapMaxSeconds: 90,
    gapMinSeconds: 240, gapMaxSeconds: 420, returnGraceSeconds: 30, durationSeconds: 10,
    minClickMultiple: 20,
    tiers: [
      { id: 'small', weight: 70, seconds: 90 },
      { id: 'big', weight: 25, seconds: 360 },
      { id: 'jackpot', weight: 5, seconds: 1440 },
    ],
  };
  const HEAT_BAND_MIN = 0.95, HEAT_BAND_SECONDS = 60;
  const TAP_BURST_COUNT = 50, TAP_BURST_MS = 10000, FAST_MOVE_SECONDS = 8 * 60;
  const LONG_ABSENCE_SECONDS = 2 * 60 * 60;

  // growth = how much the price rises with each one you own (1.15 = +15%)
  const MACHINES = [
    { id: 'laptop', name: 'Old Laptop', icon: 'laptop', baseCost: 10, growth: 1.15, income: 0.4, heat: 1, revealAt: 0,
      blurb: 'Found it in a closet. The fan sounds like a jet engine.' },
    { id: 'tower', name: 'Desktop Tower', icon: 'tower', baseCost: 120, growth: 1.15, income: 3, heat: 3,
      blurb: 'A beige box from a garage sale. Still smells like 2009.' },
    { id: 'rack', name: 'Rack Server', icon: 'rack', baseCost: 1500, growth: 1.15, income: 20, heat: 10,
      blurb: 'Real enterprise hardware. The lights dim when it boots.' },
    { id: 'gpu', name: 'GPU Rig', icon: 'gpu', baseCost: 15000, growth: 1.15, income: 125, heat: 40, requiresMove: true,
      blurb: 'Eight graphics cards zip-tied to a shelf.' },
    { id: 'cluster', name: 'AI Training Cluster', icon: 'cluster', ...AI_TRAINING_CLUSTER,
      minStage: 2, minRuns: AFTER_FIRST_SALE, blurb: 'A wall of processors that keeps the whole building warm.' },
    { id: 'mainframe', name: 'Quantum Mainframe', icon: 'mainframe', ...QUANTUM_MAINFRAME,
      blurb: 'A chilled column of qubits. Please knock before observing.' },
    { id: 'exascale', name: 'Exascale Array', icon: 'exascale', ...EXASCALE_ARRAY,
      blurb: 'A whole aisle solves one problem at once. Today it is splitting the electric bill.' },
  ];

  const COOLERS = [
    { id: 'fan', name: 'Box Fan', icon: 'fan', baseCost: 25, growth: 1.2, cooling: 4,
      blurb: 'Point it at the problem.' },
    { id: 'ac', name: 'Window AC', icon: 'ac', baseCost: 600, growth: 1.2, cooling: 25,
      blurb: 'The basement window is tiny. It fits. Barely.' },
    { id: 'liquid', name: 'Liquid Loop', icon: 'liquid', baseCost: 8000, growth: 1.2, cooling: 120,
      blurb: 'Tubes everywhere. What could possibly go wrong?' },
  ];

  // Multipliers stack; the highest offlineCapSeconds upgrade sets the offline limit.
  const UPGRADES = [
    { id: 'insurance', name: 'Fire Insurance', icon: 'shield', get cost() { return FIRE.insurancePrice; }, requiresSmoke: true, effect: {},
      get desc() { return `Refunds ${FIRE.refundFraction * 100}% of the money spent on hardware lost in a fire.`; } },
    { id: 'macros', name: 'Keyboard Macros', icon: 'keyboard', cost: 50,
      effect: { clickMult: 2 }, desc: 'Doubles the base pay for manual and sibling jobs.' },
    { id: 'paste', name: 'Fresh Thermal Paste', icon: 'liquid', cost: 250, requires: { laptop: 1 },
      effect: { machineMult: { laptop: 2 } }, desc: 'Laptops earn 2×.' },
    { id: 'ssd', name: 'SSD Swap', icon: 'save', cost: 1000, requires: { tower: 1 },
      effect: { machineMult: { tower: 2 } }, desc: 'Towers earn 2×.' },
    { id: 'cables', name: 'Cable Management', icon: 'tools', cost: 1500,
      effect: { coolingMult: 1.25 }, desc: 'All cooling +25% (airflow, baby).' },
    { id: 'overclock', name: 'Overclock Everything', icon: 'bolt', cost: 5000,
      // Heat must rise MORE than income, or this can never hurt (while overheating, equal
      // multipliers cancel out exactly). With 2× heat it pays off only if you have spare cooling.
      effect: { incomeMult: 1.5, heatMult: 2 }, desc: 'Machine income 1.5×, but all heat 2×. Only worth it with spare cooling.' },
    { id: 'serveros', name: 'Server OS', icon: 'server', cost: 10000, requires: { rack: 1 },
      effect: { machineMult: { rack: 2 } }, desc: 'Racks earn 2×.' },
    { id: 'ups', name: 'UPS Battery Backup', icon: 'power', cost: 40000,
      effect: { offlineCapSeconds: 4 * 3600 }, desc: 'Earn up to 4 hours of income while away.' },
    { id: 'solar', name: 'Solar Panels on the Roof', icon: 'heat', cost: 1000000, requiresUpgrade: 'ups',
      effect: { offlineCapSeconds: 8 * 3600 }, desc: 'Earn up to 8 hours of income while away. Requires UPS Battery Backup.' },
    { id: 'distillation', name: 'Model Distillation', icon: 'cluster', cost: MODEL_DISTILLATION.cost, requires: { cluster: 1 },
      effect: { machineMult: { cluster: MODEL_DISTILLATION.clusterIncomeMult } },
      get desc() { return `AI Training Clusters earn ${this.effect.machineMult.cluster}×.`; } },
    { id: 'errorCorrection', name: 'Error Correction', icon: 'shield', cost: ERROR_CORRECTION.cost, requires: { mainframe: 1 },
      effect: { machineMult: { mainframe: ERROR_CORRECTION.incomeMult } },
      get desc() { return `Quantum Mainframes earn ${this.effect.machineMult.mainframe}×.`; } },
    { id: 'opticalBus', name: 'Optical Backplane', icon: 'exascale', cost: OPTICAL_BUS.cost, requires: { exascale: 1 },
      effect: { machineMult: { exascale: OPTICAL_BUS.incomeMult } },
      get desc() { return `Exascale Arrays earn ${OPTICAL_BUS.incomeMult}×. Data travels by light. Cable labels still travel by hand.`; } },
  ];

  const STAFF = [
    { id: 'sibling', name: 'Little Sibling', icon: 'staff', prices: [260, 1000, 3500, 12000, 40000],
      jobsPerSecond: [1, 2, 4, 7, 12], blurb: 'Runs jobs automatically. Earns more as your machines earn more. Takes payment in snacks.' },
    { id: 'sysadmin', name: 'Sysadmin', icon: 'tools', prices: [60000],
      blurb: 'Buys the best-value cooling when the room overheats during live play.' },
    { id: 'manager', name: 'Purchasing Manager', icon: 'box', prices: [MANAGER.price], revealAt: 0, minStars: MANAGER.minStars,
      blurb: 'Buys the current Best buy with its cooling while you play. You set the budget.' },
  ];

  const RELOCATION = {
    bigGoal: 55_000_000, legendaryGoal: 80_000_000_000,
    damPowerMax: 1.50, damHeatExponent: 1, volcanoPowerMax: 2,
    ORBITAL_FREE_LOAD: 1.3, VOLCANO_COOLER_PRICE_MULT: 0.25,
    penthouseTap: 2, penthouseRequestRate: 2, penthouseMachinePrice: 1.10,
    bunkerHires: ['sysadmin', 'manager'],
  };
  const STAGES = [
    { number: 1, name: "Parents' Basement", target: 0, locations: ['basement'] },
    { number: 2, machineUnlock: 'cluster', name: 'First real space', get target() { return CONFIG.moveGoal; }, locations: ['warehouse', 'office', 'mall'] },
    { number: 3, machineUnlock: 'mainframe', name: 'Going big', get target() { return RELOCATION.bigGoal; }, locations: ['dam', 'penthouse', 'bunker'] },
    { number: 4, machineUnlock: 'exascale', name: 'Legendary', get target() { return RELOCATION.legendaryGoal; }, locations: ['orbital', 'volcano'] },
  ];
  const LOCATIONS = {
    basement: { name: "Parents' Basement", room: 'The Basement', effect: {} },
    warehouse: { name: 'Arctic Warehouse', room: 'The Warehouse', icon: 'warehouse', effect: { coolingMult: 3 },
      desc: 'Cooling ×3. Room to pack in machines without melting anything.' },
    office: { name: 'Downtown Office', room: 'The Office', icon: 'office', effect: { incomeMult: 1.5, clickMult: 5, jobShareMult: 2 },
      desc: 'Machine income ×1.5. Jobs pay 5× the base plus double the usual share of machine income.' },
    mall: { name: 'Dead Mall', room: 'The Mall', icon: 'shop', minRuns: AFTER_FIRST_SALE, effect: { priceMult: MALL_EQUIPMENT_PRICE_MULT },
      get desc() { return `Cheap rent in an abandoned shopping mall. Machines and coolers cost ${Math.round((1 - this.effect.priceMult) * 100)}% less.`; } },
    dam: { name: 'Hydroelectric Dam', room: 'The Dam', icon: 'dam',
      effect: { get powerMax() { return RELOCATION.damPowerMax; }, get powerExponent() { return RELOCATION.damHeatExponent; } },
      get signature() { return `Power to ${percent(this.effect.powerMax)}%. Heat rises at the same rate.`; },
      desc: 'Double the power, double the heat. The river handles the overtime.' },
    penthouse: { name: 'Skyscraper Penthouse', room: 'The Penthouse', icon: 'penthouse',
      effect: { get handPayMult() { return RELOCATION.penthouseTap; }, get machinePriceMult() { return RELOCATION.penthouseMachinePrice; } },
      get signature() { return `${RELOCATION.penthouseTap}× hand taps and ${RELOCATION.penthouseRequestRate}× priority requests`; },
      get desc() { return RELOCATION.penthouseMachinePrice === 1 ? 'Clients take the express elevator.' :
        `Machines cost ${percentGain(RELOCATION.penthouseMachinePrice)}% more. The freight elevator adds a fee.`; } },
    bunker: { name: 'Cold War Bunker', room: 'The Bunker', icon: 'bunker',
      effect: { fireImmune: true }, signature: 'Fireproof with a free Sysadmin and Purchasing Manager',
      desc: 'The crew comes with the keys. The blast door has a cat flap.' },
    orbital: { name: 'Orbital Data Station', room: 'Orbital Data Station', icon: 'orbital',
      effect: { fireImmune: true, get freeLoad() { return RELOCATION.ORBITAL_FREE_LOAD; } },
      get signature() { return `Cold vacuum: full speed up to ${percent(this.effect.freeLoad)}% heat, always fireproof`; },
      desc: 'Beyond that load the racks slow down. Radiators still earn their ride to orbit.' },
    volcano: { name: 'Volcano Lair', room: 'Volcano Lair', icon: 'volcano',
      effect: { get powerMax() { return RELOCATION.volcanoPowerMax; },
        get coolerPriceMult() { return RELOCATION.VOLCANO_COOLER_PRICE_MULT; } },
      get signature() { return `Power to ${percent(this.effect.powerMax)}%. Lava-cooled: coolers cost ${percent(this.effect.coolerPriceMult)}% of the usual price`; },
      desc: 'The heat is real. The local supplier accepts geothermal credit.' },
  };
  const stageByLocation = new Map(STAGES.flatMap(stage => stage.locations.map(id => [id, stage.number])));

  /*
   * Ignored offers expire harmlessly, except a heat wave that expires during live play.
   * Each incident has an "accept" and a "decline" outcome. Outcomes can:
   *   cashSeconds  - pay you this many seconds of current income (at least minCash)
   *   costSeconds  - cost this many seconds of current income (at least minCost)
   *   freeMachine  - give one free copy of your best machine
   *   duration + effect - apply temporary multipliers (same keys as upgrades)
   * Prices are locked in when the incident appears, so the button never changes under your cursor.
   */
  const EVENTS = [
    { id: 'blogger', icon: 'news', title: 'A tech blogger wants a tour',
      text: 'Show them around? Free publicity brings in a wave of new clients.',
      accept: { label: 'Give the tour', cashSeconds: 60, minCash: 25 },
      decline: { label: 'No thanks' },
      minMachines: 1 },
    { id: 'rush', icon: 'clock', title: 'Rush job!',
      text: 'A client needs results NOW and pays double, but running flat out makes a lot of heat. Worth it only if you have spare cooling.',
      accept: { label: 'Take the job', duration: 45, effect: { incomeMult: 2, heatMult: 2.5 }, summary: 'machine income ×2, heat ×2.5' },
      decline: { label: 'Pass' },
      minMachines: 5 },
    { id: 'heatwave', icon: 'heat', title: 'Heat wave incoming',
      text: "It's going to hit 98°F outside. Unless you do something, cooling drops 30% for a minute.",
      accept: { label: 'Buy bags of ice', costSeconds: 20, minCost: 15 },
      decline: { label: 'Tough it out', duration: 60, effect: { coolingMult: 0.7 }, summary: 'cooling −30%' },
      minMachines: 3 },
    { id: 'liquidation', icon: 'box', title: 'Office liquidation sale',
      text: 'A bankrupt startup is giving away hardware. A free machine, but it brings its own heat.',
      accept: { label: 'Take it', freeMachine: true },
      decline: { label: 'Leave it' },
      minMachines: 3 },
  ];

  /*
   * Client contracts: a business decision that lasts minutes, not seconds. You pick one client
   * at a time from the board, and its terms are locked when you sign. Progress counts only while
   * the requirement holds, live or away (within the offline limit), and simply pauses otherwise.
   * A contract never fails; ending one early forfeits its progress. Unlike incidents, nothing is
   * random or timed: the board shows every client you have unlocked. Unlike to-do goals, a contract
   * asks you to run the datacenter differently for a while, not to reach a count.
   *   requirement 'income'   machine income stays at or above incomeShare × the income at signing
   *               'headroom' heat stays at or below maxLoad of cooling
   *               'capacity' machine income reaches capacityGrowth × the income at signing
   *               'power'    Power at minPower or higher with machines at full speed
   *   rewardSeconds is income per second at signing, paid once on completion.
   */
  const CONTRACT_RULES = { unlockMachinesBought: 10 };
  const CONTRACTS = [
    { id: 'hosting', name: 'Web Hosting', icon: 'server', client: 'Crumb & Co. Bakeries',
      pitch: 'Their order page has to stay quick all week.',
      requirement: 'income', incomeShare: 0.9, durationSeconds: 600, rewardSeconds: 90,
      tradeoff: 'Easy to keep, and it keeps going while you are away. It pays the least per minute.' },
    { id: 'managed', name: 'Managed Services', icon: 'fan', client: 'Lakeside Dental Group',
      pitch: 'They pay for spare capacity and zero surprises.', unlock: 'overheat',
      requirement: 'headroom', maxLoad: 0.8, durationSeconds: 360, rewardSeconds: 75,
      tradeoff: 'You need spare cooling the whole time, so Overclock and high Power have to wait.' },
    { id: 'processing', name: 'Data Processing', icon: 'stats', client: 'County Records Office',
      pitch: 'Ten years of scanned forms, all due at once.', unlock: 'rack',
      requirement: 'capacity', capacityGrowth: 1.4, durationSeconds: 180, rewardSeconds: 100,
      tradeoff: 'Nothing counts until you build the capacity. Then it finishes quickly.' },
    { id: 'ai', name: 'AI Training', icon: 'cluster', client: 'Chattr, a chatbot startup',
      pitch: 'Their model trains around the clock, and they pay the most.', unlock: 'gpu',
      requirement: 'power', minPower: 1.15, durationSeconds: 300, rewardSeconds: 160,
      tradeoff: 'Power at 115% makes about a quarter more heat. Push past the cooling and fire risk builds.' },
  ];
  const CONTRACT_BY_ID = new Map(CONTRACTS.map(def => [def.id, def]));
  const CONTRACT_UNLOCK_TEXT = {
    machines: `Buy ${CONTRACT_RULES.unlockMachinesBought} machines and clients start calling.`,
    overheat: 'Unlocks after your first overheat.',
    rack: 'Unlocks with your first Rack Server.',
    gpu: 'Unlocks with your first GPU Rig.',
  };

  const SAVE_VERSION = 2;
  // A legitimately opened branch stays open across balance updates and backup restores.
  const PRE_SIGNATURE_UNLOCKS = { 3: 55_000_000, 4: 150_000_000_000, mainframeStars: 24 };

  // ---------------------------------------------------------------------------
  // Lookups
  // ---------------------------------------------------------------------------

  function byId(list) {
    const out = {};
    for (const item of list) out[item.id] = item;
    return out;
  }
  const MACHINE_BY_ID = byId(MACHINES);
  const COOLER_BY_ID = byId(COOLERS);
  const UPGRADE_BY_ID = byId(UPGRADES);
  const STAFF_BY_ID = byId(STAFF);
  const EVENT_BY_ID = byId(EVENTS);
  const TABLES = { machine: MACHINE_BY_ID, cooler: COOLER_BY_ID, upgrade: UPGRADE_BY_ID, staff: STAFF_BY_ID };
  const SHOP_ITEMS = Object.entries(TABLES).flatMap(([kind, table]) =>
    Object.values(table).map(def => ({ kind, id: def.id })));
  const COOLING_STEPS_PER_MACHINE = 20;

  function lookup(kind, id) {
    const table = TABLES[kind];
    return table && Object.prototype.hasOwnProperty.call(table, id) ? table[id] : null;
  }

  function zeroCounts(list) {
    const out = {};
    for (const item of list) out[item.id] = 0;
    return out;
  }

  function newCounters() {
    return {
      fires: 0, insurancePaid: 0, alarmsSurvived: 0, bestFireRebuild: 0,
      goalsClaimed: 0, overtimeBoosts: 0,
      machinesBought: 0, coolersBought: 0, siblingJobs: 0, sysadminPurchases: 0,
      incidentsAccepted: 0, incidentsDeclined: 0,
      heatWavesSurvived: 0, bonusesCaught: 0, bonusesMissed: 0, bonusCashEarned: 0,
      liveSeconds: 0, highestIncome: 0, timeToMove: 0, jackpotsCaught: 0,
      moveTimeRecorded: 0, everOverheated: 0, contractsCompleted: 0, contractCashEarned: 0,
      longestHeatStreakSeconds: 0, longestMaxPowerSeconds: 0, bestTapBurst: 0, longestAbsenceSeconds: 0,
    };
  }

  // These streaks require uninterrupted play. Only their best results survive a reload.
  const LIVE_SESSION = Symbol('live session');
  function liveSession(state) {
    if (!state[LIVE_SESSION]) {
      Object.defineProperty(state, LIVE_SESSION, { value: { taps: [], heatSeconds: 0, powerSeconds: 0 } });
    }
    return state[LIVE_SESSION];
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  function newState(now) {
    return {
      version: SAVE_VERSION, power: POWER.normal,
      fireRisk: 0, fireAlarmPending: false, fireRunBurned: false, fireCharred: false, runInsurancePaid: 0,
      money: 0,          // spendable cash
      lifetime: 0,       // earnings in this run, used for shop reveals and moving out
      stars: 0, runs: 0, allTimeEarnings: 0, runStartedAt: now,
      perks: {}, perkChoicePending: false, runBestIncome: 0, runStartingCash: 0,
      records: { fastestMoveSeconds: null, bestRunEarnings: 0 },
      clicks: 0,
      counters: newCounters(),
      achievements: [], decor: newDecor(),
      machines: zeroCounts(MACHINES),
      coolers: zeroCounts(COOLERS),
      staff: { sibling: 0, sysadmin: 0, sysadminEnabled: true },
      managerEnabled: true, managerBudget: MANAGER.defaultBudget,
      challenge: null, challengeRewards: [],
      upgrades: [],
      location: 'basement', sites: ['basement'],
      extraLocation: null,  // a Franchise bonus; only the physical location counts as the move
      flags: {},         // one-time story messages already shown
      event: null,       // incident waiting for an answer: { id, remaining, cash?, price?, machineId? }
      active: null,      // temporary effect running: { id, side: 'accept' | 'decline', remaining }
      nextEventIn: CONFIG.firstEventSeconds,
      startedAt: now,
      lastTick: now,     // last moment production was credited (used for offline progress)
    };
  }

  function milestoneMult(count, state) {
    let multiplier = 1;
    const upgrade = perkEffect(state, 'overachiever');
    for (const tier of MILESTONES) {
      if (count < tier.count) break;
      multiplier *= upgrade?.milestoneMult ?? tier.mult;
    }
    return multiplier;
  }

  function nextMilestone(count) {
    return MILESTONES.find((tier) => tier.count > count) || null;
  }

  function offlineCapSeconds(state) {
    let cap = CONFIG.offlineCapSeconds;
    for (const id of state.upgrades) cap = Math.max(cap, UPGRADE_BY_ID[id].effect.offlineCapSeconds || 0);
    return cap;
  }

  function currentStage(state) {
    return stageByLocation.get(state.location) || 1;
  }

  function nextStage(state) {
    return STAGES[currentStage(state)] || null;
  }

  // location stays available to existing clients; the list records the physical move history.
  function runSites(state) {
    if (state.sites?.at(-1) === state.location) return state.sites.slice();
    return state.location === 'basement' ? ['basement'] : ['basement', state.location];
  }

  function moveDestinations(state) {
    return (nextStage(state)?.locations || []).filter(id => state.runs >= (LOCATIONS[id].minRuns || 0));
  }

  function franchiseChoices(state, physical) {
    if (currentStage(state) !== 1 || !perkEffect(state, 'franchise')?.extraBranch) return [];
    const available = moveDestinations(state);
    return available.includes(physical) ? available.filter(id => id !== physical) : [];
  }

  function hasSite(state, id) {
    return state.location === id || !!state.sites?.includes(id) ||
      (state.extraLocation === id && state.location !== 'basement' && !!perkEffect(state, 'franchise')?.extraBranch);
  }

  function locationPriceMult(state, kind) {
    if (!state) return 1;
    const equipment = hasSite(state, 'mall') ? LOCATIONS.mall.effect.priceMult : 1;
    if (kind === 'cooler' && hasSite(state, 'volcano')) return equipment * LOCATIONS.volcano.effect.coolerPriceMult;
    if (kind === 'machine' && hasSite(state, 'penthouse')) return equipment * LOCATIONS.penthouse.effect.machinePriceMult;
    return equipment;
  }

  // Combine ownership milestones, purchased upgrades, location and any active incident.
  function modifiers(state) {
    const mod = { clickMult: 1, handPayMult: 1, jobShareMult: 1, incomeMult: 1, heatMult: 1, coolingMult: 1, priceMult: 1, machinePriceMult: 1, powerMax: POWER.max, powerExponent: POWER.heatExponent, fireImmune: false, freeLoad: 1, machineMult: {} };
    for (const m of MACHINES) mod.machineMult[m.id] = milestoneMult(state.machines[m.id] || 0, state);
    const effects = state.upgrades.map((id) => UPGRADE_BY_ID[id]).filter(Boolean).map((u) => u.effect);
    for (const id of runSites(state)) effects.push(LOCATIONS[id].effect);
    if (state.extraLocation && state.location !== 'basement' && perkEffect(state, 'franchise')?.extraBranch) {
      effects.push(LOCATIONS[state.extraLocation].effect);
    }
    const cooling = perkEffect(state, 'industrialFans');
    if (cooling) effects.push(cooling);
    if (state.stars >= LATE_PERKS.labTier) {
      for (const stars of [LATE_PERKS.labTier, LATE_PERKS.dividendTier]) {
        const option = perkIndex.get(state.perks[stars])?.option;
        if (option) effects.push(option.effect);
      }
      if (state.stars >= firstRepeatStars) {
        const repeats = repeatPerkCounts(state);
        effects.push({ incomeMult: 1 + repeats.income * LATE_PERKS.repeatBonus,
          handPayMult: 1 + repeats.tap * LATE_PERKS.repeatBonus });
      }
    }
    if (state.stars) {
      const reputation = runReputationMultiplier(state);
      // The machine-derived part of each job already receives this through machine income.
      effects.push({ incomeMult: reputation, clickMult: reputation });
    }
    if (state.overtimeWaitSeconds > REWARDS.cooldownSeconds) mod.incomeMult *= REWARDS.boostMultiplier;
    const temp = activeOutcome(state);
    const twist = CHALLENGE_BY_ID.get(state.challenge)?.effect;
    if (twist) effects.push(twist);
    for (const id of state.challengeRewards || []) {
      const reward = CHALLENGE_BY_ID.get(id)?.permanent;
      if (reward) effects.push(reward);
    }
    if (temp && temp.effect) effects.push(temp.effect);
    for (const e of effects) {
      for (const key of ['clickMult', 'handPayMult', 'jobShareMult', 'incomeMult', 'heatMult', 'coolingMult', 'priceMult', 'machinePriceMult']) {
        if (e[key]) mod[key] *= e[key];
      }
      if (e.powerMax) mod.powerMax = Math.max(mod.powerMax, e.powerMax);
      if (e.freeLoad) mod.freeLoad = Math.max(mod.freeLoad, e.freeLoad);
      if (e.fireImmune) mod.fireImmune = true;
      if (e.powerExponent) mod.powerExponent = e.powerExponent;
      if (e.machineMult) {
        for (const id of Object.keys(e.machineMult)) {
          mod.machineMult[id] = (mod.machineMult[id] || 1) * e.machineMult[id];
        }
      }
      if (e.fleetIncomeMult) {
        for (const m of MACHINES) {
          if (state.machines[m.id] >= e.fleetSize) mod.machineMult[m.id] *= e.fleetIncomeMult;
        }
      }
    }
    return mod;
  }

  /*
   * Everything the screen needs to know about production right now.
   *
   * Heat rule: load = heat / cooling. Up to 100% load, machines run at full speed.
   * Above the site’s free-load threshold, speed scales as threshold / load.
   */
  function calculateStats(state, mod) {
    const incomePerUnit = {};
    const heatPerUnit = {};
    const coolingPerUnit = {};
    let rawMachineIncome = 0;
    let heatAtNormalPower = 0;
    const power = state.power === POWER.normal || !hasPowerHistory(state) ? POWER.normal : normalizedPower(state.power, mod.powerMax);
    const powerHeatMult = power ** mod.powerExponent;

    for (const m of MACHINES) {
      const n = state.machines[m.id] || 0;
      incomePerUnit[m.id] = m.income * (mod.machineMult[m.id] || 1) * mod.incomeMult * power;
      const unitHeat = m.heat * mod.heatMult;
      heatPerUnit[m.id] = unitHeat * powerHeatMult;
      rawMachineIncome += n * incomePerUnit[m.id];
      heatAtNormalPower += n * unitHeat;
    }

    const cooling = baseCoolingCapacity(state) * mod.coolingMult;
    for (const c of COOLERS) coolingPerUnit[c.id] = c.cooling * mod.coolingMult;

    const heat = heatAtNormalPower * powerHeatMult;
    const load = heat / cooling;
    const throttle = load > mod.freeLoad ? mod.freeLoad / load : 1;
    const machineIncome = rawMachineIncome * throttle;
    const baseJobPay = CONFIG.clickValue * mod.clickMult;
    const clickValue = (baseJobPay + machineIncome * CONFIG.jobIncomeShare * mod.jobShareMult) * mod.handPayMult;
    const siblingShare = CONFIG.siblingIncomeShare * mod.jobShareMult;
    const siblingJobPay = baseJobPay + machineIncome * siblingShare;
    const siblingJobsPerSecond = STAFF_BY_ID.sibling.jobsPerSecond[state.staff.sibling - 1] || 0;
    const staffIncome = siblingJobsPerSecond * siblingJobPay;

    return {
      income: machineIncome + staffIncome,
      rawIncome: rawMachineIncome + siblingJobsPerSecond * (baseJobPay + rawMachineIncome * siblingShare),
      machineIncome, staffIncome, siblingJobPay, siblingJobsPerSecond, offlineCapSeconds: offlineCapSeconds(state),
      heat, heatAtNormalPower, power, powerHeatMult, powerHeatExponent: mod.powerExponent, fireImmune: mod.fireImmune, freeLoad: mod.freeLoad, powerMax: mod.powerMax,
      cooling,
      load,                           // 1 = exactly at capacity
      throttle,                       // 1 = full speed, 0.5 = half speed
      clickValue,
      incomePerUnit,
      heatPerUnit,
      coolingPerUnit,
    };
  }

  function hasPowerHistory(state) {
    return state.counters.everOverheated === 1 || state.flags.firstHot === true || state.achievements.includes('overheat');
  }

  // Taps, the live clock, the Sysadmin and shop advice often read the same
  // inventory in one tick. Money and the time remaining on an effect don't
  // change the rates. Checking values also handles saves edited via game.state.
  const productionCache = new WeakMap();
  function currentProduction(state) {
    const key = JSON.stringify([state.machines, state.coolers, state.upgrades, state.staff,
      state.location, state.sites, state.extraLocation, state.stars, state.perks, state.challenge,
      state.challengeRewards, state.active?.id, state.active?.side, state.power, hasPowerHistory(state),
      state.overtimeWaitSeconds > REWARDS.cooldownSeconds]);
    let snapshot = productionCache.get(state);
    if (!snapshot || snapshot.key !== key) {
      const mod = modifiers(state);
      snapshot = { key, mod, current: calculateStats(state, mod) };
      productionCache.set(state, snapshot);
    }
    return snapshot;
  }

  function stats(state, mod) {
    return mod === undefined ? currentProduction(state).current : calculateStats(state, mod);
  }

  // Preserve the public API: callers can keep or edit a report without
  // changing any later tap, purchase quote, or offline credit.
  function readStats(state, mod) {
    const st = stats(state, mod);
    return { ...st, incomePerUnit: { ...st.incomePerUnit }, heatPerUnit: { ...st.heatPerUnit },
      coolingPerUnit: { ...st.coolingPerUnit } };
  }

  function powerUnlocked(state, st) {
    return hasPowerHistory(state) || (st ?? stats(state)).load > 1;
  }

  function signatureUI(state, st = stats(state)) {
    const powerLabel = hasSite(state, 'volcano') && LOCATIONS.volcano.effect.powerMax === st.powerMax ? 'Volcano' :
      hasSite(state, 'dam') ? 'Dam' : '';
    return { powerMax: st.powerMax, powerLabel, fireproof: st.fireImmune,
      freeLoad: st.freeLoad, doubleTaps: hasSite(state, 'penthouse') };
  }

  const boundPower = (value, max) => Math.min(max, Math.max(POWER.min, value));
  function normalizedPower(value, max) {
    if (typeof value !== 'number' || Number.isNaN(value)) return POWER.normal;
    const stepsPerUnit = 1 / POWER.step;
    return boundPower(Math.round((boundPower(value, max) + Number.EPSILON) * stepsPerUnit) / stepsPerUnit, max);
  }

  function setPower(state, value) {
    const unlocked = !state.perkChoicePending && powerUnlocked(state);
    if (unlocked && !hasPowerHistory(state)) state.counters.everOverheated = 1;
    const applied = unlocked ? normalizedPower(value, stats(state).powerMax) : POWER.normal;
    if (state.power !== applied) {
      state.power = applied;
      recordRates(state, stats(state));
    }
    return applied;
  }

  function powerSweetSpot(state, st = stats(state)) {
    if (st.heatAtNormalPower === 0) return st.powerMax;
    return boundPower((st.cooling * st.freeLoad / st.heatAtNormalPower) ** (1 / st.powerHeatExponent), st.powerMax);
  }

  function bestPower(state, st = stats(state)) {
    if (state.perkChoicePending || !powerUnlocked(state, st)) return POWER.normal;
    const ideal = powerSweetSpot(state, st);
    const stepsPerUnit = 1 / POWER.step;
    const lower = boundPower(Math.floor(ideal * stepsPerUnit) / stepsPerUnit, st.powerMax);
    const upper = boundPower(Math.ceil(ideal * stepsPerUnit) / stepsPerUnit, st.powerMax);
    // On either side of full load the income curve is monotone. Compare the
    // two neighboring settings because the steeper hot side need not win a nearest-step tie.
    const output = p => p / Math.max(1, st.heatAtNormalPower * p ** st.powerHeatExponent / (st.cooling * st.freeLoad));
    return output(upper) > output(lower) ? upper : lower;
  }

  function baseCoolingCapacity(state) {
    let capacity = CONFIG.baseCooling;
    for (const c of COOLERS) capacity += (state.coolers[c.id] || 0) * c.cooling;
    return capacity;
  }

  const inHeatBand = st => st.load >= HEAT_BAND_MIN && st.throttle === 1;
  const atMaxPower = st => st.power === POWER.max && st.heatAtNormalPower > 0 && st.throttle === 1;
  function advancePowerStreak(state, st, seconds) {
    if (state.counters.longestMaxPowerSeconds >= POWER.achievementSeconds) return;
    if (!st || !atMaxPower(st) || !hasPowerHistory(state)) {
      if (state[LIVE_SESSION]) state[LIVE_SESSION].powerSeconds = 0;
      return;
    }
    const session = liveSession(state);
    session.powerSeconds = Math.min(POWER.achievementSeconds, Math.round((session.powerSeconds + seconds) * 1000) / 1000);
    state.counters.longestMaxPowerSeconds = Math.max(state.counters.longestMaxPowerSeconds, session.powerSeconds);
  }
  function recordRates(state, st) {
    state.runBestIncome = Math.max(state.runBestIncome, st.income);
    state.counters.highestIncome = Math.max(state.counters.highestIncome, st.income);
    if (st.throttle < 1) state.counters.everOverheated = 1;
    if (state[LIVE_SESSION] && !inHeatBand(st)) state[LIVE_SESSION].heatSeconds = 0;
    if (state[LIVE_SESSION] && !atMaxPower(st)) state[LIVE_SESSION].powerSeconds = 0;
    if (state.goals && (st.load < GOALS.heatMin || st.load > GOALS.heatMax)) updateGoalHeat(state, null, 0);
  }

  function recordPurchase(state, kind, n) {
    if (kind === 'machine') {
      state.counters.machinesBought += n;
      recordFireRebuild(state);
    }
    if (kind === 'cooler') state.counters.coolersBought += n;
    recordRates(state, stats(state));
  }

  // ---------------------------------------------------------------------------
  // Prices and purchases
  // ---------------------------------------------------------------------------

  // Price of the next one when you already own `owned` of them. Always a whole dollar.
  function price(def, owned, state) {
    const discount = MACHINE_BY_ID[def.id] ? perkEffect(state, 'bulkSupplier')?.machinePriceMult ?? 1 : 1;
    const shortage = state?.challenge === 'supply-shortage' ? BOARD_RULES.shortagePrice : 1;
    const reward = MACHINE_BY_ID[def.id] && state?.challengeRewards?.includes('supply-shortage') ? BOARD_RULES.machinePriceReward : 1;
    return Math.ceil(def.baseCost * Math.pow(def.growth, owned) * discount * locationPriceMult(state, MACHINE_BY_ID[def.id] ? 'machine' : 'cooler') * shortage * reward - 1e-9);
  }

  function ownedCount(state, kind, id) {
    if (kind === 'machine') return state.machines[id] || 0;
    if (kind === 'cooler') return state.coolers[id] || 0;
    if (kind === 'upgrade') return state.upgrades.includes(id) ? 1 : 0;
    if (kind === 'staff') return state.staff[id] || 0;
    return 0;
  }

  function cost(state, kind, id) {
    const def = lookup(kind, id);
    if (!def) return Infinity;
    if (kind === 'staff') return def.prices[ownedCount(state, kind, id)] ?? Infinity;
    return kind === 'upgrade' ? def.cost : price(def, ownedCount(state, kind, id), state);
  }

  // The first unmet requirement other than money, or null when the item can be bought
  // with enough cash. The shop uses this to explain a locked card; meetsRequirements()
  // below is the same check as a yes/no answer.
  function requirementBlocker(state, def) {
    if (state.challenge === 'bootstrapped' && def.prices) return { type: 'challenge', challenge: 'bootstrapped' };
    if (def.requiresSmoke && !state.flags.fireSmokeSeen) return { type: 'smoke' };
    if (def.minRuns && state.runs < def.minRuns) return { type: 'runs', runs: def.minRuns };
    if (def.minStage && currentStage(state) < def.minStage) return { type: 'stage', stage: def.minStage };
    if (def.minStars && state.stars < def.minStars) return { type: 'stars', stars: def.minStars };
    if (def.requiresMove && state.location === 'basement') return { type: 'move' };
    if (def.requiresUpgrade && !state.upgrades.includes(def.requiresUpgrade)) {
      return { type: 'upgrade', id: def.requiresUpgrade };
    }
    if (def.requires) {
      for (const id of Object.keys(def.requires)) {
        if ((state.machines[id] || 0) < def.requires[id]) return { type: 'machine', id, count: def.requires[id] };
      }
    }
    return null;
  }

  // Requirements other than money: having moved out, owning a prerequisite machine.
  function meetsRequirements(state, def) {
    return requirementBlocker(state, def) === null;
  }

  // Should the shop show this item yet? Items appear as you approach being able to afford them.
  function isRevealed(state, kind, id) {
    const def = lookup(kind, id);
    if (!def) return false;
    if (ownedCount(state, kind, id) > 0) return true;
    if (!meetsRequirements(state, def)) return false;
    return state.lifetime >= revealPoint(kind, id, state);
  }

  function revealPoint(kind, id, state) {
    const def = lookup(kind, id);
    if (!def) return Infinity;
    if (def.revealAt != null) return def.revealAt;
    // Preserve the original reveal schedule outside the Mall. Its equipment offers
    // reveal at half the discounted, rounded first price, including any supplier deal.
    const adjustedPrices = locationPriceMult(state, kind) !== 1 || state?.challenge === 'supply-shortage' ||
      (kind === 'machine' && state?.challengeRewards?.includes('supply-shortage'));
    const base = def.baseCost != null && adjustedPrices
      ? price(def, 0, state) : def.baseCost ?? def.cost ?? def.prices[0];
    return base * CONFIG.revealFraction;
  }

  function nextReveal(state) {
    let next = null;
    for (const [kind, table] of Object.entries(TABLES)) {
      for (const def of Object.values(table)) {
        if (!meetsRequirements(state, def) || isRevealed(state, kind, def.id)) continue;
        const at = revealPoint(kind, def.id, state);
        if (!next || at < next.at) next = { kind, id: def.id, at };
      }
    }
    return next;
  }

  function canBuy(state, kind, id) {
    if (state.perkChoicePending) return false;
    const def = lookup(kind, id);
    if (!def) return false;
    if (kind === 'upgrade' && state.upgrades.includes(id)) return false;
    if (kind === 'staff' && ownedCount(state, kind, id) >= def.prices.length) return false;
    return meetsRequirements(state, def) && state.money >= cost(state, kind, id);
  }

  // What a shop card shows for a quote from its quantity selector ({ count, total, nextTotal }):
  // 'ready' to buy, 'short' of cash by a positive amount, or 'locked' by a requirement that
  // money alone can't satisfy. A locked card never reports a cash shortage.
  function purchaseStatus(state, kind, id, quote, blocker) {
    const def = lookup(kind, id);
    if (blocker === undefined) {
      blocker = !def ? { type: 'unknown' } : state.perkChoicePending ? { type: 'perk-choice' } : requirementBlocker(state, def);
    }
    if (blocker) return { status: 'locked', blocker };
    if (quote.count > 0 && state.money >= quote.total) return { status: 'ready' };
    const needed = quote.count > 0 ? quote.total : quote.nextTotal;
    if (!(needed > state.money) || !Number.isFinite(needed)) return { status: 'unavailable' };
    const fraction = Math.max(0, Math.min(1, state.money / needed));
    return { status: 'short', needed, shortfall: Math.ceil(needed - state.money), fraction };
  }

  // Player-facing explanation of a requirementBlocker() result, in the game's own terms.
  function requirementText(state, blocker, owned = 0) {
    const more = owned > 0 ? ' more' : '';
    switch (blocker?.type) {
      case 'stage': return `Expand to Stage ${blocker.stage} to buy${more}`;
      case 'move': return `Move out of the basement to buy${more}`;
      case 'runs': return blocker.runs === 1 ? 'Unlocks after your first sale' : `Unlocks after ${blocker.runs} sales`;
      case 'stars': return `Needs ${blocker.stars.toLocaleString('en-US')} stars`;
      case 'upgrade': return `Install ${UPGRADE_BY_ID[blocker.id]?.name || 'its upgrade'} first`;
      case 'machine': {
        const name = MACHINE_BY_ID[blocker.id]?.name || 'the required machine';
        return `Own ${blocker.count} ${name}${blocker.count === 1 ? '' : 's'} first`;
      }
      case 'smoke': return 'Unlocks after your first smoke warning';
      case 'challenge': return 'No hires during the Bootstrapped challenge';
      case 'perk-choice': return 'Choose your investor perk first';
      default: return 'Not available right now';
    }
  }

  // Returns { ok: true, cost } or { ok: false, reason: 'unknown' | 'owned' | 'locked' | 'poor' }.
  function buy(state, kind, id) {
    if (state.perkChoicePending) return { ok: false, reason: 'perk-choice' };
    const def = lookup(kind, id);
    if (!def) return { ok: false, reason: 'unknown' };
    if (kind === 'upgrade' && state.upgrades.includes(id)) return { ok: false, reason: 'owned' };
    if (kind === 'staff' && ownedCount(state, kind, id) >= def.prices.length) return { ok: false, reason: 'owned' };
    if (!meetsRequirements(state, def)) return { ok: false, reason: 'locked' };
    const c = cost(state, kind, id);
    if (state.money < c) return { ok: false, reason: 'poor' };

    if (kind === 'machine' || kind === 'cooler') state.equipmentCost = equipmentBasis(state) + c;
    state.money -= c;
    addToInventory(state, kind, id, 1);
    recordPurchase(state, kind, 1);
    return { ok: true, cost: c };
  }

  // Total price of the next `n` machines/coolers (each one priced as if bought one at a time).
  function bulkCost(state, kind, id, n) {
    const def = lookup(kind, id);
    if (!def) return Infinity;
    if (kind === 'upgrade' || kind === 'staff') return n === 1 ? cost(state, kind, id) : Infinity;
    const owned = ownedCount(state, kind, id);
    let total = 0;
    for (let i = 0; i < n; i++) total += price(def, owned + i, state);
    return total;
  }

  // How many you could buy right now with the money you have.
  function maxAffordable(state, kind, id) {
    if (state.perkChoicePending) return 0;
    const def = lookup(kind, id);
    if (!def || kind === 'upgrade' || kind === 'staff' || !meetsRequirements(state, def)) return 0;
    const owned = ownedCount(state, kind, id);
    let total = 0;
    let n = 0;
    while (n < CONFIG.maxBulkBuy) {
      const next = price(def, owned + n, state);
      if (total + next > state.money) break;
      total += next;
      n += 1;
    }
    return n;
  }

  // Buy exactly `n` (all or nothing). Same result as calling buy() n times.
  function buyMany(state, kind, id, n) {
    if (state.perkChoicePending) return { ok: false, reason: 'perk-choice' };
    if (kind === 'staff' && n !== 1) return { ok: false, reason: 'unknown' };
    if (kind === 'upgrade' || n === 1) {
      const r = buy(state, kind, id);
      return r.ok ? { ok: true, cost: r.cost, count: 1 } : r;
    }
    const def = lookup(kind, id);
    if (!def) return { ok: false, reason: 'unknown' };
    if (!(n >= 1) || !Number.isInteger(n)) return { ok: false, reason: 'unknown' };
    if (!meetsRequirements(state, def)) return { ok: false, reason: 'locked' };
    const c = bulkCost(state, kind, id, n);
    if (state.money < c) return { ok: false, reason: 'poor' };
    state.equipmentCost = equipmentBasis(state) + c;
    state.money -= c;
    addToInventory(state, kind, id, n);
    recordPurchase(state, kind, n);
    return { ok: true, cost: c, count: n };
  }

  function cheapestCoolerFor(state, st = stats(state)) {
    let selected = null;
    let lowest = Infinity;
    for (const cooler of COOLERS) {
      if (!isRevealed(state, 'cooler', cooler.id)) continue;
      const perUnit = cost(state, 'cooler', cooler.id) / st.coolingPerUnit[cooler.id];
      if (perUnit < lowest) {
        selected = cooler.id;
        lowest = perUnit;
      }
    }
    return selected;
  }

  function addToInventory(state, kind, id, count) {
    if (kind === 'machine') state.machines[id] += count;
    else if (kind === 'cooler') state.coolers[id] += count;
    else if (kind === 'staff') state.staff[id] = (state.staff[id] || 0) + count;
    else state.upgrades.push(id);
  }

  function availableForAdvice(state, kind, id) {
    const def = lookup(kind, id);
    if (!def || state.perkChoicePending || !isRevealed(state, kind, id) || !meetsRequirements(state, def)) return false;
    if (kind === 'upgrade') return !state.upgrades.includes(id);
    return kind !== 'staff' || ownedCount(state, kind, id) < def.prices.length;
  }

  function earningRate(st, cps) {
    return st.income + st.clickValue * cps;
  }

  function secondsToAfford(price, cash, income) {
    if (cash >= price) return 0;
    return income > 0 ? (price - cash) / income : null;
  }

  // Cash and tap rate change much more often than production. Share the
  // one-item projections between the shop and the Manager, then score them
  // against the current wallet and tap rate each time. Don't retain Max/bulk quantities.
  function adviceSnapshot(state) {
    const snapshot = currentProduction(state);
    // Crossing a cooler's reveal price can change a bundle without changing
    // the actual output of a machine that is already running.
    const coolingOffers = COOLERS.map(c => isRevealed(state, 'cooler', c.id)).join(',');
    if (snapshot.coolingOffers !== coolingOffers) {
      snapshot.coolingOffers = coolingOffers;
      snapshot.singles = new Map();
    }
    return snapshot;
  }

  // This projection reads shared records and timers without changing them.
  function projectPurchase(state, kind, id, count, snapshot) {
    const def = lookup(kind, id);
    if (count === 1 && snapshot.singles.has(def)) return snapshot.singles.get(def);
    const trial = { ...state };
    if (kind === 'machine') trial.machines = { ...state.machines };
    if (kind === 'machine' || kind === 'cooler') trial.coolers = { ...state.coolers };
    if (kind === 'staff') trial.staff = { ...state.staff };
    if (kind === 'upgrade') trial.upgrades = [...state.upgrades];
    const itemCost = bulkCost(state, kind, id, count);
    const steps = Array.from({ length: count }, () => ({ kind, id }));
    let total = itemCost;
    addToInventory(trial, kind, id, count);
    // Machine ownership changes modifiers only when it crosses a milestone
    // (including the last milestone used by Bench Memo).
    const crossedTier = kind === 'machine' && MILESTONES.some(tier =>
      state.machines[id] < tier.count && trial.machines[id] >= tier.count);
    const mod = kind === 'upgrade' || crossedTier ? modifiers(trial) : snapshot.mod;
    let projected = stats(trial, mod);
    if (kind === 'machine' && projected.load > mod.freeLoad) {
      // Only capacity changes as cooling is added; keep the heat, modifiers and
      // per-cooler capacities for the whole bundle, including large Max quotes.
      let capacity = baseCoolingCapacity(trial);
      for (let i = 0; projected.heat / (capacity * mod.coolingMult) > mod.freeLoad && i < COOLING_STEPS_PER_MACHINE * count; i++) {
        const cooler = cheapestCoolerFor(trial, projected);
        if (!cooler) break;
        total += cost(trial, 'cooler', cooler);
        addToInventory(trial, 'cooler', cooler, 1);
        capacity += COOLER_BY_ID[cooler].cooling;
        steps.push({ kind: 'cooler', id: cooler });
      }
      projected = stats(trial, mod);
    }
    const projection = { itemCost, cost: total, steps, projected };
    if (count === 1) snapshot.singles.set(def, projection);
    return projection;
  }

  function purchaseQuote(state, kind, id, count = 1, clicksPerSecond = 0) {
    if (!Number.isInteger(count) || count < 1 || count > CONFIG.maxBulkBuy ||
        ((kind === 'upgrade' || kind === 'staff') && count !== 1) || !availableForAdvice(state, kind, id)) return null;
    const cps = nonNegative(clicksPerSecond);
    const snapshot = adviceSnapshot(state);
    const { itemCost, cost, steps, projected } = projectPurchase(state, kind, id, count, snapshot);
    const gain = earningRate(projected, cps) - earningRate(snapshot.current, cps);
    return { kind, id, count, itemCost, cost, gain, steps: steps.map(step => ({ ...step })), projectedLoad: projected.load,
      paybackSeconds: gain > 1e-9 ? cost / gain : null,
      affordableSeconds: secondsToAfford(itemCost, state.money, snapshot.current.income) };
  }

  // The simulator and shop rank a single purchase by its time to afford plus time to pay back.
  function bestBuy(state, clicksPerSecond = 0) {
    const cps = nonNegative(clicksPerSecond);
    const snapshot = adviceSnapshot(state);
    const base = earningRate(snapshot.current, cps);
    let best = null;
    let bestScore = Infinity;
    for (const { kind, id } of SHOP_ITEMS) {
      if (!availableForAdvice(state, kind, id)) continue;
      // These staff automate purchases rather than directly raising production.
      if (kind === 'staff' && (id === 'sysadmin' || id === 'manager')) {
        const price = cost(state, kind, id);
        if (price <= state.money) return { kind, id, cost: price, gain: 0, paybackSeconds: null, steps: [{ kind, id }] };
        continue;
      }
      const { cost: total, steps, projected } = projectPurchase(state, kind, id, 1, snapshot);
      const gain = earningRate(projected, cps) - base;
      if (!(gain > 1e-9)) continue;
      const paybackSeconds = total / gain;
      const score = Math.max(0, (total - state.money) / Math.max(base, 0.01)) + paybackSeconds;
      if (!best || score < bestScore) {
        best = { kind, id, cost: total, gain, paybackSeconds, steps };
        bestScore = score;
      }
    }
    // Plans are public values; callers may edit or retain them.
    if (best) best.steps = best.steps.map(step => ({ ...step }));
    return best;
  }

  // The welcome screen commits the exact bundle the player saw. Reprice it before
  // touching inventory, in case cooling requirements or a shop price changed.
  function buyRecommendation(state, plan, maxLoad = Infinity) {
    if (!plan || !Array.isArray(plan.steps)) return { ok: false };
    const quote = purchaseQuote(state, plan.kind, plan.id);
    if (!quote || quote.cost !== plan.cost || state.money < quote.cost || quote.projectedLoad >= maxLoad ||
        quote.steps.length !== plan.steps.length || !quote.steps.every((step, i) =>
          step.kind === plan.steps[i]?.kind && step.id === plan.steps[i]?.id)) return { ok: false };
    const purchases = quote.steps.map(({ kind, id }) => ({ kind, id, ...buy(state, kind, id) }));
    return { ok: true, cost: quote.cost, purchases };
  }

  // Live game ticks and the simulator call this after crediting production. Offline catch-up never calls it.
  function runSysadmin(state) {
    if (!state.staff.sysadmin || !state.staff.sysadminEnabled) return [];
    const counts = {};
    let st = stats(state);
    while (st.load > st.freeLoad) {
      const id = cheapestCoolerFor(state, st);
      if (!id || cost(state, 'cooler', id) > state.money * CONFIG.sysadminSpendShare) break;
      if (!buy(state, 'cooler', id).ok) break;
      counts[id] = (counts[id] || 0) + 1;
      state.counters.sysadminPurchases += 1;
      st = stats(state);
    }
    return Object.entries(counts).map(([id, count]) => ({ id, count }));
  }

  function setManagerBudget(state, percent) {
    if (!MANAGER.budgets.includes(percent) || !state.staff.manager) return false;
    state.managerBudget = percent;
    return true;
  }

  function runManager(state, nowMs, clicksPerSecond, live) {
    if (!live || !state.staff.manager || !state.managerEnabled || state.perkChoicePending ||
        !Number.isFinite(nowMs) || nowMs < 0) return [];
    const session = liveSession(state);
    if (state.managerLastPurchase != null && nowMs >= state.managerLastPurchase &&
        nowMs - state.managerLastPurchase < MANAGER.intervalMs) return [];
    if (session.managerCheckedAt != null && nowMs >= session.managerCheckedAt &&
        nowMs - session.managerCheckedAt < MANAGER.intervalMs) return [];
    session.managerCheckedAt = nowMs;
    const plan = bestBuy(state, clicksPerSecond);
    if (!plan || plan.cost > state.money * state.managerBudget / 100) return [];
    if (!buyRecommendation(state, plan, stats(state).fireImmune ? Infinity : FIRE.dangerLoad).ok) return [];
    state.managerLastPurchase = nowMs;
    return [plan];
  }

  // ---------------------------------------------------------------------------
  // Earning
  // ---------------------------------------------------------------------------

  function earn(state, amount) {
    if (state.perkChoicePending || !Number.isFinite(amount) || amount <= 0) return 0;
    state.money += amount;
    state.lifetime += amount;
    state.allTimeEarnings += amount;
    state.records.bestRunEarnings = Math.max(state.records.bestRunEarnings, state.lifetime);
    if (state.challenge) completeChallenge(state);
    return amount;
  }

  // Measure actual hand earnings against passive earnings at the current rate.
  function tappingBoost(taps, nowMs, passiveIncome) {
    if (passiveIncome <= 0) return 0;
    const start = nowMs - CONFIG.tapBoostWindowMs;
    let earned = 0;
    for (const tap of taps) {
      if (tap.at > start && tap.at <= nowMs) earned += tap.amount;
    }
    return earned / (passiveIncome * CONFIG.tapBoostWindowMs / 1000);
  }

  function click(state, now = state.lastTick) {
    if (state.perkChoicePending) return 0;
    const value = stats(state).clickValue;
    earn(state, value);
    state.clicks += 1;
    if (state.counters.bestTapBurst < TAP_BURST_COUNT && Number.isFinite(now)) {
      const taps = liveSession(state).taps;
      if (taps.length) {
        const lastTap = taps[taps.length - 1];
        // An input can arrive before the first timer callback following a suspension.
        const sinceActivity = now - Math.max(lastTap, state.lastTick);
        if (now < lastTap || sinceActivity > CONFIG.eventLiveGapSeconds * 1000) taps.length = 0;
      }
      while (taps.length && now - taps[0] > TAP_BURST_MS) taps.shift();
      taps.push(now);
      state.counters.bestTapBurst = Math.max(state.counters.bestTapBurst, taps.length);
    }
    return value;
  }

  function nextBonusGap(state, rng = Math.random) {
    const seen = state.flags.firstPriorityRequestSeen;
    const min = seen ? BONUS.gapMinSeconds : BONUS.firstGapMinSeconds;
    const max = seen ? BONUS.gapMaxSeconds : BONUS.firstGapMaxSeconds;
    const rate = hasSite(state, 'penthouse') ? RELOCATION.penthouseRequestRate : 1;
    return (min + rng() * (max - min)) * (perkEffect(state, 'vipClients')?.bonusGapMult ?? 1) / rate;
  }

  function markBonusAppeared(state) {
    if (!state.perkChoicePending) state.flags.firstPriorityRequestSeen = true;
  }

  function rollBonusReward(state, st = stats(state), rng = Math.random) {
    let draw = rng() * BONUS.tiers.reduce((total, tier) => total + tier.weight, 0);
    let selected = BONUS.tiers[BONUS.tiers.length - 1];
    for (const tier of BONUS.tiers) {
      draw -= tier.weight;
      if (draw < 0) { selected = tier; break; }
    }
    const amount = Math.max(Math.round(st.income * selected.seconds), Math.ceil(st.clickValue * BONUS.minClickMultiple));
    return { tier: selected.id, amount };
  }

  function claimBonus(state, rng = Math.random) {
    if (state.perkChoicePending) return null;
    const reward = rollBonusReward(state, stats(state), rng);
    earn(state, reward.amount);
    state.counters.bonusesCaught += 1;
    state.counters.bonusCashEarned += reward.amount;
    if (reward.tier === 'jackpot') state.counters.jackpotsCaught += 1;
    return reward;
  }

  function missBonus(state) {
    if (!state.perkChoicePending) state.counters.bonusesMissed += 1;
  }

  function creditProduction(state, rates, seconds) {
    const amount = rates.income * seconds;
    earn(state, amount);
    if (rates.siblingJobsPerSecond) {
      const jobs = state.counters.siblingJobs + rates.siblingJobsPerSecond * seconds;
      // Ten 0.1-second ticks complete a job. Discard floating-point error at whole-job boundaries.
      const whole = Math.round(jobs);
      state.counters.siblingJobs = Math.abs(jobs - whole) <= Number.EPSILON * jobs * 4 ? whole : jobs;
    }
    return amount;
  }

  function formulaEquipmentCost(state, priceState, kit) {
    let total = 0;
    for (const [kind, defs] of [['machine', MACHINES], ['cooler', COOLERS]]) {
      for (const def of defs) {
        const count = ownedCount(state, kind, def.id);
        const free = def.id === 'laptop' ? kit?.laptops : def.id === 'fan' ? kit?.fans : 0;
        for (let n = free || 0; n < count; n++) {
          total += price(def, n, priceState);
          if (!Number.isFinite(total)) return Infinity;
        }
      }
    }
    return total;
  }

  function equipmentBasis(state) {
    if (state.equipmentCost !== undefined) return state.equipmentCost;
    // A pre-fire save has no receipts, but the starting kit's free units are known.
    const kit = !state.fireRunBurned && state.runs > 0 && state.challenge !== 'bootstrapped' ? perkEffect(state, 'starterKit') : null;
    const estimate = formulaEquipmentCost(state, state, kit);
    return Number.isFinite(estimate) ? estimate : 0;
  }

  function fireInsuranceRefund(state) {
    return state.upgrades.includes('insurance') ? equipmentBasis(state) * FIRE.refundFraction : 0;
  }

  function recordFireRebuild(state) {
    if (!state.fireRunBurned) return;
    const rebuilt = machineCount(state);
    state.counters.bestFireRebuild = Math.max(rebuilt, state.counters.bestFireRebuild);
    if (rebuilt >= FIRE.charredUntil) state.fireCharred = false;
  }

  function burnDown(state, notices, elapsed) {
    const machines = machineCount(state);
    const coolers = Object.values(state.coolers).reduce((total, n) => total + n, 0);
    const payout = fireInsuranceRefund(state);
    if (state.goals) rememberFireGoalProgress(state);
    state.machines = zeroCounts(MACHINES);
    state.coolers = zeroCounts(COOLERS);
    state.equipmentCost = 0;
    state.active = null;
    state.fireRisk = 0;
    state.fireAlarmPending = false;
    state.power = POWER.normal;
    state.fireRunBurned = state.fireCharred = true;
    state.flags['fireBurned:' + state.location] = true;
    state.counters.fires++;
    state.money += payout;
    state.runInsurancePaid += payout;
    state.counters.insurancePaid += payout;
    recordRates(state, stats(state));
    notices.push({ type: 'fire', elapsed, location: state.location, machines, coolers, payout });
  }

  function preAlarmSeconds(load) {
    const fraction = Math.min(1, Math.max(0, (load - FIRE.dangerLoad) / (FIRE.extremeLoad - FIRE.dangerLoad)));
    return FIRE.dangerSeconds + fraction * (FIRE.extremeSeconds - FIRE.dangerSeconds) - FIRE.alarmSeconds;
  }

  function fireStatus(state, st = stats(state)) {
    const risk = state.fireRisk;
    const stage = risk >= FIRE.alarmRisk ? 'alarm' : risk >= FIRE.smokeRisk ? 'smoke' : risk > 0 ? 'warming' : 'clear';
    let secondsToFire = null;
    if (!st.fireImmune && st.load >= FIRE.dangerLoad) {
      secondsToFire = risk >= FIRE.alarmRisk ? (1 - risk) * FIRE.alarmSeconds / (1 - FIRE.alarmRisk)
        : (FIRE.alarmRisk - risk) * preAlarmSeconds(st.load) / FIRE.alarmRisk + FIRE.alarmSeconds;
    }
    return { risk, stage, secondsToFire, graceSeconds: state[LIVE_SESSION]?.fireGraceSeconds || 0, charred: state.fireCharred };
  }

  // Advance a constant-load segment. Smoke and alarm leave earnings unchanged.
  // Only the destruction boundary requires splitting production into two rates.
  function fireBoundary(state, seconds, load, notices, started) {
    const session = state[LIVE_SESSION];
    const grace = Math.min(seconds, session?.fireGraceSeconds || 0);
    if (grace) session.fireGraceSeconds -= grace;
    let left = seconds - grace;
    if (left <= 0) return null;
    if (load < FIRE.dangerLoad) {
      const previous = state.fireRisk;
      const cooled = Math.max(0, previous - left / FIRE.decaySeconds);
      // Several short frames can end the same interval a few ulps below a stage boundary.
      if (Math.abs(cooled - FIRE.smokeRisk) <= 1e-12) state.fireRisk = FIRE.smokeRisk;
      else if (Math.abs(cooled - FIRE.alarmRisk) <= 1e-12) state.fireRisk = FIRE.alarmRisk;
      else state.fireRisk = cooled < 1e-12 ? 0 : cooled;
      if (state.fireAlarmPending && state.fireRisk < FIRE.smokeRisk) {
        state.fireAlarmPending = false;
        state.counters.alarmsSurvived++;
        notices.push({ type: 'fire-survived', location: state.location,
          elapsed: started + grace + Math.max(0, previous - FIRE.smokeRisk) * FIRE.decaySeconds });
      }
      return null;
    }
    for (const threshold of [FIRE.smokeRisk, FIRE.alarmRisk, 1]) {
      if (state.fireRisk >= threshold && threshold !== 1) continue;
      const rise = threshold === 1 ? (1 - FIRE.alarmRisk) / FIRE.alarmSeconds : FIRE.alarmRisk / preAlarmSeconds(load);
      const needed = (threshold - state.fireRisk) / rise;
      if (needed > left + 1e-9) {
        state.fireRisk += left * rise;
        break;
      }
      left = Math.max(0, left - needed);
      state.fireRisk = threshold;
      const offset = seconds - left;
      if (threshold === 1) return offset;
      if (threshold === FIRE.smokeRisk) state.flags.fireSmokeSeen = true;
      else {
        state.flags.fireAlarmSeen = true;
        state.fireAlarmPending = true;
      }
      notices.push({ type: threshold === FIRE.smokeRisk ? 'fire-smoke' : 'fire-alarm',
        location: state.location, elapsed: started + offset });
    }
    return null;
  }

  function creditFireInterval(state, seconds, playing, notices, started, pay) {
    if (!(seconds > 0)) return;
    const st = stats(state);
    // The Dome's reward can immediately cool throttled machines or clear fire danger.
    // Split a long interval at the first legal sale, just as we split at a fire.
    if (state.challenge === 'heat-dome' && !state.challengeRewards.includes(state.challenge) &&
        state.location !== 'basement' && st.income > 0) {
      const nextStar = (state.stars + 1) ** 2 * PRESTIGE.divisor;
      const needed = Math.max(PRESTIGE.unlockLifetime - state.lifetime, nextStar - state.allTimeEarnings);
      const untilReward = needed / st.income;
      if (untilReward > 0 && untilReward < seconds) {
        creditUntilFire(state, st, untilReward, playing, notices, started, pay);
        creditUntilFire(state, stats(state), seconds - untilReward, playing, notices, started + untilReward, pay);
        return;
      }
    }
    creditUntilFire(state, st, seconds, playing, notices, started, pay);
  }

  function creditUntilFire(state, st, seconds, playing, notices, started, pay) {
    const boundary = playing && !st.fireImmune ? fireBoundary(state, seconds, st.load, notices, started) : null;
    if (boundary === null) {
      pay(st, seconds);
      return;
    }
    if (boundary > 0) pay(st, boundary);
    burnDown(state, notices, started + boundary);
    if (seconds > boundary) pay(stats(state), seconds - boundary);
  }

  // One clock covers the active boost and its following cooldown. Both keep
  // ticking through an absence, including the part beyond the offline pay cap.
  function overtimeStatus(state) {
    const wait = state.overtimeWaitSeconds || 0;
    return { activeSeconds: Math.max(0, wait - REWARDS.cooldownSeconds),
      cooldownSeconds: Math.min(wait, REWARDS.cooldownSeconds), available: overtimeCycleSeconds > 0 && !state.perkChoicePending && wait === 0 };
  }

  function startOvertime(state) {
    if (!overtimeStatus(state).available) return false;
    state.overtimeWaitSeconds = overtimeCycleSeconds;
    state.counters.overtimeBoosts++;
    return true;
  }

  function ageOvertime(state, seconds) {
    if (!state.overtimeWaitSeconds || !(seconds > 0)) return;
    const wait = Math.round((state.overtimeWaitSeconds - seconds) * 1000) / 1000;
    if (wait > 0) state.overtimeWaitSeconds = wait;
    else delete state.overtimeWaitSeconds;
  }

  function creditOvertimeInterval(state, seconds, credit) {
    if (!state.overtimeWaitSeconds) { credit(seconds, 0); return; }
    const boosted = Math.min(seconds, overtimeStatus(state).activeSeconds);
    if (boosted > 0) {
      credit(boosted, 0);
      ageOvertime(state, boosted);
    }
    if (seconds > boosted) {
      credit(seconds - boosted, boosted);
      ageOvertime(state, seconds - boosted);
    }
  }

  // A return ticket belongs to this particular state and absence. The screen
  // keeps the original report; copying or changing its fields cannot mint money.
  const offlineTickets = new WeakMap();
  function canDoubleOffline(state, report) {
    const ticket = offlineTickets.get(state);
    return !!ticket && ticket.report === report && !state.perkChoicePending;
  }
  function doubleOffline(state, report) {
    if (!canDoubleOffline(state, report)) return 0;
    const { extra } = offlineTickets.get(state);
    offlineTickets.delete(state);
    earn(state, extra);
    return extra;
  }

  // Run the machines and staff for `seconds`. Income is constant between purchases.
  function advance(state, seconds, { live = false, notices = [] } = {}) {
    if (state.perkChoicePending || !(seconds > 0)) return 0;
    const playing = live && seconds <= CONFIG.eventLiveGapSeconds;
    if (!playing) liveSession(state).fireGraceSeconds = FIRE.graceSeconds;
    let earned = 0;
    const pay = (st, duration) => {
      recordRates(state, st);
      advancePowerStreak(state, playing ? st : null, duration);
      if (state.goals) updateGoalHeat(state, playing ? st : null, duration);
      earned += creditProduction(state, st, duration);
      if (state.contract) advanceContract(state, st, duration, notices);
    };
    creditOvertimeInterval(state, seconds, (duration, offset) => {
      creditFireInterval(state, duration, playing, notices, offset, pay);
    });
    return earned;
  }

  /*
   * Credit production for the time since lastTick, then move lastTick to now.
   * Used every frame while playing AND when the page reopens (offline progress).
   * Long gaps are capped by the installed backup power. A clock that went backwards credits nothing.
   *
   * Existing offers and effects age in real time. Only short, visible intervals can start offers
   * or apply an ignored heat wave. A modal can veto a new offer with allowSpawn: false.
   */
  function catchUp(state, now, { live = true, allowSpawn = true, countLive = live, rng = Math.random } = {}) {
    if (state.perkChoicePending) {
      ageOvertime(state, (now - state.lastTick) / 1000);
      state.lastTick = now;
      return { seconds: 0, credited: 0, earned: 0, siblingJobs: 0, capped: false, offlineCapSeconds: offlineCapSeconds(state), throttle: 1, notices: [] };
    }
    const seconds = Math.max(0, (now - state.lastTick) / 1000);
    const watching = live && seconds <= CONFIG.eventLiveGapSeconds;
    const playing = watching && countLive && now >= state.lastTick;
    if (!playing) liveSession(state).fireGraceSeconds = FIRE.graceSeconds;
    if (!playing && state.goals) updateGoalHeat(state, null, 0);
    if (playing) {
      state.counters.liveSeconds += seconds;
    } else if (state[LIVE_SESSION]) {
      state[LIVE_SESSION].taps.length = 0;
      state[LIVE_SESSION].heatSeconds = 0;
      state[LIVE_SESSION].powerSeconds = 0;
    }
    if (!watching) state.counters.longestAbsenceSeconds = Math.max(state.counters.longestAbsenceSeconds, seconds);
    const priorJobs = Math.floor(state.counters.siblingJobs);
    const cap = offlineCapSeconds(state);
    const credited = Math.min(seconds, cap);
    let creditLeft = credited;
    let earned = 0;
    let throttleSeconds = 0;
    const notices = [];
    function pay(rates, paid) {
      recordRates(state, rates);
      if (playing) advancePowerStreak(state, rates, paid);
      if (playing && state.goals) updateGoalHeat(state, rates, paid);
      if (playing && inHeatBand(rates)) {
        const session = liveSession(state);
        session.heatSeconds = Math.round((session.heatSeconds + paid) * 1000) / 1000;
        state.counters.longestHeatStreakSeconds = Math.max(state.counters.longestHeatStreakSeconds, session.heatSeconds);
      }
      earned += creditProduction(state, rates, paid);
      throttleSeconds += rates.throttle * paid;
      if (state.contract) advanceContract(state, rates, paid, notices);
    }
    function creditSegment(duration) {
      const paid = Math.min(creditLeft, duration);
      creditFireInterval(state, paid, playing, notices, credited - creditLeft, pay);
      creditLeft -= paid;
    }
    tickEvents(state, seconds, rng, { watching, allowSpawn, notices,
      creditSegment: duration => creditOvertimeInterval(state, duration, creditSegment) });
    if (!credited || notices.length) recordRates(state, stats(state));
    const throttle = credited > 0 ? throttleSeconds / credited : stats(state).throttle;
    state.lastTick = now;
    const siblingJobs = Math.floor(state.counters.siblingJobs) - priorJobs;
    const report = { seconds, credited, earned, siblingJobs, capped: seconds > cap, offlineCapSeconds: cap, throttle, notices };
    if (!watching && seconds >= REWARDS.offlineMinSeconds) {
      if (earned > 0) offlineTickets.set(state, { report, extra: earned * (REWARDS.offlineMultiplier - 1) });
      else offlineTickets.delete(state);
    }
    return report;
  }

  // ---------------------------------------------------------------------------
  // Client contracts
  // ---------------------------------------------------------------------------

  function contractUnlockKey(state, def) {
    if (state.counters.machinesBought < CONTRACT_RULES.unlockMachinesBought && !state.contract) return 'machines';
    if (def.unlock === 'overheat' && !hasPowerHistory(state)) return 'overheat';
    if (def.unlock === 'rack' && !state.machines.rack) return 'rack';
    if (def.unlock === 'gpu' && !state.machines.gpu) return 'gpu';
    return null;
  }

  // Terms are quoted from current production and locked when the contract is signed.
  function contractTerms(def, st) {
    const terms = { durationSeconds: def.durationSeconds, reward: Math.max(1, Math.round(st.income * def.rewardSeconds)) };
    if (def.requirement === 'income') terms.target = Math.floor(st.machineIncome * def.incomeShare * 100) / 100;
    if (def.requirement === 'capacity') terms.target = Math.ceil(st.machineIncome * def.capacityGrowth * 100) / 100;
    return terms;
  }

  function contractOffers(state, st = stats(state)) {
    return CONTRACTS.map(def => {
      const lock = contractUnlockKey(state, def);
      const available = !lock && !state.perkChoicePending && st.machineIncome > 0;
      return { id: def.id, def, lock, lockText: lock ? CONTRACT_UNLOCK_TEXT[lock] : '', available,
        ...(available ? contractTerms(def, st) : {}) };
    });
  }

  // Whether the signed contract's requirement holds at these production rates.
  function contractRequirement(contract, st) {
    const def = CONTRACT_BY_ID.get(contract.id);
    const running = st.machineIncome > 0;
    switch (def.requirement) {
      case 'income': case 'capacity':
        return { met: running && st.machineIncome >= contract.target, value: st.machineIncome, need: contract.target };
      case 'headroom':
        return { met: running && st.load <= def.maxLoad + 1e-9, value: st.load, need: def.maxLoad };
      default:
        return { met: running && st.power >= def.minPower - 1e-9 && st.throttle >= 1, value: st.power, need: def.minPower,
          throttle: st.throttle };
    }
  }

  function signContract(state, id) {
    if (state.contract) return { ok: false, reason: 'busy' };
    const offer = contractOffers(state).find(entry => entry.id === id);
    if (!offer) return { ok: false, reason: 'unknown' };
    if (!offer.available) return { ok: false, reason: offer.lock || 'unavailable' };
    state.contract = { id, reward: offer.reward, durationSeconds: offer.durationSeconds, progress: 0 };
    if (offer.target !== undefined) state.contract.target = offer.target;
    return { ok: true, contract: { ...state.contract } };
  }

  function endContract(state) {
    if (!state.contract) return { ok: false, reason: 'none' };
    const contract = state.contract;
    delete state.contract;
    return { ok: true, contract };
  }

  function advanceContract(state, st, seconds, notices) {
    const contract = state.contract;
    if (!(seconds > 0) || !contractRequirement(contract, st).met) return;
    contract.progress = Math.min(contract.durationSeconds, contract.progress + seconds);
    if (contract.progress < contract.durationSeconds - 1e-9) return;
    delete state.contract;
    const paid = earn(state, contract.reward);
    state.counters.contractsCompleted += 1;
    state.counters.contractCashEarned += paid;
    notices.push({ type: 'contract-complete', id: contract.id, reward: paid });
  }

  // Everything the board needs about the signed contract right now.
  function contractStatus(state, st = stats(state)) {
    const contract = state.contract;
    if (!contract) return null;
    const def = CONTRACT_BY_ID.get(contract.id);
    const requirement = contractRequirement(contract, st);
    return { id: contract.id, def, contract: { ...contract }, ...requirement,
      progress: contract.progress / contract.durationSeconds,
      remainingSeconds: Math.max(0, contract.durationSeconds - contract.progress) };
  }

  function restoreContract(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !CONTRACT_BY_ID.has(raw.id)) return null;
    const def = CONTRACT_BY_ID.get(raw.id);
    const { reward, durationSeconds, progress, target } = raw;
    if (!Number.isFinite(reward) || reward <= 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0 ||
        durationSeconds > 24 * 3600 || !Number.isFinite(progress) || progress < 0 || progress >= durationSeconds) return null;
    const contract = { id: def.id, reward, durationSeconds, progress };
    if (def.requirement === 'income' || def.requirement === 'capacity') {
      if (!Number.isFinite(target) || target < 0) return null;
      contract.target = target;
    }
    return contract;
  }

  // ---------------------------------------------------------------------------
  // Incidents
  // ---------------------------------------------------------------------------

  function machineCount(state) {
    let n = 0;
    for (const m of MACHINES) n += state.machines[m.id] || 0;
    return n;
  }

  // The outcome whose temporary effect is running right now, if any.
  function activeOutcome(state) {
    if (!state.active) return null;
    const def = EVENT_BY_ID[state.active.id];
    return def ? def[state.active.side] : null;
  }

  function clearIncidents(state) {
    state.event = null;
    state.active = null;
  }

  function nextGap(rng) {
    return CONFIG.eventGapMinSeconds + rng() * (CONFIG.eventGapMaxSeconds - CONFIG.eventGapMinSeconds);
  }

  // Your most advanced machine type (the free one in a liquidation sale).
  function bestOwnedMachine(state) {
    for (let i = MACHINES.length - 1; i >= 0; i--) {
      if (state.machines[MACHINES[i].id] > 0) return MACHINES[i].id;
    }
    return null;
  }

  // Offer an incident now. forceId picks a specific one (for testing and the console helper).
  function startEvent(state, rng, forceId) {
    if (state.perkChoicePending) return null;
    if (state.event || state.active) return null;
    const pool = forceId
      ? EVENTS.filter((e) => e.id === forceId)
      : EVENTS.filter((e) => machineCount(state) >= e.minMachines);
    if (!pool.length) return null;
    const def = pool[Math.min(pool.length - 1, Math.floor((rng || Math.random)() * pool.length))];
    const income = stats(state).income;
    const ev = { id: def.id, remaining: CONFIG.eventOfferSeconds };
    const a = def.accept;
    if (a.cashSeconds) ev.cash = Math.max(a.minCash, Math.round(income * a.cashSeconds));
    if (a.costSeconds) ev.price = Math.max(a.minCost, Math.ceil(income * a.costSeconds));
    if (a.freeMachine) {
      ev.machineId = bestOwnedMachine(state);
      if (!ev.machineId) return null;
    }
    state.event = ev;
    // Reserve the cooldown now. It starts counting down after the offer and its effect finish.
    state.nextEventIn = nextGap(rng || Math.random);
    return ev;
  }

  // Answer the current incident. Returns { ok, choice, event, outcome } or { ok: false, reason }.
  function respondToEvent(state, choice) {
    const ev = state.event;
    if (!ev) return { ok: false, reason: 'none' };
    const def = EVENT_BY_ID[ev.id];
    if (choice !== 'accept' && choice !== 'decline') return { ok: false, reason: 'unknown' };
    const outcome = def[choice];
    if (choice === 'accept') {
      if (ev.price != null) {
        if (state.money < ev.price) return { ok: false, reason: 'poor' };
        state.money -= ev.price;
      }
      if (ev.cash) earn(state, ev.cash);
      if (ev.machineId) {
        state.equipmentCost = equipmentBasis(state);
        state.machines[ev.machineId] += 1;
        recordFireRebuild(state);
      }
    }
    if (choice === 'accept') state.counters.incidentsAccepted += 1;
    else state.counters.incidentsDeclined += 1;
    state.event = null;
    if (outcome.duration) state.active = { id: def.id, side: choice, remaining: outcome.duration };
    recordRates(state, stats(state));
    return { ok: true, choice, event: ev, outcome, def };
  }

  // Credit time on each side of a transition at the rate in effect for that part of the interval.
  function tickEvents(state, seconds, rng = Math.random, {
    watching = true, allowSpawn = true, creditSegment = () => {}, notices = [],
  } = {}) {
    if (state.perkChoicePending) return [];
    let left = seconds;
    function elapse(phase) {
      const duration = Math.min(left, phase.remaining);
      creditSegment(duration);
      // lastTick is measured in milliseconds. Keep matching precision across repeated 100ms frames.
      left = Math.round((left - duration) * 1000) / 1000;
      phase.remaining = Math.round((phase.remaining - duration) * 1000) / 1000;
    }
    if (state.event) {
      elapse(state.event);
      if (state.event.remaining <= 0) {
        const id = state.event.id;
        const result = watching ? respondToEvent(state, 'decline') : null;
        if (!watching) state.counters.incidentsDeclined += 1;
        state.event = null;
        notices.push({ type: 'expired', id, away: !watching, result });
      }
    }
    if (state.active) {
      elapse(state.active);
      if (state.active && state.active.remaining <= 0) {
        if (state.active.id === 'heatwave' && state.active.side === 'decline') state.counters.heatWavesSurvived += 1;
        notices.push({ type: 'ended', id: state.active.id, side: state.active.side, away: !watching });
        state.active = null;
      }
    }
    creditSegment(left);
    if (!watching) {
      state.nextEventIn = Math.max(state.nextEventIn, CONFIG.eventReturnGraceSeconds);
    } else if (allowSpawn && left > 0 && !state.event && !state.active) {
      state.nextEventIn = Math.max(0, state.nextEventIn - left);
      if (state.nextEventIn === 0 && machineCount(state) >= CONFIG.eventMinMachines) {
        const ev = startEvent(state, rng);
        if (ev) notices.push({ type: 'offer', event: ev });
      }
    }
    return notices;
  }

  // ---------------------------------------------------------------------------
  // Milestone: moving out
  // ---------------------------------------------------------------------------

  function moveProgress(state) {
    const next = nextStage(state);
    return next ? Math.min(1, state.lifetime / next.target) : 1;
  }

  function canMove(state) {
    const next = nextStage(state);
    return !state.perkChoicePending && !!next && state.lifetime >= next.target;
  }

  function moveTo(state, destination, now = state.lastTick, extra = null) {
    if (!canMove(state)) return { ok: false, reason: nextStage(state) ? 'poor' : 'moved' };
    if (!moveDestinations(state).includes(destination)) return { ok: false, reason: 'unknown' };
    const choices = franchiseChoices(state, destination);
    if (choices.length ? !choices.includes(extra) : extra !== null) return { ok: false, reason: 'extra-location' };
    // A legacy inventory lacks purchase receipts. Preserve its pre-move valuation
    // before a change of location can change the prices used in reconstruction.
    if (state.equipmentCost === undefined && (machineCount(state) || Object.values(state.coolers).some(Boolean))) {
      state.equipmentCost = equipmentBasis(state);
    }
    const first = currentStage(state) === 1;
    state.sites = [...runSites(state), destination];
    state.location = destination;
    if (first) state.extraLocation = extra;
    const freeHires = [];
    if (destination === 'bunker' && state.challenge !== 'bootstrapped') {
      for (const id of RELOCATION.bunkerHires) {
        if (state.staff[id]) continue;
        addToInventory(state, 'staff', id, 1);
        freeHires.push(id);
      }
    }
    if (destination === 'penthouse' && Number.isFinite(state.priorityWaitSeconds)) {
      state.priorityWaitSeconds /= RELOCATION.penthouseRequestRate;
    }
    if (LOCATIONS[destination].effect.fireImmune) {
      state.fireRisk = 0;
      state.fireAlarmPending = false;
    }
    if (state.challenge) completeChallenge(state);
    if (destination === 'mall') state.flags.movedToMall = true;
    refreshDecor(state);
    if (first && Number.isFinite(now) && Number.isFinite(state.runStartedAt) && now >= state.runStartedAt) {
      state.counters.timeToMove = (now - state.runStartedAt) / 1000;
      state.counters.moveTimeRecorded = 1;
      state.records.fastestMoveSeconds = Math.min(state.records.fastestMoveSeconds ?? Infinity, state.counters.timeToMove);
    } else if (first) {
      state.counters.timeToMove = 0;
      state.counters.moveTimeRecorded = 0;
    }
    recordRates(state, stats(state));
    return freeHires.length ? { ok: true, freeHires } : { ok: true };
  }

  function starsForEarnings(all) {
    return Math.floor(Math.sqrt(nonNegative(all) / PRESTIGE.divisor));
  }

  function pendingStars(state) {
    return Math.max(0, starsForEarnings(state.allTimeEarnings) - state.stars);
  }

  function nextStarAt(state) {
    const next = Math.max(state.stars, starsForEarnings(state.allTimeEarnings)) + 1;
    return next * next * PRESTIGE.divisor;
  }

  function reputationMultiplier(state, stars = state.stars) {
    return 1 + stars * (perkEffect(state, 'angelInvestors')?.bonusPerStar ?? PRESTIGE.bonusPerStar);
  }

  function runReputationMultiplier(state) {
    const full = reputationMultiplier(state);
    return state.challenge === 'bootstrapped' ? 1 + (full - 1) * BOARD_RULES.bootstrappedInvestorShare : full;
  }

  const firstRepeatStars = LATE_PERKS.dividendTier * LATE_PERKS.repeatStep;
  function nextPerkTier(state) {
    const fixed = PERK_TIERS.find(tier => !state.perks[tier.stars]);
    if (fixed) return fixed;
    let stars = firstRepeatStars;
    while (Number.isFinite(stars) && state.perks[stars]) stars *= LATE_PERKS.repeatStep;
    return Number.isFinite(stars) ? { stars, options: REPEAT_PERKS, repeatable: true } : null;
  }

  function repeatPerkCounts(state) {
    const result = { income: 0, tap: 0 };
    for (let stars = firstRepeatStars; stars <= state.stars; stars *= LATE_PERKS.repeatStep) {
      const id = state.perks[stars];
      if (id === 'incomeDividend') result.income++;
      else if (id === 'tapDividend') result.tap++;
      else break;
    }
    return result;
  }

  function nextPerkOffer(state) {
    if (!state.perkChoicePending) return null;
    const tier = nextPerkTier(state);
    return tier && tier.stars <= state.stars ? tier : null;
  }

  function runStartCash(state) {
    return state.runStartingCash;
  }

  function runSummary(state, now = state.lastTick) {
    let durationSeconds = null;
    if (state.perkChoicePending) durationSeconds = 0;
    else if (state.runStartedAt !== null) durationSeconds = Math.max(0, (now - state.runStartedAt) / 1000);
    return { durationSeconds, earnings: state.lifetime, machines: machineCount(state),
      bestIncome: Math.max(state.runBestIncome, stats(state).income), location: state.location };
  }

  // Only called once, at the sale or after its last outstanding choice. Never replay grants on load.
  function startNextRun(state, now) {
    ageOvertime(state, (now - state.lastTick) / 1000);
    const grants = state.challenge !== 'bootstrapped';
    const kit = grants && perkEffect(state, 'starterKit');
    if (kit) {
      state.equipmentCost = 0;
      state.machines.laptop = kit.laptops;
      state.coolers.fan = kit.fans;
      if (kit.macros) state.upgrades.push('macros');
    }
    state.runStartingCash = grants ? kit?.cash ?? perkEffect(state, 'seedFunding')?.cash ?? 0 : 0;
    state.money = state.runStartingCash;
    state.staff.sibling = grants ? perkEffect(state, 'familyBusiness')?.sibling ?? 0 : 0;
    state.staff.sysadmin = grants ? perkEffect(state, 'itRetainer')?.sysadmin ?? 0 : 0;
    state.perkChoicePending = false;
    state.runStartedAt = state.lastTick = now;
    recordRates(state, stats(state));
  }

  function pickPerk(state, id, now = state.lastTick) {
    const offer = nextPerkOffer(state);
    if (!offer || !offer.options.some(option => option.id === id)) return { ok: false, reason: 'unavailable' };
    if (!Number.isFinite(now) || now < 0) return { ok: false, reason: 'time' };
    state.perks[offer.stars] = id;
    const started = !nextPerkOffer(state);
    if (started) startNextRun(state, now);
    return { ok: true, started };
  }

  function saleBlocker(state) {
    if (state.location === 'basement') return 'basement';
    if (state.lifetime < PRESTIGE.unlockLifetime) return 'earnings';
    if (pendingStars(state) < 1) return 'no-gain';
    return null;
  }

  function canSell(state) {
    return saleBlocker(state) === null;
  }

  function challengeStatus(state, id) {
    if (!CHALLENGE_BY_ID.has(id) || state.stars < BOARD_STARS) return 'locked';
    if (state.challengeRewards.includes(id)) return 'completed';
    return state.challenge === id ? 'active' : 'available';
  }

  function completeChallenge(state) {
    if (!state.challenge || challengeStatus(state, state.challenge) !== 'active' || !canSell(state)) return false;
    state.challengeRewards.push(state.challenge);
    return true;
  }

  function abandonChallenge(state) {
    if (!state.challenge || state.challengeRewards.includes(state.challenge)) return false;
    state.challenge = null;
    return true;
  }

  function goalStrip(state) {
    const stage = nextStage(state);
    const first = currentStage(state) === 1;
    const gained = first ? 0 : pendingStars(state);
    const next = first ? null : nextStarAt(state);
    const sellable = canSell(state);
    const double = (state.stars * 2) ** 2 * PRESTIGE.divisor;
    if (stage) {
      return { phase: first ? 'move' : 'expand', current: state.lifetime, target: stage.target,
        progress: moveProgress(state), ready: canMove(state), canSell: sellable, pendingStars: gained,
        nextStarAt: next, doubleAt: sellable && double > next ? double : null };
    }
    if (!sellable) {
      // Later runs may fill the earnings bar before the next all-time star.
      const target = PRESTIGE.unlockLifetime;
      return { phase: 'sell', current: state.lifetime, target, progress: Math.min(1, state.lifetime / target),
        ready: false, canSell: false, pendingStars: gained, nextStarAt: next, doubleAt: null };
    }
    const current = state.allTimeEarnings;
    const previous = starsForEarnings(current) ** 2 * PRESTIGE.divisor;
    return { phase: 'ready', current, target: next, progress: (current - previous) / (next - previous),
      ready: true, canSell: true, pendingStars: gained, nextStarAt: next, doubleAt: double > next ? double : null };
  }

  function sellStartup(state, now = state.lastTick, nextChallenge = null) {
    const reason = saleBlocker(state);
    if (reason) return { ok: false, reason };
    if (!Number.isFinite(now) || now < 0) return { ok: false, reason: 'time' };
    const gained = pendingStars(state);
    const stars = state.stars + gained;
    if (nextChallenge !== null && (!CHALLENGE_BY_ID.has(nextChallenge) || stars < BOARD_STARS ||
        state.challenge === nextChallenge || state.challengeRewards.includes(nextChallenge))) {
      return { ok: false, reason: 'challenge' };
    }
    completeChallenge(state);
    // A sale can happen before the first-visit story gets a chance to set its flag.
    // Keep the physical route as evidence for validating those souvenirs after a sale.
    for (const site of runSites(state).slice(1)) state.flags['visited:' + site] = true;
    refreshDecor(state);
    const keep = {
      challenge: nextChallenge, challengeRewards: state.challengeRewards,
      stars, runs: state.runs + 1, allTimeEarnings: state.allTimeEarnings, perks: state.perks,
      clicks: state.clicks, startedAt: state.startedAt, flags: state.flags,
      counters: state.counters, achievements: state.achievements, records: state.records, decor: state.decor,
    };
    // The paid-for boost and cooldown span sales; the preceding run's return ticket does not.
    offlineTickets.delete(state);
    Object.assign(state, newState(now), keep);
    delete state.equipmentCost;
    delete state.managerLastPurchase;
    if (state[LIVE_SESSION]) state[LIVE_SESSION].fireGraceSeconds = 0;
    delete state.goals;
    delete state.contract;
    delete state.priorityWaitSeconds;
    delete state.priorityWasFlying;
    if (state[LIVE_SESSION]) {
      delete state[LIVE_SESSION].managerCheckedAt;
      state[LIVE_SESSION].taps.length = 0;
      state[LIVE_SESSION].heatSeconds = 0;
      state[LIVE_SESSION].powerSeconds = 0;
    }
    state.perkChoicePending = true;
    if (!nextPerkOffer(state)) startNextRun(state, now);
    refreshDecor(state);
    return { ok: true, gained, stars };
  }

  // Short goals compare current run facts with a snapshot taken when the slot was filled.
  function goalFact(state, slot) {
    switch (slot.kind) {
      case 'machine': case 'milestone': return state.machines[slot.machine];
      case 'earnings': return state.lifetime;
      case 'priority': return state.counters.bonusesCaught;
      case 'jobs': return state.clicks;
      case 'upgrade': return Number(state.upgrades.includes(slot.upgrade));
      case 'incident': return state.counters.incidentsAccepted;
      case 'heat': return slot.streak;
      case 'move': return currentStage(state) - 1;
    }
  }

  function goalProgress(state, slot) {
    return Math.min(slot.target, Math.max(slot.progressBeforeFire || 0, goalFact(state, slot) - slot.start));
  }

  function rememberFireGoalProgress(state) {
    for (const slot of state.goals?.slots || []) {
      if (slot?.kind === 'machine' || slot?.kind === 'milestone') {
        slot.progressBeforeFire = goalProgress(state, slot);
      }
    }
  }

  function updateGoalHeat(state, rates, seconds) {
    const slot = state.goals.slots.find(g => g?.kind === 'heat');
    if (!slot || slot.streak >= slot.target) return;
    slot.streak = rates && rates.load >= GOALS.heatMin && rates.load <= GOALS.heatMax
      ? Math.min(slot.target, Math.round((slot.streak + seconds) * 1000) / 1000) : 0;
  }

  function goalCandidates(state) {
    const rates = stats(state);
    const pace = rates.income + rates.clickValue * GOALS.sizingClicksPerSecond;
    // A first laptop understates what the next few purchases will earn. Use a
    // modest opening budget, then scale with the player's present equipment.
    const earnTarget = Math.max(GOALS.minimumEarnings, Math.ceil(pace * GOALS.sizingSeconds));
    const minBudget = state.money + earnTarget * GOALS.minSizingSeconds / GOALS.sizingSeconds;
    const budget = state.money + earnTarget;
    const maxBudget = state.money + earnTarget * GOALS.maxSizingSeconds / GOALS.sizingSeconds;
    const candidates = [];
    function add(kind, target, details) {
      const slot = { kind, target, ...details };
      if (kind === 'heat') slot.streak = 0;
      slot.start = goalFact(state, slot);
      candidates.push(slot);
    }
    for (const m of MACHINES) {
      if (!isRevealed(state, 'machine', m.id) || !meetsRequirements(state, m)) continue;
      const owned = state.machines[m.id];
      let total = 0, units = 0;
      while (units < CONFIG.maxBulkBuy) {
        const next = price(m, owned + units, state);
        if (total + next > budget) break;
        total += next;
        units++;
      }
      if (units && total >= minBudget) add('machine', units, { machine: m.id });
      const next = nextMilestone(owned);
      if (next) {
        const cost = bulkCost(state, 'machine', m.id, next.count - owned);
        if (cost >= minBudget && cost <= maxBudget) add('milestone', next.count - owned, { machine: m.id });
      }
    }
    add('earnings', earnTarget);
    if (machineCount(state)) add('priority', 1);
    add('jobs', GOALS.handJobs);
    for (const u of UPGRADES) {
      if (!state.upgrades.includes(u.id) && isRevealed(state, 'upgrade', u.id) && meetsRequirements(state, u) &&
          u.cost >= minBudget && u.cost <= maxBudget) add('upgrade', 1, { upgrade: u.id });
    }
    if (state.event || machineCount(state) >= CONFIG.eventMinMachines) add('incident', 1);
    if (rates.load >= GOALS.heatMin && rates.load <= GOALS.heatMax &&
        (!state.active || state.active.remaining >= GOALS.heatSeconds)) add('heat', GOALS.heatSeconds);
    const stage = nextStage(state);
    if (stage && !canMove(state) && state.lifetime >= stage.target * GOALS.closeToMove &&
        stage.target - state.lifetime <= earnTarget * GOALS.maxSizingSeconds / GOALS.sizingSeconds) add('move', 1);
    return candidates;
  }

  function drawGoal(state, candidates, rng, previous, swapping = false) {
    const board = state.goals;
    const otherSlots = board.slots.filter(g => g && g !== previous);
    const otherKinds = new Set(otherSlots.map(g => g.kind));
    const reservedMachines = new Set(otherSlots.filter(g => g.machine).map(g => g.machine));
    const available = candidates.filter(g => !otherKinds.has(g.kind) && !reservedMachines.has(g.machine));
    const alternatives = available.filter(g => g.kind !== previous?.kind || g.machine !== previous.machine || g.upgrade !== previous.upgrade);
    if (swapping && !alternatives.length) return null;
    const choices = alternatives.length ? alternatives : available;
    if (!choices.length) return null;
    const pick = list => list[Math.min(list.length - 1, Math.max(0, Math.floor(rng() * list.length)))];
    const kind = pick([...new Set(choices.map(g => g.kind))]);
    const options = choices.filter(g => g.kind === kind);
    const selected = options.length === 1 ? options[0] : pick(options);
    return { ...selected, id: state.runs + ':' + ++board.serial };
  }

  function ensureGoals(state, rng = Math.random) {
    if (state.perkChoicePending || (!state.machines.laptop && !state.goals)) return;
    const board = state.goals ??= { serial: 0, slots: Array(GOALS.slots).fill(null), lastSwapAt: null };
    if (board.slots.every(Boolean)) return;
    const candidates = goalCandidates(state);
    for (let i = 0; i < board.slots.length; i++) {
      if (!board.slots[i]) board.slots[i] = drawGoal(state, candidates, rng);
    }
  }

  function goalTitle(slot) {
    const name = slot.machine && MACHINE_BY_ID[slot.machine].name;
    switch (slot.kind) {
      case 'machine': return `Own ${slot.target} more ${name}${slot.target === 1 ? '' : 's'}`;
      case 'earnings': return `Earn another ${formatMoney(slot.target)} this run`;
      case 'priority': return 'Catch a priority request';
      case 'jobs': return `Run ${slot.target} jobs by hand`;
      case 'upgrade': return `Buy ${UPGRADE_BY_ID[slot.upgrade].name}`;
      case 'incident': return 'Accept an incident offer';
      case 'heat': return `Keep load at ${GOALS.heatMin * 100}–${GOALS.heatMax * 100}% for ${slot.target} live seconds`;
      case 'milestone': return `Reach the ${slot.start + slot.target} ${name} milestone`;
      case 'move': return slot.start === 0 ? 'Move out of the basement' : 'Expand to Stage ' + (slot.start + 2);
    }
  }

  function swapWait(board, now) {
    return board?.lastSwapAt == null ? 0 : Math.max(0, Math.ceil(GOALS.swapSeconds - (now - board.lastSwapAt) / 1000));
  }

  function goalList(state, now = state.lastTick) {
    const slots = (state.goals?.slots || []).filter(Boolean).map(slot => {
      const current = goalProgress(state, slot);
      return { id: slot.id, kind: slot.kind, title: goalTitle(slot), current, target: slot.target,
        ready: current >= slot.target, rewardSeconds: GOAL_TEMPLATES[slot.kind].rewardSeconds };
    });
    return { slots, swapRemainingSeconds: swapWait(state.goals, now) };
  }

  function replaceGoal(state, index, rng, swapping = false) {
    const board = state.goals;
    const previous = board.slots[index];
    const next = drawGoal(state, goalCandidates(state), rng, previous, swapping);
    if (next) board.slots[index] = next;
    return Boolean(next);
  }

  function claimGoal(state, id, rng = Math.random) {
    const board = state.goals;
    const index = board?.slots.findIndex(g => g && g.id === id) ?? -1;
    if (typeof id !== 'string' || index < 0 || state.perkChoicePending || (!state.machines.laptop && !state.fireRunBurned)) return { ok: false };
    const slot = board.slots[index];
    if (goalProgress(state, slot) < slot.target) return { ok: false };
    const rewardSeconds = GOAL_TEMPLATES[slot.kind].rewardSeconds;
    const amount = stats(state).income * rewardSeconds;
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false };
    // Size the replacement from the post-payout wallet before committing the
    // claim, so a failed replacement can never pay the same slot twice.
    const after = { ...state, money: state.money + amount, lifetime: state.lifetime + amount };
    if (!Number.isFinite(after.money) || !Number.isFinite(state.allTimeEarnings + amount) || !replaceGoal(after, index, rng)) {
      return { ok: false };
    }
    earn(state, amount);
    state.counters.goalsClaimed++;
    return { ok: true, amount, rewardSeconds };
  }

  function swapGoal(state, id, now = state.lastTick, rng = Math.random) {
    const board = state.goals;
    const index = board?.slots.findIndex(g => g && g.id === id) ?? -1;
    if (typeof id !== 'string' || index < 0 || !Number.isFinite(now) || now < 0 ||
        state.perkChoicePending || (!state.machines.laptop && !state.fireRunBurned) || swapWait(board, now)) return { ok: false };
    const slot = board.slots[index];
    if (goalProgress(state, slot) >= slot.target) return { ok: false };
    if (!replaceGoal(state, index, rng, true)) return { ok: false };
    board.lastSwapAt = now;
    return { ok: true };
  }

  function restoreGoals(state, raw, now) {
    if ((!state.machines.laptop && !state.fireRunBurned) || state.perkChoicePending || !Array.isArray(raw?.slots)) return;
    const board = { serial: 0, lastSwapAt: null, slots: Array(GOALS.slots).fill(null) };
    if (Number.isFinite(raw.lastSwapAt) && raw.lastSwapAt >= 0) board.lastSwapAt = Math.min(raw.lastSwapAt, now);
    const used = new Set(), kinds = new Set();
    for (let i = 0; i < board.slots.length; i++) {
      const entry = raw.slots[i];
      if (!entry || typeof entry.kind !== 'string' || !Object.hasOwn(GOAL_TEMPLATES, entry.kind) || kinds.has(entry.kind) ||
          typeof entry.id !== 'string' || used.has(entry.id)) continue;
      const serial = Number(entry.id.split(':')[1]);
      if (!Number.isSafeInteger(serial) || serial < 1 || serial >= Number.MAX_SAFE_INTEGER - GOALS.slots ||
          entry.id !== state.runs + ':' + serial) continue;
      const { kind, id, target, start } = entry;
      if (!Number.isFinite(start) || start < 0 || !Number.isInteger(target) || target <= 0) continue;
      const slot = { kind, id, target, start };
      if (kind === 'machine' || kind === 'milestone') {
        const machine = lookup('machine', entry.machine);
        if (!machine || !meetsRequirements(state, machine) || !isRevealed(state, 'machine', machine.id) ||
            !Number.isSafeInteger(start) || target > CONFIG.maxBulkBuy) continue;
        if (kind === 'milestone' && nextMilestone(start)?.count !== start + target) continue;
        slot.machine = machine.id;
        if (state.fireRunBurned && Number.isSafeInteger(entry.progressBeforeFire) &&
            entry.progressBeforeFire >= 0 && entry.progressBeforeFire <= target) slot.progressBeforeFire = entry.progressBeforeFire;
      } else if (kind === 'heat') {
        if (start !== 0 || target !== GOALS.heatSeconds || !Number.isFinite(entry.streak) ||
            entry.streak < 0 || entry.streak > target) continue;
        slot.streak = entry.streak === target ? target : 0;
      } else if (kind === 'earnings') {
        const st = stats(state);
        const maxPace = Math.max(st.income, state.counters.highestIncome) + st.clickValue * GOALS.sizingClicksPerSecond;
        const maxTarget = Math.max(GOALS.minimumEarnings, Math.ceil(maxPace * GOALS.maxSizingSeconds));
        if (target < GOALS.minimumEarnings || target > maxTarget) continue;
      } else {
        const required = kind === 'jobs' ? GOALS.handJobs : 1;
        if (target !== required || !Number.isSafeInteger(start)) continue;
        if (kind === 'upgrade') {
          if (start !== 0 || typeof entry.upgrade !== 'string' || !lookup('upgrade', entry.upgrade) ||
              (!state.fireRunBurned && !isRevealed(state, 'upgrade', entry.upgrade))) continue;
          slot.upgrade = entry.upgrade;
        }
        if (kind === 'move') {
          const destination = STAGES[start + 1];
          if (!destination || (currentStage(state) < destination.number && state.lifetime < destination.target * GOALS.closeToMove)) continue;
        }
      }
      if (start > goalFact(state, slot) && slot.progressBeforeFire === undefined) continue;
      board.slots[i] = slot;
      board.serial = Math.max(board.serial, serial);
      used.add(id); kinds.add(kind);
    }
    // Even if one corrupt entry was discarded, do not reissue its old button ID.
    if (Number.isSafeInteger(raw.serial) && raw.serial < Number.MAX_SAFE_INTEGER - GOALS.slots) {
      board.serial = Math.max(board.serial, raw.serial);
    }
    state.goals = board;
  }

  // Badges read facts; claiming one never changes an economy multiplier.
  function goal(id, name, icon, desc, amount, target, hidden = false) {
    return { id, name, icon, desc, hidden,
      check: (s, st) => amount(s, st) >= target,
      progress: (s, st) => Math.max(0, Math.min(1, amount(s, st) / target)) };
  }
  const lifetime = s => s.allTimeEarnings;
  const largestFleet = s => Math.max(...MACHINES.map(m => s.machines[m.id]));
  const jobs = s => s.clicks;
  const catches = s => s.counters.bonusesCaught;
  const originalMachineIds = ['laptop', 'tower', 'rack', 'gpu'];
  const ACHIEVEMENTS = [
    ...(REWARDS.achievementBoosts ? [{ ...goal('overtime-10', 'Employee of the Ad Break', 'news', `Watch ${REWARDS.achievementBoosts} Overtime Boosts.`,
      s => s.counters.overtimeBoosts, REWARDS.achievementBoosts), rewardedOnly: true }] : []),
    goal('board-first', 'Motion Carried', 'goals', 'Complete a Board challenge.', s => s.challengeRewards.length, 1),
    goal('board-all', 'Minutes Approved', 'board', 'Complete every Board challenge.', s => s.challengeRewards.length, CHALLENGES.length),
    goal('fire-survived', 'False Alarm', 'shield', 'Cool down below the smoke line after an alarm.', s => s.counters.alarmsSurvived, 1),
    goal('fire-first', 'Unscheduled Downtime', 'fire', 'Have a datacenter burn down.', s => s.counters.fires, 1),
    goal('fire-rebuilt', 'Back in Business', 'tools', `Rebuild to ${FIRE.rebuildTarget} machines after a fire in the same run.`,
      s => s.counters.bestFireRebuild, FIRE.rebuildTarget),
    { ...goal('power-steady', 'Permission to Launch', 'settings', '', s => s.counters.longestMaxPowerSeconds, POWER.achievementSeconds),
      get desc() { return `Run machines at ${Math.round(POWER.max * 100)}% power for ${POWER.achievementSeconds} live seconds without overheating.`; } },
    goal('goals-10', 'List Person', 'goals', 'Claim 10 to-do rewards.', s => s.counters.goalsClaimed, GOALS.firstBadge),
    goal('goals-100', 'Clipboard Supervisor', 'goals', 'Claim 100 to-do rewards.', s => s.counters.goalsClaimed, GOALS.secondBadge),
    { id: 'mall-move', name: 'Anchor Tenant', icon: 'shop', desc: 'Move your startup into the Dead Mall.',
      check: s => s.location === 'mall' || s.flags.movedToMall === true },
    goal('cluster-1', 'Training Wheels', 'cluster', 'Own your first AI Training Cluster.', s => s.machines.cluster, 1),
    goal('cluster-50', 'Group Project', 'trophy', 'Own 50 AI Training Clusters.', s => s.machines.cluster, CLUSTER_FLEET_GOAL),
    goal('array-first', 'Parallel Parking', 'exascale', 'Own an Exascale Array.', s => s.machines.exascale, 1),
    goal('array-fleet', 'Aisle Be Back', 'exascale', 'Own 25 Exascale Arrays.', s => s.machines.exascale, ARRAY_FLEET_GOAL),
    goal('mainframe-1', 'Knock Before Observing', 'mainframe', 'Own a Quantum Mainframe.', s => s.machines.mainframe, 1),
    goal('mainframe-25', 'Whole Lot of Maybe', 'mainframe', 'Own 25 Quantum Mainframes.', s => s.machines.mainframe, MAINFRAME_FLEET_GOAL),
    goal('first-sale', 'Priced to Sell', 'sale', 'Sell your startup for the first time.', s => s.runs, 1),
    goal('stars-10', 'Pitch Deck Veteran', 'stats', 'Earn 10 Investor Reputation stars.', s => s.stars, INVESTOR_STAR_GOAL),
    goal('stars-50', 'Angel in Sweatpants', 'star', 'Earn 50 Investor Reputation stars.', s => s.stars, ANGEL_STAR_GOAL),
    { id: 'two-minute-move', name: 'Boxes Still Packed', icon: 'box', desc: 'Move out within two minutes of starting a run.',
      check: s => s.records.fastestMoveSeconds !== null && s.records.fastestMoveSeconds <= FAST_RUN_MOVE_SECONDS },
    goal('sibling-hired', 'Allowance Payroll', 'staff', 'Hire your little sibling.', s => s.staff.sibling, 1),
    goal('sibling-max', 'Senior Keyboard Smasher', 'keyboard', 'Train your little sibling to level 5.',
      s => s.staff.sibling, STAFF_BY_ID.sibling.prices.length),
    goal('self-cooling', 'Self-cooling', 'tools', 'Have the Sysadmin buy 25 coolers.', s => s.counters.sysadminPurchases, 25),
    goal('earn-1k', 'Pizza Budget', 'wallet', 'Earn $1,000 in total.', lifetime, 1000),
    goal('earn-10k', 'Garage Payroll', 'news', 'Earn $10,000 in total.', lifetime, 10000),
    goal('earn-100k', 'Six-Figure Basement', 'sale', 'Earn $100,000 in total.', lifetime, 100000),
    goal('earn-1m', 'Million-Dollar Modem', 'server', 'Earn $1 million in total.', lifetime, 1e6),
    goal('earn-1b', 'Basement Billionaire', 'star', 'Earn $1 billion in total.', lifetime, 1e9),
    goal('hardware-10', 'Matching Set', 'laptop', 'Own 10 of one machine.', largestFleet, 10),
    goal('hardware-50', 'Bulk Discount, Please', 'box', 'Own 50 of one machine.', largestFleet, 50),
    goal('hardware-100', 'Serial Collector', 'stats', 'Own 100 of one machine.', largestFleet, 100),
    goal('complete-fleet', 'Mixed Fleet', 'rack', 'Own a Laptop, Desktop Tower, Rack Server and GPU Rig.',
      s => originalMachineIds.filter(id => s.machines[id] > 0).length, originalMachineIds.length),
    goal('max-milestones', 'No Shelf Space', 'rack', 'Reach every milestone on one machine type.',
      largestFleet, MILESTONES[MILESTONES.length - 1].count),
    { id: 'overheat', name: 'Toaster Mode', icon: 'heat', desc: 'Overheat the room for the first time.',
      check: (s, st) => !!(s.flags.firstHot || s.counters.everOverheated || st.throttle < 1) },
    goal('thermal-balance', 'The Thin Green Line', 'heat', 'Stay at 95–100% load for 60 consecutive live seconds.',
      s => s.counters.longestHeatStreakSeconds, HEAT_BAND_SECONDS),
    goal('heatwave-survivor', 'Hold the Ice', 'heat', 'Finish a heat wave without buying ice.',
      s => s.counters.heatWavesSurvived, 1),
    goal('hands-100', 'Help Desk', 'tap', 'Run 100 jobs by hand.', jobs, 100),
    goal('hands-1000', 'Keyboard Contractor', 'keyboard', 'Run 1,000 jobs by hand.', jobs, 1000),
    goal('hands-10000', 'Warranty Void', 'tools', 'Run 10,000 jobs by hand.', jobs, 10000),
    goal('first-accept', 'Sure, We Can Do That', 'staff', 'Accept your first incident offer.',
      s => s.counters.incidentsAccepted, 1),
    goal('incident-10', 'On-Call Veteran', 'news', 'Handle 10 incident offers.',
      s => s.counters.incidentsAccepted + s.counters.incidentsDeclined, 10),
    goal('bonus-1', 'Special Delivery', 'bolt', 'Catch your first priority request.', catches, 1),
    goal('bonus-10', 'Priority Lane', 'news', 'Catch 10 priority requests.', catches, 10),
    // Keep its original ID so previously earned badges stay unlocked.
    goal('bonus-50', 'Request Magnet', 'gift', 'Catch 25 priority requests.', catches, 25),
    goal('jackpot', 'Golden Ticket', 'gift', 'Catch a jackpot priority request.', s => s.counters.jackpotsCaught, 1),
    { id: 'big-branch', name: 'Forwarding Address', icon: 'move', desc: 'Reach Stage 3 while keeping your first site open.',
      check: s => currentStage(s) >= 3 },
    { id: 'legendary-branch', name: 'Mom Wants a Postcard', icon: 'star', desc: 'Reach Stage 4 of a run.',
      check: s => currentStage(s) === 4 },
    { id: 'moved', name: 'Out of the Basement', icon: 'move', desc: 'Open your first site outside the basement.',
      check: s => s.location !== 'basement' },
    { id: 'speed-move', name: 'Eight-Minute Lease', icon: 'clock', desc: 'Move out within eight minutes of starting this save.',
      check: s => s.runs === 0 && s.location !== 'basement' && s.counters.moveTimeRecorded === 1 && s.counters.timeToMove <= FAST_MOVE_SECONDS },
    goal('rapid-jobs', 'Key Rollover', 'keyboard', 'Run 50 jobs by hand within 10 seconds.',
      s => s.counters.bestTapBurst, TAP_BURST_COUNT, true),
    { id: 'late-return', name: 'Extended Lunch', icon: 'clock', desc: 'Come back after more than two hours away.', hidden: true,
      check: s => s.counters.longestAbsenceSeconds > LONG_ABSENCE_SECONDS },
    { id: 'fan-fiction', name: 'Fan Fiction', icon: 'fan', desc: 'Own 10 Box Fans while still in the basement.', hidden: true,
      check: s => s.location === 'basement' && s.coolers.fan >= 10 },
  ];
  const ACHIEVEMENT_IDS = new Set(ACHIEVEMENTS.map(a => a.id));
  function newAchievements(state, st = stats(state)) {
    return ACHIEVEMENTS.filter(a => !state.achievements.includes(a.id) && a.check(state, st)).map(a => a.id);
  }

  const DECOR_SLOTS = [
    { id: 'poster', name: 'Wall poster' }, { id: 'desk', name: 'Desk item' },
    { id: 'plant', name: 'Plant corner' }, { id: 'rug', name: 'Rug' },
    { id: 'lamp', name: 'Lamp' }, { id: 'window', name: 'View or wall art' },
    { id: 'shelf', name: 'Shelf item' },
  ];
  const siteVisitFlags = { warehouse: 'movedWarehouse', office: 'movedOffice', mall: 'movedMall' };
  function visitedDecorSite(s, site) {
    return s.location === site || s.sites.includes(site) || s.flags['visited:' + site] === true ||
      s.flags[siteVisitFlags[site] || 'opened:' + site] === true ||
      (site === 'mall' && (s.flags.movedToMall === true || s.achievements.includes('mall-move')));
  }

  // Each locked card describes the same requirement that grants its item.
  const starterDecor = { hint: 'Available from the start', earned: () => true };
  const souvenir = site => ({ hint: 'Move to ' + LOCATIONS[site].name, earned: s => visitedDecorSite(s, site) });
  const investorDecor = stars => ({ hint: 'Earn ' + stars + ' investor stars', earned: s => s.stars >= stars });
  function badgeDecor(id) {
    const badge = ACHIEVEMENTS.find(b => b.id === id);
    return { hint: badge.name + ' — ' + badge.desc, earned: s => s.achievements.includes(id) || badge.check(s) };
  }
  function boardDecor(id) {
    return { hint: 'Complete the ' + CHALLENGE_BY_ID.get(id).name + ' Board challenge', earned: s => s.challengeRewards.includes(id) };
  }

  const DECORATIONS = [
    ['poster', 'hang-cat', 'Hang in There, Cat', starterDecor],
    ['poster', 'disrupt', 'Disrupt the Laundry', badgeDecor('earn-1k')],
    ['poster', 'blueprint', 'Backorder Blueprint', boardDecor('supply-shortage')],
    ['poster', 'bootstraps', 'Self-Made Shoelaces', boardDecor('bootstrapped')],
    ['desk', 'debug-duck', 'Debugging Duck', starterDecor],
    ['desk', 'stress-ball', 'Office Stress Ball', souvenir('office')],
    ['desk', 'ceo-mug', "World's Okayest CEO Mug", { hint: 'Sell the startup for the first time', earned: s => s.runs >= 1 }],
    ['desk', 'clipboard', 'Very Official Clipboard', badgeDecor('goals-10')],
    ['plant', 'cactus', 'Low-Maintenance Cactus', starterDecor],
    ['plant', 'ficus', 'Convincing Fake Ficus', investorDecor(3)],
    ['plant', 'tomato', 'Board Room Tomato', boardDecor('heat-dome')],
    ['rug', 'rag-rug', 'Hand-Me-Down Rug', starterDecor],
    ['rug', 'chair-mat', 'Gaming Chair Parking', badgeDecor('hands-100')],
    ['rug', 'circuit-rug', 'Printed Circuit Rug', investorDecor(12)],
    ['rug', 'singed-rug', 'Lightly Toasted Rug', badgeDecor('fire-first')],
    ['lamp', 'fairy-lights', 'Hand-Me-Down String Lights', starterDecor],
    ['lamp', 'lava-lamp', 'Volcano Lava Lamp', souvenir('volcano')],
    ['lamp', 'chandelier', 'Tiny Penthouse Chandelier', souvenir('penthouse')],
    ['lamp', 'alarm-beacon', 'Retired Alarm Beacon', badgeDecor('fire-survived')],
    ['window', 'suburbs', 'Suburban Sunset', starterDecor],
    ['window', 'skyline', 'Downtown After Hours', investorDecor(48)],
    ['window', 'snowfall', 'Snow Day', badgeDecor('heatwave-survivor')],
    ['window', 'starfield', 'Quiet Orbit', investorDecor(192)],
    ['window', 'caldera', 'Caldera at Dusk', boardDecor('hands-only')],
    ['shelf', 'paper-rocket', 'Paper Rocket', starterDecor],
    ['shelf', 'ice-tray', 'Warehouse Ice Cube Tray', souvenir('warehouse')],
    ['shelf', 'mannequin', 'Mall Mannequin', souvenir('mall')],
    ['shelf', 'snow-globe', 'Dam Snow Globe', souvenir('dam')],
    ['shelf', 'radio', 'Bunker Vintage Radio', souvenir('bunker')],
    ['shelf', 'satellite', 'Orbital Mini Satellite', souvenir('orbital')],
  ].map(([slot, id, name, rule]) => ({ slot, id, name, hint: rule.hint, rule }));
  const decorById = new Map(DECORATIONS.map(item => [item.id, item]));
  const starterDecorIds = DECORATIONS.filter(item => item.rule === starterDecor).map(item => item.id);
  const decorSlots = new Set(DECOR_SLOTS.map(slot => slot.id));

  function newDecor() {
    return { unlocked: [...starterDecorIds], equipped: {}, unseen: [], pending: [], retroactive: false };
  }

  function refreshDecor(state) {
    const d = state.decor;
    if (d.unlocked.length === DECORATIONS.length) return [];
    const added = DECORATIONS.filter(item => !d.unlocked.includes(item.id) && item.rule.earned(state)).map(item => item.id);
    if (added.length) {
      d.unlocked.push(...added);
      d.unseen.push(...added);
      d.pending.push(...added);
    }
    return added;
  }

  function decorPicker(state, slot) {
    const d = state.decor;
    return DECORATIONS.filter(item => item.slot === slot).map(({ id, slot, name, hint }) =>
      ({ id, slot, name, hint, unlocked: d.unlocked.includes(id), selected: d.equipped[slot] === id }));
  }

  function equipDecor(state, slot, id) {
    if (!decorSlots.has(slot)) return false;
    if (id === null) delete state.decor.equipped[slot];
    else {
      if (decorById.get(id)?.slot !== slot || !state.decor.unlocked.includes(id)) return false;
      state.decor.equipped[slot] = id;
    }
    return true;
  }

  function markDecorSeen(state) {
    if (!state.decor.unseen.length) return false;
    state.decor.unseen.length = 0;
    return true;
  }

  function takeDecorNotice(state) {
    const d = state.decor;
    if (!d.pending.length) return null;
    const summary = d.retroactive;
    d.retroactive = false;
    return { ids: summary ? d.pending.splice(0) : [d.pending.shift()], summary };
  }

  function restoreDecor(s, raw) {
    const d = s.decor;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      // Earlier saves have no collection. Their route, story flags, historical
      // badges and counters unlock all previously earned items in one notice.
      d.retroactive = refreshDecor(s).length > 0;
      return;
    }
    const list = ids => Array.isArray(ids) ? [...new Set(ids.filter(id => decorById.has(id)))] : [];
    for (const id of list(raw.unlocked)) {
      const rule = decorById.get(id).rule;
      if (rule !== starterDecor && rule.earned(s)) d.unlocked.push(id);
    }
    for (const { id: slot } of DECOR_SLOTS) equipDecor(s, slot, raw.equipped?.[slot]);
    const earned = id => d.unlocked.includes(id) && !starterDecorIds.includes(id);
    d.pending = list(raw.pending).filter(earned);
    d.unseen = list(raw.unseen).filter(earned);
    d.retroactive = raw.retroactive === true && d.pending.length > 0;
  }

  // ---------------------------------------------------------------------------
  // Saving and loading (the page decides WHERE to store the text; this decides WHAT)
  // ---------------------------------------------------------------------------

  function serialize(state) {
    // Empty fields have the same meaning as their absence in a version-one save.
    const { counters = {}, achievements = [], staff, stars, runs, allTimeEarnings, runStartedAt, records,
      challenge, challengeRewards, managerEnabled, managerBudget,
      perks, perkChoicePending, runBestIncome, runStartingCash, extraLocation, power,
      fireRisk, fireAlarmPending, fireRunBurned, fireCharred, runInsurancePaid, ...saved } = state;
    if (fireRisk) saved.fireRisk = fireRisk;
    if (fireAlarmPending) saved.fireAlarmPending = true;
    if (fireRunBurned) saved.fireRunBurned = true;
    if (runInsurancePaid) saved.runInsurancePaid = runInsurancePaid;
    if (power !== undefined && power !== POWER.normal && powerUnlocked(state)) saved.power = normalizedPower(power, stats(state).powerMax);
    // In a first run the original fields already encode these defaults.
    if (stars || runs || allTimeEarnings !== state.lifetime || runStartedAt !== state.startedAt ||
        records?.fastestMoveSeconds != null || records?.bestRunEarnings > state.lifetime) {
      Object.assign(saved, { stars, runs, allTimeEarnings, runStartedAt, records });
    }
    if (staff && (staff.sibling || staff.sysadmin || staff.manager || !staff.sysadminEnabled)) saved.staff = staff;
    if (staff?.manager) Object.assign(saved, { managerEnabled, managerBudget });
    if (challenge) saved.challenge = challenge;
    if (challengeRewards?.length) saved.challengeRewards = challengeRewards;
    if (Object.values(counters).some(value => value !== 0)) saved.counters = counters;
    if (achievements.length) saved.achievements = achievements;
    if (perks && Object.keys(perks).length) saved.perks = perks;
    if (perkChoicePending) saved.perkChoicePending = true;
    if (runStartingCash) saved.runStartingCash = runStartingCash;
    if (runs && runBestIncome) saved.runBestIncome = runBestIncome;
    if (extraLocation || (state.location !== 'basement' && perkEffect(state, 'franchise')?.extraBranch)) {
      saved.extraLocation = extraLocation ?? null;
    }
    saved.sites = runSites(state);
    return JSON.stringify(saved);
  }

  const nonNegative = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const count = (v) => Math.floor(nonNegative(v));
  const integerCounters = new Set(['overtimeBoosts', 'fires', 'alarmsSurvived', 'bestFireRebuild', 'goalsClaimed', 'machinesBought', 'coolersBought', 'incidentsAccepted', 'incidentsDeclined',
    'heatWavesSurvived', 'bonusesCaught', 'bonusesMissed', 'jackpotsCaught', 'bestTapBurst', 'sysadminPurchases', 'contractsCompleted']);

  function restoreIncident(raw, pending, state) {
    if (!raw || typeof raw.id !== 'string' || !Object.hasOwn(EVENT_BY_ID, raw.id)) return null;
    const def = EVENT_BY_ID[raw.id];
    const remaining = nonNegative(raw.remaining);
    if (remaining === 0) return null;
    if (!pending) {
      if (raw.side !== 'accept' && raw.side !== 'decline') return null;
      const duration = def[raw.side].duration;
      if (!duration || remaining > duration) return null;
      return { id: def.id, side: raw.side, remaining };
    }
    if (remaining > CONFIG.eventOfferSeconds) return null;
    const offer = { id: def.id, remaining };
    if (def.accept.cashSeconds) {
      if (!Number.isSafeInteger(raw.cash) || raw.cash < def.accept.minCash) return null;
      offer.cash = raw.cash;
    }
    if (def.accept.costSeconds) {
      if (!Number.isSafeInteger(raw.price) || raw.price < def.accept.minCost) return null;
      offer.price = raw.price;
    }
    if (def.accept.freeMachine) {
      if (typeof raw.machineId !== 'string' || !lookup('machine', raw.machineId) ||
          !(state.machines[raw.machineId] > 0 || state.fireRunBurned && meetsRequirements(state, MACHINE_BY_ID[raw.machineId]))) return null;
      offer.machineId = raw.machineId;
    }
    return offer;
  }

  // Never trust saved text: a corrupt or hand-edited save falls back to safe values.
  function deserialize(text, now) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return newState(now);
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return newState(now);

    const s = newState(now);
    if (Number.isFinite(raw.overtimeWaitSeconds) && raw.overtimeWaitSeconds > 0 && raw.overtimeWaitSeconds <= overtimeCycleSeconds) {
      s.overtimeWaitSeconds = raw.overtimeWaitSeconds;
    }
    s.money = nonNegative(raw.money);
    s.lifetime = nonNegative(raw.lifetime);
    s.allTimeEarnings = Math.max(s.lifetime, nonNegative(raw.allTimeEarnings));
    // Late doubling thresholds remain representable beyond the last individually countable star.
    if (Number.isInteger(raw.stars) && raw.stars >= 0) {
      s.stars = Math.min(raw.stars, starsForEarnings(s.allTimeEarnings));
    }
    if (Number.isSafeInteger(raw.runs) && raw.runs >= 0) s.runs = Math.min(s.stars, raw.runs);
    if (s.runs && s.stars >= BOARD_STARS) {
      if (CHALLENGE_BY_ID.has(raw.challenge)) s.challenge = raw.challenge;
      if (Array.isArray(raw.challengeRewards)) {
        s.challengeRewards = [...new Set(raw.challengeRewards.filter(id => CHALLENGE_BY_ID.has(id)))];
      }
    }
    if (s.runs > 0 && raw.perks && typeof raw.perks === 'object' && !Array.isArray(raw.perks)) {
      for (const tier of PERK_TIERS) {
        const id = raw.perks[tier.stars];
        if (s.stars >= tier.stars && tier.options.some(option => option.id === id)) s.perks[tier.stars] = id;
      }
      for (let stars = firstRepeatStars; stars <= s.stars; stars *= LATE_PERKS.repeatStep) {
        const id = raw.perks[stars];
        if (!REPEAT_PERKS.some(option => option.id === id)) break;
        s.perks[stars] = id;
      }
    }
    const hadFire = Number.isSafeInteger(raw.counters?.fires) && raw.counters.fires > 0;
    if (hadFire) s.runInsurancePaid = Math.min(nonNegative(raw.runInsurancePaid), nonNegative(raw.counters.insurancePaid));
    if ((perkEffect(s, 'seedFunding') || perkEffect(s, 'starterKit')) && Number.isSafeInteger(raw.runStartingCash)) {
      s.runStartingCash = nonNegative(raw.runStartingCash);
    }
    // With a cash grant, balance and earnings accumulate from different starting points.
    // Keep the actual earnings ledger rather than reconstructing it from rounded floating-point balances.
    if (!s.runStartingCash || !Number.isFinite(raw.lifetime) || raw.lifetime < 0) {
      s.lifetime = Math.max(s.lifetime, s.money - s.runStartingCash - s.runInsurancePaid);
    }
    s.allTimeEarnings = Math.max(s.lifetime, s.allTimeEarnings);
    s.records.bestRunEarnings = Math.max(s.lifetime, Math.min(s.allTimeEarnings, nonNegative(raw.records?.bestRunEarnings)));
    s.clicks = count(raw.clicks);
    if (raw.counters && typeof raw.counters === 'object' && !Array.isArray(raw.counters)) {
      for (const key of Object.keys(s.counters)) {
        const value = raw.counters[key];
        if (integerCounters.has(key) && !Number.isSafeInteger(value)) continue;
        s.counters[key] = nonNegative(value);
      }
    }
    if (Array.isArray(raw.achievements)) {
      s.achievements = [...new Set(raw.achievements.filter(id => ACHIEVEMENT_IDS.has(id)))];
    }
    const contract = restoreContract(raw.contract);
    if (contract) s.contract = contract;
    const machines = raw.machines && typeof raw.machines === 'object' ? raw.machines : {};
    const coolers = raw.coolers && typeof raw.coolers === 'object' ? raw.coolers : {};
    for (const m of MACHINES) s.machines[m.id] = count(machines[m.id]);
    for (const c of COOLERS) s.coolers[c.id] = count(coolers[c.id]);
    if (Array.isArray(raw.upgrades)) {
      s.upgrades = [...new Set(raw.upgrades.filter(id => typeof id === 'string' && Object.hasOwn(UPGRADE_BY_ID, id)))];
      s.upgrades = s.upgrades.filter(id => !UPGRADE_BY_ID[id].requiresUpgrade || s.upgrades.includes(UPGRADE_BY_ID[id].requiresUpgrade));
    }
    const firstMoves = moveDestinations(s);
    if (Array.isArray(raw.sites)) {
      // Only a contiguous, earned path is valid. Stage 2 may predate the $1M goal.
      if (raw.sites[0] === 'basement' && firstMoves.includes(raw.sites[1])) {
        s.sites.push(raw.sites[1]);
        for (const stage of STAGES.slice(2)) {
          const id = raw.sites[stage.number - 1];
          if (s.lifetime < Math.min(stage.target, PRE_SIGNATURE_UNLOCKS[stage.number]) || !stage.locations.includes(id)) break;
          s.sites.push(id);
        }
      }
    } else if (firstMoves.includes(raw.location)) {
      // A pre-ladder save has only the current building. Never take a move back.
      s.sites.push(raw.location);
    }
    s.location = s.sites.at(-1);
    const first = s.sites[1];
    const choices = first && perkEffect(s, 'franchise')?.extraBranch ? firstMoves.filter(id => id !== first) : [];
    if (choices.includes(raw.extraLocation)) {
      s.extraLocation = raw.extraLocation;
    } else if (!Object.hasOwn(raw, 'extraLocation') && !Array.isArray(raw.sites) && choices.length && ['warehouse', 'office'].includes(first)) {
      // In a pre-Mall Franchise save these two effects were automatically active together.
      s.extraLocation = first === 'warehouse' ? 'office' : 'warehouse';
    }
    if (raw.staff && typeof raw.staff === 'object' && !Array.isArray(raw.staff)) {
      for (const def of STAFF) {
        const level = raw.staff[def.id];
        const bunkerHire = hasSite(s, 'bunker') && s.challenge !== 'bootstrapped' && RELOCATION.bunkerHires.includes(def.id);
        if ((!bunkerHire && !meetsRequirements(s, def)) || (def.id === 'manager' && !level)) continue;
        if (Number.isInteger(level) && level >= 0 && level <= def.prices.length) s.staff[def.id] = level;
      }
      if (s.staff.manager) {
        if (typeof raw.managerEnabled === 'boolean') s.managerEnabled = raw.managerEnabled;
        if (MANAGER.budgets.includes(raw.managerBudget)) s.managerBudget = raw.managerBudget;
        if (Number.isFinite(raw.managerLastPurchase) && raw.managerLastPurchase >= 0 && raw.managerLastPurchase <= now) {
          s.managerLastPurchase = raw.managerLastPurchase;
        }
      }
      if (s.staff.sysadmin && typeof raw.staff.sysadminEnabled === 'boolean') {
        s.staff.sysadminEnabled = raw.staff.sysadminEnabled;
      }
    }
    if (!meetsRequirements(s, MACHINE_BY_ID.cluster)) s.machines.cluster = 0;
    const legacyMainframes = currentStage(s) >= 2 && s.stars >= PRE_SIGNATURE_UNLOCKS.mainframeStars;
    if (!legacyMainframes && !meetsRequirements(s, MACHINE_BY_ID.mainframe)) s.machines.mainframe = 0;
    if (!meetsRequirements(s, MACHINE_BY_ID.exascale)) s.machines.exascale = 0;
    s.fireRunBurned = hadFire && raw.fireRunBurned === true;
    s.fireCharred = s.fireRunBurned && machineCount(s) < FIRE.charredUntil;
    if (!s.machines.cluster && !(s.fireRunBurned && meetsRequirements(s, MACHINE_BY_ID.cluster))) {
      s.upgrades = s.upgrades.filter(id => id !== 'distillation');
    }
    if (!s.machines.mainframe && !(s.fireRunBurned && (legacyMainframes || meetsRequirements(s, MACHINE_BY_ID.mainframe)))) {
      s.upgrades = s.upgrades.filter(id => id !== 'errorCorrection');
    }
    if (!s.machines.exascale && !(s.fireRunBurned && meetsRequirements(s, MACHINE_BY_ID.exascale))) {
      s.upgrades = s.upgrades.filter(id => id !== 'opticalBus');
    }
    if (Number.isFinite(raw.equipmentCost) && Number.isInteger(raw.equipmentCost) && raw.equipmentCost >= 0) {
      // Receipts may include full-price buys made before a discount, a challenge surcharge
      // and, in runs with a Penthouse, its machine premium.
      const maximumPrices = { location: hasSite(s, 'penthouse') ? 'penthouse' : 'basement',
        challenge: s.stars >= BOARD_STARS ? 'supply-shortage' : null };
      if (raw.equipmentCost <= formulaEquipmentCost(s, maximumPrices)) s.equipmentCost = raw.equipmentCost;
    }
    if (raw.flags && typeof raw.flags === 'object') {
      for (const key of Object.keys(raw.flags)) {
        if (key !== 'firstPriorityRequestSeen' && raw.flags[key]) s.flags[key] = true;
      }
    }
    s.fireRisk = modifiers(s).fireImmune ? 0 : Math.min(1, nonNegative(raw.fireRisk));
    s.fireAlarmPending = s.fireRisk >= FIRE.alarmRisk || (s.fireRisk >= FIRE.smokeRisk && raw.fireAlarmPending === true);
    if (s.fireRisk >= FIRE.smokeRisk || hadFire || s.counters.alarmsSurvived || raw.flags?.fireSmokeSeen === true) {
      s.flags.fireSmokeSeen = true;
    } else {
      delete s.flags.fireSmokeSeen;
      s.upgrades = s.upgrades.filter(id => id !== 'insurance');
    }
    if (s.fireAlarmPending || hadFire || s.counters.alarmsSurvived || raw.flags?.fireAlarmSeen === true) s.flags.fireAlarmSeen = true;
    else delete s.flags.fireAlarmSeen;
    if (!hadFire) {
      s.counters.insurancePaid = 0;
      s.counters.bestFireRebuild = 0;
    }
    if (s.fireRunBurned) recordFireRebuild(s);
    if (!s.runs || raw.flags?.movedToMall !== true) delete s.flags.movedToMall;
    if (s.sites.includes('mall')) s.flags.movedToMall = true;
    // Before the appearance flag existed, catches and misses were saved at resolution.
    const c = s.counters;
    if (raw.flags?.firstPriorityRequestSeen === true || c.bonusesCaught || c.bonusesMissed ||
        c.jackpotsCaught || c.bonusCashEarned || s.achievements.some(id => id.startsWith('bonus-') || id === 'jackpot')) {
      markBonusAppeared(s);
    }
    if (raw.priorityWasFlying === true && s.flags.firstPriorityRequestSeen && machineCount(s)) s.priorityWasFlying = true;
    const maxWait = nextBonusGap(s, () => 1);
    if (Number.isFinite(raw.priorityWaitSeconds) && raw.priorityWaitSeconds >= 0 &&
        raw.priorityWaitSeconds <= maxWait && machineCount(s) > 0) {
      s.priorityWaitSeconds = raw.priorityWaitSeconds;
    }
    // A legacy location proves the player moved, but cannot establish how quickly they did it.
    s.counters.everOverheated = Number(raw.counters?.everOverheated === 1);
    if ((s.runs === 0 && s.location === 'basement') || raw.counters?.moveTimeRecorded !== 1 ||
        !Number.isFinite(raw.counters?.timeToMove) || raw.counters.timeToMove < 0) {
      s.counters.moveTimeRecorded = 0;
      s.counters.timeToMove = 0;
    }
    if (Number.isFinite(raw.nextEventIn) && raw.nextEventIn >= 0) {
      s.nextEventIn = Math.min(raw.nextEventIn, CONFIG.eventGapMaxSeconds);
    }
    if (Number.isFinite(raw.startedAt) && raw.startedAt >= 0) s.startedAt = raw.startedAt;
    const runStart = raw.runStartedAt === undefined && s.runs === 0 ? raw.startedAt : raw.runStartedAt;
    // A populated save with no usable start timestamp cannot prove a timed move.
    if (Number.isFinite(runStart) && runStart >= 0) {
      s.runStartedAt = runStart;
    } else if (s.runs > 0 || s.lifetime > 0 || raw.runStartedAt !== undefined) {
      s.runStartedAt = null;
    }
    const fastest = raw.records?.fastestMoveSeconds;
    if ((s.runs > 0 || s.location !== 'basement') && Number.isFinite(fastest) && fastest >= 0) {
      s.records.fastestMoveSeconds = fastest;
    }
    if (s.counters.moveTimeRecorded) {
      s.records.fastestMoveSeconds = Math.min(s.records.fastestMoveSeconds ?? Infinity, s.counters.timeToMove);
    }
    if (Number.isFinite(raw.lastTick) && raw.lastTick >= 0) {
      s.lastTick = raw.lastTick;
      // Restore timers as of lastTick. Startup catch-up then credits any effect through its expiry.
      s.active = restoreIncident(raw.active, false, s);
      if (!s.active) s.event = restoreIncident(raw.event, true, s);
    }
    if (raw.perkChoicePending === true && s.runs > 0 && s.location === 'basement' &&
        s.lifetime === 0 && s.money === 0 && machineCount(s) === 0 && !s.upgrades.length &&
        !s.staff.sibling && !s.staff.sysadmin && !s.staff.manager && !Object.values(s.coolers).some(Boolean)) {
      s.perkChoicePending = true;
      s.perkChoicePending = nextPerkOffer(s) !== null;
    }
    const previousPeak = s.runs ? nonNegative(raw.runBestIncome) : s.counters.highestIncome;
    s.runBestIncome = s.perkChoicePending ? 0 : previousPeak;
    // An old board still above capacity can use the control immediately. Its
    // existing counters stay untouched until a real tick or slider input observes it.
    s.power = hasPowerHistory(s) && !s.perkChoicePending ? normalizedPower(raw.power, stats(s).powerMax) : POWER.normal;
    s.counters.longestMaxPowerSeconds = hasPowerHistory(s) ? Math.min(POWER.achievementSeconds, s.counters.longestMaxPowerSeconds) : 0;
    restoreGoals(s, raw.goals, now);
    completeChallenge(s);
    restoreDecor(s, raw.decor);
    liveSession(s).fireGraceSeconds = FIRE.graceSeconds;
    return s;
  }

  // ---------------------------------------------------------------------------
  // News and first-time guidance. The screen supplies the local hour, drawing
  // of the random number, and whether a transient UI element is actually shown.
  // ---------------------------------------------------------------------------

  const NEWS = { historySize: 10, matchingWeight: 4, reducedMs: 8000, pauseMs: 10000,
    pixelsPerSecond: 26, holdMs: 1500, recentEventMs: 60000 };
  const HEADLINES = Object.entries({
    general: [
      'Help desk hours extended until dinner',
      'Founder paid entirely in leftover pizza',
      'New cable drawer immediately full',
      'Business cards printed on old homework',
      'Board meeting moved to breakfast',
      'Mystery screw gets its own parking spot',
      'First investor asks about bedtime',
      'Keyboard crumbs listed as fixed assets',
      'Cloud turns out to have a street address',
      'Cable labels survive first spelling test',
      'Forecast calls for scattered updates',
      'Support ticket closed by plugging it in',
      'Server names now outnumber pets',
      'Printer declines to join the startup',
      'One blinking light promoted to manager',
      'Family calendar gains a reboot window',
      'Backup plan written on a cereal box',
      'Cat signs off on keyboard inspection',
      'Founder adds uptime to school résumé',
      'Cable tie elected employee of the month',
      'Spare parts box contains another box',
      'Snack budget awaits board approval',
    ],
    decor: ['Debugging duck promoted to head of quality assurance', 'Cat poster still hanging in there, says quarterly report',
      'Facilities confirms rug really ties the cables together', 'Shelf souvenir requests a window seat'],
    basement: [
      'Laundry day doubles as a vibration test',
      'Dryer claims seniority over servers',
      'Basement door gets a business address',
      'Lost sock found behind the help desk',
    ],
    warehouse: [
      'Cold aisle earns its name this morning',
      'Server tour now includes a scarf',
      'Frost makes a map of the network',
      'Pallet jack gets a visitor badge',
    ],
    office: [
      'Downtown view wins a window-seat raffle',
      'Elevator music enters the hold queue',
      'Client meeting uses every nice mug',
      'Desk plant gets its own network name',
    ],
    mall: [
      'Food court adds a byte-size special',
      'Old shoe shop measures feet of cable',
      'Mall map still points to the arcade',
      'Security guard hears the cloud humming',
      'Escalator enjoys its longest break yet',
    ],
    dam: ['Water cooler reports to the whole river', 'Turbine wins employee of the current', 'Server dial borrows a gear from the turbine'],
    penthouse: ['Elevator needs a second button for cloud storage', 'Rooftop router gets the corner office', 'Priority clients wear out the express elevator button'],
    bunker: ['Blast door seals in the smell of lunch', 'Emergency drill ends with a pizza delivery', 'New manager discovers the office is included in the lease'],
    orbital: ['Help desk accepts calls from low Earth orbit', 'Coffee mug completes another orbit', 'Space station lists a box fan under antiques'],
    volcano: ['Dramatic monologue runs over its time slot', 'Lava lamp files a conflict of interest', 'Power company receives a postcard from inside the volcano'],
    heat: [
      'Hot aisle enters the toast business',
      'Thermometer asks for a desk fan',
      'Warmest seat in town suddenly vacant',
      'Fans file for a longer lunch break',
    ],
    sibling: [
      'Little Sibling submits invoice in candy',
      'New hire brings a lucky lunchbox',
      'Sibling requests a taller office chair',
      'Payroll now accepts fruit snacks',
    ],
    milestone: [
      'Odometer on the rack rolls over',
      'Another batch earns its gold sticker',
      'Production chart needs taller paper',
    ],
    sale: [
      'Former CEO back on dish duty',
      'Family briefly regains the basement',
      'Founder updates résumé during lunch',
    ],
    cluster: [
      'Training Cluster learns the lunch bell',
      'Model predicts one more power strip',
      'Cluster graduates from counting socks',
    ],
    mainframe: [
      'Quantum mainframe reserves both window seats',
      'Technician labels cold cylinder “probably on”',
    ],
    exascale: ['Exascale Array calculates whose turn it is to do the dishes', 'Optical backplane asks for a dimmer switch'],
    overtime: ['Mom approves overtime, sets the egg timer', 'Server rack requests time and a half in pizza'],
    powerHigh: ['Electric meter blames the new power dial'],
    powerLow: ['Server dial finds its indoor voice'],
    smoke: ['Dad checks the toaster. The toaster has an alibi.'],
    alarm: ['Smoke alarm auditions for lead singer. Nobody asked.'],
    fire: ['Teen gives “cloud storage” a very literal press release'],
    insurance: ['Insurer accepts receipt with one lightly toasted corner'],
    night: [
      'Porch light clocks out before servers',
      'Late shift hears the fridge solo',
      'Midnight backup wakes exactly one cat',
      'Moon gets credit for the night shift',
    ],
  }).flatMap(([condition, texts]) => texts.map((text, i) => ({ id: condition + '-' + i, condition, text })));

  function pickHeadline(state, recent, context, roll) {
    const hour = context.hour;
    const smoke = state.fireRisk >= FIRE.smokeRisk && state.fireRisk < FIRE.alarmRisk;
    const matches = { general: true, decor: Object.keys(state.decor.equipped).length > 0, [state.location]: true, heat: context.throttled,
      smoke, alarm: state.fireRisk >= FIRE.alarmRisk, fire: context.afterFire && state.counters.fires > 0,
      insurance: context.afterPayout && state.counters.insurancePaid > 0,
      sibling: state.staff.sibling > 0, milestone: context.milestone, sale: state.runs > 0 && context.afterSale,
      cluster: state.machines.cluster > 0, night: hour >= 21 || hour < 6,
      mainframe: state.machines.mainframe > 0, exascale: state.machines.exascale > 0, overtime: state.overtimeWaitSeconds > REWARDS.cooldownSeconds,
      powerHigh: hasPowerHistory(state) && state.power > POWER.normal,
      powerLow: hasPowerHistory(state) && state.power < POWER.normal };
    const excluded = new Set(recent.slice(-NEWS.historySize));
    const eligible = HEADLINES.filter(h => matches[h.condition] && !excluded.has(h.id));
    const weight = h => h.condition === 'general' ? 1 : NEWS.matchingWeight;
    let ticket = roll * eligible.reduce((sum, h) => sum + weight(h), 0);
    for (const headline of eligible) {
      ticket -= weight(headline);
      if (ticket < 0) return headline;
    }
    return eligible.at(-1);
  }

  const TIP_VISIBLE_MS = 8000;
  const TIP_BULK_COUNT = 10;
  const canBuyTen = s => MACHINES.some(m => isRevealed(s, 'machine', m.id) &&
    s.money >= bulkCost(s, 'machine', m.id, TIP_BULK_COUNT));
  const staffRevealed = s => STAFF.some(d => isRevealed(s, 'staff', d.id));
  const TIPS = [
    { id: 'decor', text: 'You unlocked room decor. Open Decorate and pick a spot to try it out.',
      when: s => s.decor.unlocked.length > starterDecorIds.length, seenBefore: () => false },
    ...['dam', 'penthouse', 'bunker', 'orbital', 'volcano'].map(id => ({
      id, get text() { return LOCATIONS[id].signature + '. This rule stays with your branches until you sell.'; },
      when: s => hasSite(s, id), seenBefore: s => hasSite(s, id),
    })),
    { id: 'manager', text: 'Hire a Purchasing Manager in Staff. Set how much of your cash each Best buy can use.',
      when: s => isRevealed(s, 'staff', 'manager'), seenBefore: s => !!s.staff.manager },
    { id: 'board', text: 'Open the Board Room to see the optional challenge you can take after a sale.',
      when: s => s.stars >= BOARD_STARS && s.location !== 'basement', seenBefore: s => s.challenge || s.challengeRewards.length },
    { id: 'smoke', text: 'Too hot! Lower Power or buy cooling before the alarm turns into a fire.',
      when: s => s.fireRisk >= FIRE.smokeRisk, seenBefore: s => s.counters.fires > 0 },
    { id: 'perk', text: 'Your pick carries into every future run.', when: s => s.perkChoicePending,
      seenBefore: s => Object.keys(s.perks).length > 0 },
    { id: 'priority', text: 'Tap the moving bolt for a cash bonus.', when: (s, view) => view.priority,
      seenBefore: s => s.flags.firstPriorityRequestSeen || s.counters.bonusesCaught || s.counters.bonusesMissed },
    { id: 'incident', text: 'Check both choices before the timer ends.', when: s => !!s.event,
      seenBefore: s => s.event || s.active || s.counters.incidentsAccepted || s.counters.incidentsDeclined },
    { id: 'power', text: 'Push Power up to earn more, but heat climbs faster. The best spot is where heat meets your cooling.',
      when: (s, view) => view.powerUnlocked ?? powerUnlocked(s), seenBefore: s => powerUnlocked(s) && s.power !== POWER.normal },
    { id: 'heat', text: 'Open Cooling to restore lost income.', when: (s, view) => view.throttled,
      seenBefore: s => s.flags.firstHot || s.counters.everOverheated },
    { id: 'move', text: 'Compare locations before you move.', when: s => currentStage(s) === 1 && canMove(s),
      seenBefore: s => s.flags.canMove || s.location !== 'basement' || s.runs || canMove(s) },
    { id: 'expand', text: 'Expand to a new site and keep every earlier branch bonus.',
      when: s => currentStage(s) > 1 && canMove(s), seenBefore: s => currentStage(s) >= 3 },
    { id: 'sale', text: 'Review the sale to see what you keep.', when: canSell,
      seenBefore: s => s.runs || canSell(s) },
    { id: 'mall', text: 'Mall prices also apply to cooling.', when: s => s.location === 'mall',
      seenBefore: s => s.location === 'mall' || s.flags.movedToMall },
    { id: 'cluster', text: 'Buy one Cluster to unlock Model Distillation.', when: s => isRevealed(s, 'machine', 'cluster'),
      seenBefore: s => s.machines.cluster || s.runs >= 2 || isRevealed(s, 'machine', 'cluster') },
    { id: 'mainframe', text: 'Error Correction doubles Mainframe income. Own one to discover the upgrade.',
      when: s => isRevealed(s, 'machine', 'mainframe'), seenBefore: s => s.machines.mainframe > 0 },
    { id: 'staff', text: 'Open Staff to price your first hire.', when: staffRevealed,
      seenBefore: s => s.staff.sibling || s.staff.sysadmin || s.runs || staffRevealed(s) },
    { id: 'bulk', text: 'Choose ×10 to buy ten machines at once.', when: canBuyTen,
      seenBefore: s => s.runs || s.lifetime >= bulkCost(newState(0), 'machine', 'laptop', TIP_BULK_COUNT) ||
        MACHINES.some(m => s.machines[m.id] >= TIP_BULK_COUNT) },
    { id: 'best', text: 'The star weighs price, pay and cooling.', when: (s, view) => view.best,
      seenBefore: s => s.clicks || machineCount(s) || s.lifetime || s.runs },
  ];

  // The goal strip's "Next step" line: the one action most worth taking now, or null to
  // leave only the long-term objective. It reads the same live production as the heat
  // panel (`st`), so heat guidance follows real throttling rather than the heat percentage:
  // some sites run at full speed above 100% (see freeLoad). Purchase advice is for a first
  // run only; later runs, starter perks and imported saves past these steps get none.
  function nextStep(state, st = stats(state)) {
    if (st.throttle < 1 && st.rawIncome > st.income) {
      return { id: 'heat', loss: st.rawIncome - st.income, throttle: st.throttle };
    }
    if (state.runs > 0) return null;
    if (!state.counters.machinesBought && machineCount(state) === 0) {
      const price = cost(state, 'machine', 'laptop');
      return { id: 'laptop', price, earns: st.incomePerUnit.laptop,
        shortfall: Math.max(0, Math.ceil(price - state.money)), ready: canBuy(state, 'machine', 'laptop') };
    }
    const sibling = STAFF_BY_ID.sibling;
    if (!state.staff.sibling && isRevealed(state, 'staff', 'sibling') && !requirementBlocker(state, sibling)) {
      return { id: 'sibling', price: cost(state, 'staff', 'sibling'), jobsPerSecond: sibling.jobsPerSecond[0],
        ready: canBuy(state, 'staff', 'sibling') };
    }
    return null;
  }

  function pendingTips(state, view, queued = new Set()) {
    return TIPS.filter(tip => !state.flags['tip:' + tip.id] && !queued.has(tip.id) && tip.when(state, view));
  }

  // Called once when a pre-tips save first opens, before its offline earnings
  // arrive. New discoveries during catch-up still qualify for their own tips.
  function legacyTipFlags(state) {
    const seen = {};
    for (const tip of TIPS) {
      if (tip.seenBefore(state)) seen['tip:' + tip.id] = true;
    }
    if (stats(state).throttle < 1) seen['tip:heat'] = true;
    return seen;
  }

  // Number formatting (kept here so it's tested alongside the math)

  // Short-scale names used across idle games, largest first. Past decillions, standard
  // notation falls back to scientific so a long-lived save never prints "$8000000.00T".
  const SUFFIXES = [[1e33, 'Dc'], [1e30, 'No'], [1e27, 'Oc'], [1e24, 'Sp'], [1e21, 'Sx'], [1e18, 'Qi'],
    [1e15, 'Qa'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  const NOTATIONS = ['standard', 'scientific', 'engineering'];
  let notation = 'standard';
  const wholeDollars = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0,
  });

  // The player's number style (a display preference kept by the page, never in the save).
  function setNotation(value) {
    notation = NOTATIONS.includes(value) ? value : 'standard';
    return notation;
  }
  const getNotation = () => notation;

  // Round x to `places` decimals in one direction. The tiny nudge stops binary fractions from
  // tipping a value like 16.999999999 (really 17) down a step: floor of 1.7e40/1e39 is 17.0.
  const roundedText = (x, places, round) => {
    const scaled = x * 10 ** places;
    const nudged = round === Math.ceil ? scaled - 1e-9 : scaled + 1e-9;
    return (round(nudged) / 10 ** places).toFixed(places);
  };

  // "$4.20e15" (scientific) or "$42.0e15" (engineering: exponent a multiple of 3),
  // always three significant digits.
  function exponentMoney(n, round, step) {
    let exponent = Math.floor(Math.log10(n));
    exponent -= ((exponent % step) + step) % step;
    for (let attempt = 0; attempt < 2; attempt++) {
      const mantissa = n / 10 ** exponent;
      const text = roundedText(mantissa, mantissa >= 100 ? 0 : mantissa >= 10 ? 1 : 2, round);
      if (Number(text) < 10 ** step || attempt) return '$' + text + 'e' + exponent;
      exponent += step;  // rounding carried over, e.g. 9.999e15 → 1.00e16
    }
  }

  // mode 'floor' for money you have (never show more than you own), 'ceil' for prices.
  function formatMoney(n, mode) {
    const round = mode === 'ceil' ? Math.ceil : Math.floor;
    if (!Number.isFinite(n)) return '$' + n;
    if (n < 10000) return '$' + round(n).toLocaleString('en-US');
    if (notation !== 'standard') {
      return n < 1e6 ? '$' + round(n).toLocaleString('en-US') : exponentMoney(n, round, notation === 'engineering' ? 3 : 1);
    }
    if (n >= SUFFIXES[0][0] * 1000) return exponentMoney(n, round, 1);
    for (let i = 0; i < SUFFIXES.length; i++) {
      const [size, suffix] = SUFFIXES[i];
      if (n < size) continue;
      const text = roundedText(n / size, 2, round);
      // Rounding up can reach 1000 (e.g. "$1000.00K"); show the next name instead ("$1.00M").
      if (Number(text) >= 1000 && i > 0) return '$' + roundedText(n / SUFFIXES[i - 1][0], 2, round) + SUFFIXES[i - 1][1];
      return '$' + text + suffix;
    }
    return '$' + round(n);
  }

  // Exact dollars ("$313,597,195") while that stays readable; the player's notation beyond it.
  function formatExactMoney(n, mode = 'floor') {
    const limit = notation === 'standard' ? 1e15 : 1e6;
    return Number.isFinite(n) && n < limit ? wholeDollars.format(n) : formatMoney(n, mode);
  }

  // Goal and target amounts without trailing zeros: "$80B", "$2.03B", "$1.5M", "$5.5e7".
  function formatShortMoney(n, mode = 'ceil') {
    if (Number.isFinite(n) && n < 10000) return wholeDollars.format(n);
    return formatMoney(n, mode).replace(/\.(\d*?)0+(?=[A-Za-z])/, (m, kept) => (kept ? '.' + kept : ''));
  }

  function formatRate(n) {
    if (n < 10) return '$' + n.toFixed(2) + '/s';
    if (n < 1000) return '$' + n.toFixed(1) + '/s';
    return formatMoney(n) + '/s';
  }

  function formatNumber(n) {
    return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(1);
  }

  function formatDuration(seconds) {
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm ' + (s % 60) + 's';
    return s + 's';
  }

  function formatPayback(seconds) {
    return Number.isFinite(seconds) && seconds > 0 ? 'Pays back in ' + formatDuration(Math.ceil(seconds)) : '';
  }

  function formatAffordable(seconds) {
    if (seconds === 0) return 'Affordable now';
    return Number.isFinite(seconds) && seconds > 0 ? 'Affordable in ' + formatDuration(Math.ceil(seconds)) : '';
  }

  const api = {
    MANAGER, BOARD_STARS, BOARD_RULES, CHALLENGES, runManager, setManagerBudget, challengeStatus, abandonChallenge,
    REWARDS, overtimeStatus, startOvertime, canDoubleOffline, doubleOffline,
    FIRE, fireStatus, fireInsuranceRefund,
    POWER, signatureUI, powerUnlocked, setPower, powerSweetSpot, bestPower,
    DECOR_SLOTS, DECORATIONS, decorPicker, equipDecor, refreshDecor, markDecorSeen, takeDecorNotice,
    NEWS, HEADLINES, pickHeadline, TIPS, TIP_VISIBLE_MS, pendingTips, legacyTipFlags, nextStep,
    CONFIG, MILESTONES, MACHINES, COOLERS, UPGRADES, STAFF, LOCATIONS, EVENTS, SAVE_VERSION, BONUS,
    CONTRACTS, CONTRACT_RULES, contractOffers, contractStatus, signContract, endContract, PRESTIGE, PERK_TIERS, REPEAT_PERKS, nextPerkTier, repeatPerkCounts, ACHIEVEMENTS,
    lookup, newState, milestoneMult, nextMilestone, modifiers, stats: readStats,
    price, cost, ownedCount, requirementBlocker, meetsRequirements, purchaseStatus, requirementText,
    isRevealed, revealPoint, nextReveal, canBuy, buy,
    bulkCost, maxAffordable, buyMany, cheapestCoolerFor, runSysadmin, bestBuy, purchaseQuote, buyRecommendation, secondsToAfford,
    click, tappingBoost, advance, catchUp, nextBonusGap, markBonusAppeared, rollBonusReward, claimBonus, missBonus, newAchievements,
    machineCount, activeOutcome, startEvent, respondToEvent, tickEvents, clearIncidents,
    STAGES, RELOCATION, currentStage, nextStage, runSites, hasSite, moveProgress, canMove, moveDestinations, franchiseChoices, moveTo, starsForEarnings, pendingStars, nextStarAt, canSell, sellStartup, earn,
    reputationMultiplier, runReputationMultiplier, nextPerkOffer, pickPerk, runSummary, runStartCash, goalStrip,
    GOALS, GOAL_TEMPLATES, ensureGoals, goalList, claimGoal, swapGoal,
    serialize, deserialize,
    formatMoney, formatExactMoney, formatShortMoney, NOTATIONS, setNotation, getNotation,
    formatRate, formatNumber, formatDuration, formatPayback, formatAffordable,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Economy = api;
})(typeof window !== 'undefined' ? window : globalThis);
