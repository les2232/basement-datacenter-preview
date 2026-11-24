/* First-party configuration. Only approved publishers should enable offers. */
(function (root) {
  'use strict';
  const settings = { "enabled": false, "testMode": false, "publisherId": "ca-pub-4025612409015219" };
  const rewards = {
    boostMultiplier: 1.15,
    boostSeconds: 10 * 60,
    cooldownSeconds: 30 * 60,
    offlineMinSeconds: 15 * 60,
    offlineMultiplier: 2,
    achievementBoosts: 10,
  };
  const config = Object.freeze({ ...settings, rewards: Object.freeze(rewards) });
  if (typeof module !== 'undefined' && module.exports) module.exports = config;
  else root.ADS = config;
})(typeof window !== 'undefined' ? window : globalThis);
