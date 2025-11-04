import { defaultServer } from '../config';
import { isMobile } from '../utils';

(function () {
  // redirect to /  if on desktop device
  if (!isMobile) {
    const currentUrl = new URL(window.location.href);
    currentUrl.pathname = '/';
    window.location.href = currentUrl.href;
  }

  let status = null;

  const enterBtn = document.createElement('button');
  enterBtn.textContent = status ?? 'Enter';
  enterBtn.style.display = 'none';
  enterBtn.style.pointerEvents = 'auto';
  enterBtn.style.zIndex = 9999;

  const roomInputContainerEl = document.getElementById('room-input-container');
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

  // --- GYRO ARROW UI ---
  // === Compass that rotates with gyroscope ===

  // create the compass container
  const compassWrapper = document.createElement('div');
  compassWrapper.style.position = 'relative';
  compassWrapper.style.width = '80vw';
  compassWrapper.style.height = '80vw';
  compassWrapper.style.border = '2px solid #fff';
  compassWrapper.style.borderRadius = '50%';
  compassWrapper.style.display = 'flex';
  compassWrapper.style.alignItems = 'center';
  compassWrapper.style.justifyContent = 'center';
  compassWrapper.style.marginLeft = '10px';
  compassWrapper.style.transition = 'transform 0.1s linear';
  compassWrapper.style.transformOrigin = 'center center';
  compassWrapper.style.userSelect = 'none';
  compassWrapper.style.pointerEvents = 'none';
  compassWrapper.style.display = 'none';

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
    const ok =
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
        ? (await DeviceOrientationEvent.requestPermission()) === 'granted'
        : true;

    if (!ok) {
      alert('denied');

      console.warn('Compass permission denied');
      return;
    }

    window.addEventListener('deviceorientation', handleOrientation, true);
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
      const guestPanelEl = document.getElementById('guest-panel');
      status = 'OK';
      enterBtn.textContent = 'OK';
      setTimeout(() => {
        guestPanelEl.style.display = 'none';
        compassWrapper.style.display = 'block';
      }, 1000);
    } else alert('Wrong room code.');
  });

  enterBtn.addEventListener('click', () => {
    const hiddenEl = document.getElementById('gc-room-hidden');
    if (!hiddenEl) return alert('Room input not found');
    const code = (hiddenEl.value || '').trim().toUpperCase();
    if (code.length < 4) return alert('Enter full room code');

    if (!socket) socket = io(defaultServer);

    socket.emit('join-room', code, 'remote');
  });

  const gyroBtn = document.createElement('button');
  gyroBtn.textContent = 'Enable Gyro';
  gyroBtn.style.position = 'fixed';
  gyroBtn.style.top = '10px';
  gyroBtn.style.left = '10px';
  gyroBtn.style.zIndex = 9999;
  document.body.appendChild(gyroBtn);

  gyroBtn.addEventListener('click', async () => {
    await enableCompass();
    gyroBtn.style.display = 'none'; // hide after enabling
  });
})();
