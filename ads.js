'use strict';

// AdSense H5 Games, with a separate Google Privacy & messaging tag so the
// placement library can wait for the player's privacy choices.
(function () {
  const NO_FILL_RETRY_MS = 60_000;
  const GOOGLE_VENDOR_ID = 755;
  const STORAGE_PURPOSE_ID = 1;

  function create(win, config, ui = {}) {
    const publisher = /^(?:ca-)?(pub-\d{16})$/.exec(config.publisherId || '')?.[1];
    const enabled = config.enabled === true && Boolean(publisher);
    let started = false, eligible = false, sound = false;
    let consentReady = false, consentAllowsAds = false, consentDialog = false, outsideRegion = false;
    let privacyReady = false, libraryRequested = false, libraryReady = false;
    let placement = null, retry = null;

    function clearRetry() {
      if (retry !== null) win.clearTimeout(retry);
      retry = null;
    }

    function withdrawOffer() {
      clearRetry();
      if (placement && !placement.clicked) {
        placement = null;
        ui.onOffer?.(false);
      }
    }

    function canPrepare() {
      return started && eligible && consentReady && consentAllowsAds && libraryReady;
    }

    function schedule(delay = 0) {
      if (!canPrepare() || retry !== null || placement) return;
      // Google disallows starting a new break from inside another API callback.
      retry = win.setTimeout(() => { retry = null; prepare(); }, delay);
    }

    function prepare() {
      if (!canPrepare() || placement) return;
      const ticket = { showAd: null, clicked: false, paused: false, outcome: null, grant: null };
      placement = ticket;

      function resume() {
        if (!ticket.paused) return;
        ticket.paused = false;
        ui.onResume?.();
      }
      function done() {
        if (placement !== ticket) return;
        resume();
        const unavailable = ticket.clicked && ticket.outcome !== 'viewed';
        placement = null;
        // Reserve the next attempt before notifying UI, which may re-evaluate eligibility.
        schedule(ticket.outcome === 'viewed' ? 0 : NO_FILL_RETRY_MS);
        ui.onOffer?.(false);
        if (unavailable) ui.onUnavailable?.();
      }
      try {
        win.adBreak({
          type: 'reward', name: 'startup_optional_reward',
          beforeReward(showAd) {
            if (placement !== ticket || ticket.clicked || !canPrepare() || typeof showAd !== 'function') return;
            ticket.showAd = showAd;
            ui.onOffer?.(true);
          },
          beforeAd() {
            if (placement !== ticket || !ticket.clicked || ticket.paused) return;
            ticket.paused = true;
            ui.onPause?.();
          },
          adViewed() {
            if (placement !== ticket || !ticket.clicked || ticket.outcome) return;
            ticket.outcome = 'viewed';
            ticket.grant();
          },
          adDismissed() {
            if (placement === ticket && ticket.clicked && !ticket.outcome) ticket.outcome = 'dismissed';
          },
          afterAd: resume,
          adBreakDone: done,
        });
      } catch { done(); }
    }

    function loadLibrary() {
      if (!consentReady || !consentAllowsAds || !eligible) return;
      if (libraryRequested) { schedule(); return; }
      libraryRequested = true;
      const client = 'ca-' + publisher;
      const tag = win.document.createElement('script');
      tag.async = true;
      tag.crossOrigin = 'anonymous';
      tag.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + client;
      tag.dataset.adClient = client;
      if (config.testMode === true || new URLSearchParams(win.location.search).get('adtest') === '1') {
        tag.dataset.adbreakTest = 'on';
      }
      win.adsbygoogle = win.adsbygoogle || [];
      win.adBreak = win.adConfig = options => win.adsbygoogle.push(options);
      win.adConfig({ preloadAdBreaks: 'on', sound: sound ? 'on' : 'off',
        onReady() { libraryReady = true; schedule(); } });
      win.document.head.appendChild(tag);
    }

    function consentChanged(data, success) {
      const open = success === true && data?.eventStatus === 'cmpuishown';
      if (consentDialog !== open) {
        consentDialog = open;
        ui.onConsentDialog?.(open);
      }
      // Unknown region, incomplete decision, a failed CMP, or a refusal all keep
      // the H5 tag off. Google uses the complete TC string for its ad selection.
      const final = data?.eventStatus === 'tcloaded' || data?.eventStatus === 'useractioncomplete';
      // Non-applicable TCF responses are allowed to omit cmpStatus and all consent fields.
      outsideRegion = success === true && data?.gdprApplies === false &&
        (data.cmpStatus === undefined || data.cmpStatus === 'loaded');
      consentAllowsAds = !open && (outsideRegion || (success === true && data?.cmpStatus === 'loaded' &&
          data.gdprApplies === true && final && Boolean(data.tcString) &&
          data.purpose?.consents?.[STORAGE_PURPOSE_ID] === true &&
          data.vendor?.consents?.[GOOGLE_VENDOR_ID] === true));
      if (consentAllowsAds) loadLibrary();
      else withdrawOffer();
    }

    function start() {
      if (!enabled || started) return;
      started = true;
      const fc = win.googlefc = win.googlefc || {};
      fc.callbackQueue = fc.callbackQueue || [];
      fc.callbackQueue.push({ CONSENT_API_READY() {
        privacyReady = typeof win.googlefc.showRevocationMessage === 'function';
        ui.onPrivacy?.(privacyReady);
        if (typeof win.__tcfapi === 'function') win.__tcfapi('addEventListener', 2, consentChanged);
      } });
      fc.callbackQueue.push({ CONSENT_DATA_READY() { consentReady = true; loadLibrary(); } });

      // The standalone Privacy & messaging tag uses this frame as its presence signal.
      if (!win.frames.googlefcPresent) {
        const signal = win.document.createElement('iframe');
        signal.name = 'googlefcPresent';
        signal.title = 'Privacy messaging';
        signal.hidden = true;
        win.document.body.appendChild(signal);
      }
      const tag = win.document.createElement('script');
      tag.async = true;
      tag.src = 'https://fundingchoicesmessages.google.com/i/' + publisher + '?ers=1';
      win.document.head.appendChild(tag);
    }

    return {
      enabled, start,
      setEligible(value) {
        eligible = Boolean(value);
        if (!eligible) withdrawOffer();
        else if (enabled && started) loadLibrary();
      },
      setSound(value) {
        if (sound === Boolean(value)) return;
        sound = Boolean(value);
        if (libraryRequested && consentAllowsAds) win.adConfig({ sound: sound ? 'on' : 'off' });
      },
      show(onViewed) {
        const ticket = placement;
        if (!canPrepare() || !ticket?.showAd || ticket.clicked || typeof onViewed !== 'function' ||
            (win.navigator?.userActivation && !win.navigator.userActivation.isActive)) return false;
        ticket.clicked = true;
        ticket.grant = onViewed;
        const showAd = ticket.showAd;
        ticket.showAd = null;
        ui.onOffer?.(false);
        try { showAd(); }
        catch {
          if (placement === ticket) {
            placement = null;
            schedule(NO_FILL_RETRY_MS);
            if (ticket.paused) { ticket.paused = false; ui.onResume?.(); }
            ui.onUnavailable?.();
          }
          return false;
        }
        return true;
      },
      managePrivacy() {
        if (!enabled || !privacyReady) return false;
        if (!outsideRegion) { consentAllowsAds = false; withdrawOffer(); }
        win.googlefc.showRevocationMessage();
        return true;
      },
    };
  }

  if (typeof module === 'object' && module.exports) module.exports = { create };
  else window.RewardedAds = { create };
})();
