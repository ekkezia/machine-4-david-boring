import { defaultServer } from '../config.js';
import { isMobile } from '../utils.js';

(function () {
  // Add a test button to verify click/alert works at all
  const debugBtn = document.createElement('button');
  debugBtn.textContent = 'DEBUG BUTTON';
  gyroBtn.style.position = 'fixed';
  gyroBtn.style.top = '30%';
  gyroBtn.style.left = '50%';
  gyroBtn.style.transform = 'translate(-50%, 0)';
  gyroBtn.style.zIndex = 100000;
  gyroBtn.style.display = 'block';
  gyroBtn.style.background = '#222';
  gyroBtn.style.color = '#fff';
  gyroBtn.style.border = '2px solid #fff';
  gyroBtn.style.padding = '16px 32px';
  gyroBtn.style.fontSize = '1.3rem';
  gyroBtn.style.borderRadius = '12px';
  gyroBtn.style.boxShadow = '0 4px 32px 0 rgba(0,0,0,0.25)';
  gyroBtn.style.cursor = 'pointer';
  gyroBtn.style.pointerEvents = 'auto';
  document.body.appendChild(gyroBtn);
  document.body.appendChild(gyroBtn); // move to end of body for stacking
  // redirect to /  if on desktop device
  if (!isMobile) {
    const currentUrl = new URL(window.location.href);
    currentUrl.pathname = '/';
    window.location.href = currentUrl.href;
  }

  let status = null;
  let gyroEnabled = false;

  // Always create gyroBtn first so it exists for display logic
  let gyroBtn = document.createElement('button');
  gyroBtn.textContent = 'Enable Gyro';
  gyroBtn.style.transform = 'translateX(-50%)';
  gyroBtn.style.left = '50%';
  gyroBtn.style.width = 'fit-content';
  gyroBtn.style.border = '1px solid rgba(255,255,255,1)';
  gyroBtn.style.position = 'relative';
  gyroBtn.style.zIndex = 100000;
  gyroBtn.style.display = 'block';
  document.body.appendChild(gyroBtn);

  const guestPanelEl = document.getElementById('guest-panel');
  const roomInputContainerEl = document.getElementById('room-input-container');
  const gyroDependentEls = [];
  let gyroNotice = null;

  if (guestPanelEl) {
    const existingParagraphs = guestPanelEl.querySelectorAll('p');
    existingParagraphs.forEach((el) => gyroDependentEls.push(el));

    gyroNotice = document.createElement('p');
    gyroNotice.innerHTML = `You have decided to use your mobile device as a remote. Gyroscope access is required to use your mobile device as a controller for [MACHINE #4] music video.<br /><br />Tap "Enable Gyro" to continue.`;
    gyroNotice.style.margin = '0 0 8px 0';
    gyroNotice.style.fontSize = '1.2rem';
    gyroNotice.style.color = '#ffffff';
    gyroNotice.style.textAlign = 'center';
    guestPanelEl.insertBefore(gyroNotice, guestPanelEl.firstChild);

    // If gyro is already enabled, show notice and room input immediately, else show gyroBtn
    let gyroPermissionNotRequired =
      window.DeviceOrientationEvent &&
      typeof DeviceOrientationEvent.requestPermission !== 'function';
    if (gyroPermissionNotRequired) {
      toggleRoomInputAvailability(true);
      if (gyroBtn) gyroBtn.style.display = 'none';
    } else if (window.gyroEnabled) {
      toggleRoomInputAvailability(true);
      if (gyroBtn) gyroBtn.style.display = 'none';
    } else {
      if (gyroBtn) gyroBtn.style.display = 'block';
    }
  }

  function toggleRoomInputAvailability(enabled) {
    if (roomInputContainerEl) {
      roomInputContainerEl.style.display = enabled ? 'flex' : 'none';
    }
    gyroDependentEls.forEach((el) => {
      el.style.display = enabled ? '' : 'none';
    });
    if (gyroNotice) {
      gyroNotice.style.display = enabled ? 'none' : 'block';
    }
  }

  const enterBtn = document.createElement('button');
  enterBtn.textContent = status ?? 'Enter';
  enterBtn.style.display = 'none';
  enterBtn.style.pointerEvents = 'auto';
  enterBtn.style.zIndex = 9999;

  if (roomInputContainerEl && roomInputContainerEl.children.length === 0) {
    for (let i = 0; i < 4; i++) {
      const s = document.createElement('span');
      Object.assign(s.style, {
        width: '40px',
        height: '60px',
        background: '#ccc',
        borderRadius: '8px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '20px',
        fontWeight: '600',
      });
      s.textContent = '';
      roomInputContainerEl.appendChild(s);
    }
    roomInputContainerEl.appendChild(enterBtn);
  }

  toggleRoomInputAvailability(false);

  // --- GYRO ARROW UI ---
  // === Compass that rotates with gyroscope ===

  // create a centering wrapper for the compass
  const compassCenterWrapper = document.createElement('div');
  compassCenterWrapper.style.position = 'absolute';
  compassCenterWrapper.style.left = '50%';
  compassCenterWrapper.style.top = '10%';
  compassCenterWrapper.style.transform = 'translateX(-50%)';
  compassCenterWrapper.style.display = 'none';
  compassCenterWrapper.style.zIndex = 1000;

  // create the compass container (rotated)
  const compassWrapper = document.createElement('div');
  compassWrapper.style.width = '80vw';
  compassWrapper.style.height = '80vw';
  compassWrapper.style.border = '2px solid #fff';
  compassWrapper.style.borderRadius = '50%';
  compassWrapper.style.display = 'flex';
  compassWrapper.style.alignItems = 'center';
  compassWrapper.style.justifyContent = 'center';
  compassWrapper.style.transition = 'transform 0.1s linear';
  compassWrapper.style.transformOrigin = 'center center';
  compassWrapper.style.userSelect = 'none';
  compassWrapper.style.pointerEvents = 'none';

  compassCenterWrapper.appendChild(compassWrapper);
  document.body.append(compassCenterWrapper);
  compassCenterWrapper.style.display = 'none';
  compassWrapper.style.transform = `rotate(${-processedUnit}deg)`;

  // add the arrow (▲)
  const arrow = document.createElement('div');
  arrow.textContent = '▲';
  arrow.style.position = 'absolute';
  arrow.style.top = '4px';
  arrow.style.left = '50%';
  arrow.style.transform = 'translateX(-50%)';
  arrow.style.fontSize = '18px';
  arrow.style.color = '#fff';
  compassWrapper.appendChild(arrow);

  // create gyro info under compass
  const compassInfo = document.createElement('div');
  compassInfo.style.position = 'absolute';
  compassInfo.style.top = '50%';
  compassInfo.style.left = '50%';
  compassInfo.style.transform = 'translate(-50%, -50%)';
  compassInfo.style.color = 'white';
  compassInfo.style.textAlign = 'center';
  compassWrapper.appendChild(compassInfo);

  document.body.append(compassWrapper);

  // handle orientation
  let lastAlpha = null;
  let currentRotation = 0; // cumulative rotation

  function handleOrientation(event) {
    if (event.alpha == null) return;

    if (lastAlpha === null) {
      lastAlpha = event.alpha;
      return;
    }

    // compute change since last event
    let delta = event.alpha - lastAlpha;

    // handle wrap-around (0 -> 360)
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;

    currentRotation += delta; // with delta

    let processedUnit =
      event.alpha > 180 ? (360 - event.alpha) * -1 : event.alpha; // direct take from event alpha result, but recalibrated to -180 -> 180
    // send delta  & gyro alpha to socket

    const roomCode = localStorage.getItem('room-code');
    socket.emit('gyro', {
      room: roomCode,
      delta: delta.toFixed(2),
      gyro: processedUnit,
    });

    // update compass UI
    compassWrapper.style.transform = `rotate(${-processedUnit}deg)`;

    // print delta on compass info
    compassInfo.innerText = `Delta: ${delta.toFixed(
      2,
    )} || Rotation: ${processedUnit.toFixed(2)}`;

    lastAlpha = event.alpha;
  }

  // request permission if needed (for iOS)
  async function enableCompass() {
    alert('enableCompass called');
    if (gyroEnabled) {
      alert('Gyro already enabled, skipping permission.');
      return true;
    }

    try {
      if (
        typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function'
      ) {
        alert('Requesting DeviceOrientationEvent permission...');
        ok = (await DeviceOrientationEvent.requestPermission()) === 'granted';
        alert('Permission result: ' + ok);

        return (ok = true);
      } else {
        alert(
          'No DeviceOrientationEvent.requestPermission; assuming permission not required.',
        );
      }
    } catch (err) {
      ok = false;
      alert(
        'Compass permission request failed: ' +
          (err && err.message ? err.message : err),
      );
    }

    if (!ok) {
      if (gyroNotice) {
        gyroNotice.textContent = 'Gyro is required. Permission denied.';
      }
      alert('Gyroscope access is required. (Permission denied)');
      return false;
    }

    window.addEventListener('deviceorientation', handleOrientation, true);
    gyroEnabled = true;
    toggleRoomInputAvailability(true);
    // Only hide the button if gyro is truly enabled
    if (gyroBtn && gyroEnabled) gyroBtn.style.display = 'none';
    alert('Gyro enabled and event listener added.');
    return true;
  }

  // --- ROOM INPUT HANDLING ---
  (function enableInlineRoomTyping() {
    let hidden = document.getElementById('gc-room-hidden');
    if (!hidden) {
      hidden = document.createElement('input');
      Object.assign(hidden, {
        type: 'text',
        id: 'gc-room-hidden',
        autocomplete: 'off',
        autocapitalize: 'characters',
        maxLength: 4,
      });
      Object.assign(hidden.style, {
        position: 'absolute',
        left: '-9999px',
        opacity: '0',
      });
      document.body.appendChild(hidden);
    }

    function updateSpans(val) {
      const text = (val || '').toString().toUpperCase().slice(0, 4);
      for (let i = 0; i < 4; i++) {
        roomInputContainerEl.children[i].textContent = text[i] || '';
      }
      const mirror = document.getElementById('gc-room');
      if (mirror) mirror.value = text;
      enterBtn.style.display = text.length >= 4 ? 'inline' : 'none';
    }

    roomInputContainerEl.addEventListener('click', () => hidden.focus());
    hidden.addEventListener('input', () => updateSpans(hidden.value));
    hidden.addEventListener('paste', (e) => {
      const text =
        (e.clipboardData || window.clipboardData).getData('text') || '';
      hidden.value = text.toUpperCase().slice(0, 4);
      updateSpans(hidden.value);
      e.preventDefault();
    });

    updateSpans(hidden.value);
  })();

  // --- SOCKET / ROOM JOIN ---
  let socket = null;
  socket = io(defaultServer);
  socket.on('join-result', async (data) => {
    if (data.success && data.source === 'remote') {
      localStorage.setItem('room-code', data.room); // set to LS
      enableCompass();
      status = 'OK';
      enterBtn.textContent = 'OK';
      setTimeout(() => {
        if (guestPanelEl) guestPanelEl.style.display = 'none';
        compassWrapper.style.display = 'block';
        compassCenterWrapper.style.display = 'block';
      }, 1000);
    } else alert('Wrong room code.');
  });

  enterBtn.addEventListener('click', () => {
    // alert('abcd');
    const hiddenEl = document.getElementById('gc-room-hidden');
    if (!hiddenEl) return alert('Room input not found');
    const code = (hiddenEl.value || '').trim().toUpperCase();
    if (code.length < 4) return alert('Enter full room code');

    if (!socket) socket = io(defaultServer);

    socket.emit('join-room', code, 'remote');
  });

  gyroBtn.addEventListener('click', async () => {
    alert('click gyro');
    const ok = await enableCompass();
    if (ok) gyroBtn.style.display = 'none'; //
  });
})();
