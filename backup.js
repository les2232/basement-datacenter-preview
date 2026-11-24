/* Save portability. These helpers never read the clock, storage or the player's device. */
(function (root) {
  'use strict';

  const E = typeof module !== 'undefined' && module.exports ? require('./economy.js') : root.Economy;
  const VERSION = '1.0.1'; // Player-facing release, shared with the Android wrapper.
  const MAX_SAVE_BYTES = 1024 * 1024;
  const MAX_WIRE_BYTES = MAX_SAVE_BYTES + 65536; // Leave room for gzip overhead.
  const MAX_CODE_CHARS = Math.ceil(MAX_WIRE_BYTES * 4 / 3) + 32;
  const SNAPSHOT_INTERVAL = 60 * 60, SNAPSHOT_COUNT = 3;
  const RAW_PREFIX = 'MIAS1:', GZIP_PREFIX = 'MIAS1G:';
  const BAD_CODE = "That code doesn't look right. Check you copied all of it.";
  const NO_GZIP = 'This backup is compressed. Open it in a browser that supports gzip backups.';
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });

  function readSave(serialized, now) {
    if (typeof serialized !== 'string' || serialized.length > MAX_SAVE_BYTES) throw Error(BAD_CODE);
    const raw = JSON.parse(serialized);
    // deserialize also recovers from a broken local save by creating a new game.
    // For a replacement, establish that this is a game save before allowing that path.
    if (!raw || Array.isArray(raw) || typeof raw !== 'object' ||
        !Number.isFinite(raw.money) || !Number.isFinite(raw.lifetime) || !Number.isFinite(raw.lastTick) ||
        !raw.machines || typeof raw.machines !== 'object' || Array.isArray(raw.machines) ||
        !E.MACHINES.some(machine => Object.hasOwn(raw.machines, machine.id))) throw Error(BAD_CODE);
    if (raw.version !== undefined && (!Number.isSafeInteger(raw.version) ||
        raw.version < 0 || raw.version > E.SAVE_VERSION)) throw Error(BAD_CODE);
    return E.deserialize(serialized, now);
  }

  // CRC-32 covers the payload bytes as transmitted, before decompression.
  const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
    let n = index;
    for (let bit = 0; bit < 8; bit++) n = n & 1 ? (n >>> 1) ^ 0xedb88320 : n >>> 1;
    return n;
  });
  function checksum(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
  }

  function base64url(bytes) {
    const chunks = [];
    for (let i = 0; i < bytes.length; i += 8192) {
      chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
    }
    return btoa(chunks.join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function transform(bytes, stream, limit) {
    const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > limit) {
          await reader.cancel();
          throw Error(BAD_CODE);
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  async function encodeSave(state, { compress = true } = {}) {
    let bytes = encoder.encode(E.serialize(state));
    if (bytes.length > MAX_SAVE_BYTES) throw Error('This save is too large to export.');
    let prefix = RAW_PREFIX;
    if (compress && typeof CompressionStream === 'function') {
      let gzip;
      try { gzip = new CompressionStream('gzip'); } catch { /* This browser can export plain codes. */ }
      if (gzip) {
        bytes = await transform(bytes, gzip, MAX_WIRE_BYTES);
        prefix = GZIP_PREFIX;
      }
    }
    return prefix + base64url(bytes) + '.' + checksum(bytes);
  }

  async function decodeSave(input, now) {
    if (typeof input !== 'string' || input.length > MAX_CODE_CHARS) throw Error(BAD_CODE);
    const parts = /^(MIAS1G?):([\w-]+)\.([0-9a-f]{8})$/.exec(input.trim());
    if (!parts) throw Error(BAD_CODE);
    const [, prefix, encoded, crc] = parts;
    if (prefix + ':' === GZIP_PREFIX && typeof DecompressionStream !== 'function') {
      throw Error(NO_GZIP);
    }
    try {
      let bytes = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      // Reject aliases using non-zero padding bits, even when they decode to the same bytes.
      if (bytes.length > MAX_WIRE_BYTES || base64url(bytes) !== encoded || checksum(bytes) !== crc) throw Error(BAD_CODE);
      if (prefix + ':' === GZIP_PREFIX) bytes = await transform(bytes, new DecompressionStream('gzip'), MAX_SAVE_BYTES);
      if (bytes.length > MAX_SAVE_BYTES) throw Error(BAD_CODE);
      return readSave(decoder.decode(bytes), now);
    } catch { throw Error(BAD_CODE); }
  }

  function compactCash(amount) {
    return E.formatMoney(amount).replace(/\.00(?=[KMBT]$)/, '').replace(/(\.\d)0(?=[KMBT]$)/, '$1');
  }

  function savedAge(lastTick, now) {
    const seconds = Math.max(0, Math.floor((now - lastTick) / 1000));
    for (const [unit, span] of [['day', 86400], ['hour', 3600], ['minute', 60]]) {
      if (seconds >= span) {
        const count = Math.floor(seconds / span);
        return count + ' ' + unit + (count === 1 ? '' : 's') + ' ago';
      }
    }
    return 'just now';
  }
  function preview(state, now) {
    return `Run ${state.runs + 1} · ${state.stars} stars · ${compactCash(state.lifetime)} this run · saved ${savedAge(state.lastTick, now)}`;
  }

  function advanceSnapshotClock(previousSeconds, deltaSeconds) {
    const elapsed = Number.isFinite(previousSeconds) && previousSeconds >= 0 ? previousSeconds % SNAPSHOT_INTERVAL : 0;
    const live = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    const total = elapsed + live;
    return { seconds: total % SNAPSHOT_INTERVAL, due: total >= SNAPSHOT_INTERVAL };
  }
  function rotateSnapshots(list, snapshot) {
    return [snapshot, ...list].slice(0, SNAPSHOT_COUNT);
  }
  function prepareReplacement(currentState, targetSerialized, now) {
    return { previous: E.serialize(currentState), state: readSave(targetSerialized, now) };
  }

  function gameInfo(state, { width, height, device, effects }) {
    const devices = { phone: 'Phone', tablet: 'Tablet', desktop: 'Desktop' };
    const location = Object.hasOwn(E.LOCATIONS, state.location) ? E.LOCATIONS[state.location].name : 'Unknown';
    const dimension = n => Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
    return [
      "Mom, It's a Startup " + VERSION,
      'Run: ' + (state.runs + 1), 'Stars: ' + state.stars, 'Location: ' + location,
      'Money earned this run: ' + compactCash(state.lifetime),
      'Playtime: ' + E.formatDuration(state.counters.liveSeconds),
      'Device: ' + (Object.hasOwn(devices, device) ? devices[device] : 'Unknown'),
      'Screen: ' + dimension(width) + ' × ' + dimension(height),
      'Effects: ' + (effects === 'Reduced' ? 'Reduced' : 'Full'),
    ].join('\n');
  }

  const api = { VERSION, MAX_CODE_CHARS, SNAPSHOT_INTERVAL, SNAPSHOT_COUNT, NO_GZIP, encodeSave, decodeSave,
    readSave, preview, advanceSnapshotClock, rotateSnapshots, prepareReplacement, gameInfo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Backup = api;
})(typeof window !== 'undefined' ? window : globalThis);
