/* A room photograph is made from the same local vector layers that are on screen. */
(() => {
  'use strict';

  async function imageFrom(source) {
    const image = new Image();
    image.src = source;
    await image.decode();
    return image;
  }

  // The live room paints a few tiny lights and the fan blades over its SVG.
  // Copy their current pose into the export without copying any controls.
  function appendAccents(equipment, room, bounds) {
    const ns = equipment.namespaceURI;
    for (const lamp of room.querySelectorAll('.doll-led, .doll-rotor')) {
      const x = bounds.x + bounds.width * parseFloat(lamp.style.left) / 100;
      const y = bounds.y + bounds.height * parseFloat(lamp.style.top) / 100;
      const size = bounds.width * parseFloat(lamp.style.width) / 100;
      if (lamp.classList.contains('doll-led')) {
        const light = document.createElementNS(ns, 'circle');
        light.setAttribute('cx', x + size / 2);
        light.setAttribute('cy', y + size / 2);
        light.setAttribute('r', size / 2);
        light.setAttribute('fill', getComputedStyle(lamp).backgroundColor);
        light.setAttribute('opacity', getComputedStyle(lamp.parentElement).opacity);
        equipment.append(light);
      } else {
        const fan = lamp.firstElementChild.cloneNode(true);
        const group = document.createElementNS(ns, 'g');
        const degrees = Number.parseFloat(fan.style.transform.replace('rotate(', '')) || 0;
        group.setAttribute('transform', `translate(${x + size / 2} ${y + size / 2}) matrix(.9 .39 0 1 0 0) rotate(${degrees})`);
        fan.removeAttribute('style');
        fan.setAttribute('x', -size / 2);
        fan.setAttribute('y', -size / 2);
        fan.setAttribute('width', size);
        fan.setAttribute('height', size);
        group.append(fan);
        equipment.append(group);
      }
    }
  }

  async function capture(svg) {
    const room = svg.closest('#room');
    const scenery = room.querySelector('.doll-scenery');
    const equipment = svg.cloneNode(true);
    equipment.querySelectorAll('.doll-decor-targets, .doll-count, [data-decor-slot]').forEach(node => node.remove());
    const bounds = svg.viewBox.baseVal;
    appendAccents(equipment, room, bounds);
    const width = Math.round(bounds.width * 2);
    const height = Math.round(bounds.height * 2);
    equipment.setAttribute('width', width);
    equipment.setAttribute('height', height);
    const encoded = new XMLSerializer().serializeToString(equipment);
    const roomStyle = getComputedStyle(room);
    const edge = roomStyle.getPropertyValue('--scene-bg').trim();
    const center = roomStyle.getPropertyValue('--scene-ambient').trim();
    const [background, foreground] = await Promise.all([
      imageFrom(scenery.src),
      imageFrom('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(encoded)),
      document.fonts.ready,
    ]);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    const glow = ctx.createRadialGradient(width / 2, height * .59, 0, width / 2, height * .59, width * .62);
    glow.addColorStop(0, center);
    glow.addColorStop(1, edge);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(background, 0, 0, width, height);
    ctx.drawImage(foreground, 0, 0, width, height);
    ctx.font = '800 24px Archivo, sans-serif';
    ctx.fillStyle = '#f3dfc6';
    ctx.textAlign = 'right';
    ctx.fillText("Mom, It's a Startup", width - 24, height - 23);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      result => result ? resolve(result) : reject(new Error('Could not make the room PNG')), 'image/png'));
    return new File([blob], 'mom-startup-room-' + new Date().toISOString().slice(0, 10) + '.png', { type: 'image/png' });
  }

  function canShare(file) {
    try {
      return typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] }) === true;
    } catch {
      return false;
    }
  }

  function download(file) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
  }

  window.RoomSnapshot = { capture, canShare, download };
})();
