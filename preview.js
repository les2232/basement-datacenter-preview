/* A preview gets its own storage namespace, including settings, backups and Undo. */
(function (root) {
  'use strict';

  const REAL_SAVE_KEY = 'basement-datacenter-save';

  function createChannel(release) {
    const preview = release !== 'live';
    function key(name) { return preview ? name + '-preview' : name; }

    function readRealSave(storage, readSave, now) {
      if (!preview) throw new Error('Save copying is only available in the preview.');
      let serialized;
      try { serialized = storage.getItem(REAL_SAVE_KEY); }
      catch { throw new Error('Your browser could not read the save on this device.'); }
      if (!serialized) throw new Error('No game save was found in this browser. You can also import a backup code.');
      try { return readSave(serialized, now); }
      catch { throw new Error('This game save could not be read. Try importing a backup code.'); }
    }
    return { preview, key, saveKey: key(REAL_SAVE_KEY), readRealSave };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createChannel };
  else root.GameChannel = createChannel(document.documentElement.dataset.release);
})(typeof window === 'undefined' ? globalThis : window);
