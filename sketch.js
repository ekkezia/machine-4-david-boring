// Map & Audio, Cesium

import { defaultServer } from './config.js';
import { isMobile } from './utils.js';

// --- Cesium Standalone Logic ---
let viewer, movingPoint;
let audioCtx, source, analyser, timeDomainData, audioBuffer;
let interval;
let height = 100;
let idx = 0;
let intervalFrame = 100; // ms

// shared gyro state updated by Socket.IO messages (or device fallback)
const gyro = { alpha: null, beta: null, gamma: null };
let cameraHeading = 0; // store current camera rotation in radians - correlated with gyro's rotation

let socket = null;

// Loading States
let audioReady = false;
let mapReady = false;

// Modes
let hasSelectedMode = true;
let isGuest = false;

// UI Elements
// GYRO INFO UI
const gyroInfoUI = document.createElement('div');
gyroInfoUI.id = 'gyro-info-ui';
gyroInfoUI.style.position = 'fixed';
gyroInfoUI.style.left = '10px';
gyroInfoUI.style.top = '10px';
gyroInfoUI.style.zIndex = 30000;
gyroInfoUI.style.color = 'white';
gyroInfoUI.innerText = '00.00';
document.body.appendChild(gyroInfoUI);

const deltaInfoUI = document.createElement('div');
deltaInfoUI.id = 'delta-info-ui';
deltaInfoUI.style.position = 'fixed';
deltaInfoUI.style.right = '10px';
deltaInfoUI.style.top = '10px';
deltaInfoUI.style.zIndex = 30000;
deltaInfoUI.style.color = 'white';
deltaInfoUI.innerText = '00.00';
document.body.appendChild(deltaInfoUI);

const idUI = document.createElement('div');
idUI.id = 'id-ui';
idUI.style.position = 'fixed';
idUI.style.bottom = '10px';
idUI.style.right = '10px';
idUI.style.zIndex = 30000;
idUI.style.color = 'white';
idUI.innerText = '000@EKEZIA00';
document.body.appendChild(idUI);

// Create a small overlay UI
const ui = document.createElement('div');
ui.id = 'room-code-panel';
ui.style.position = 'fixed';
ui.style.width = '100vw';
ui.style.height = '100dvh';
ui.style.display = 'flex';
ui.style.flexDirection = 'column';
ui.style.justifyContent = 'center';
ui.style.alignItems = 'center';
ui.style.zIndex = 99;
ui.style.background = 'rgba(0,0,0,0.)';
ui.style.color = 'white';
ui.style.fontSize = '16px';
ui.style.pointerEvents = 'auto'; // panel itself is interactive
ui.style.opacity = 1;
ui.style.backdropFilter = 'blur(16px)';
ui.style.textAlign = 'center';
ui.style.transition =
  'backdrop-filter 0.7s cubic-bezier(.4,0,.2,1), background 0.7s cubic-bezier(.4,0,.2,1), opacity 0.7s cubic-bezier(.4,0,.2,1)';
ui.innerHTML = `
    <p style="width:400px;">Enter the room code on your mobile device to use it as remote control</p>

    <div id="room-input-container" style="display:flex;gap:6px;margin-bottom:6px"></div>
    <input id="gc-room" type="hidden" />
    <p>Don't have a mobile device?<br/ ></p>
    <div style="display:flex;gap:6px;margin-bottom:6px"><button id="gc-connect">AUTOPILOT</button></div>
  `;
// <div id='gc-status' style='margin-top:6px;font-size:12px;opacity:0.9'>
//   Disconnected
// </div>;

document.body.appendChild(ui);

// create visible digit spans
const roomInputContainerEl = document.getElementById('room-input-container');
if (roomInputContainerEl && roomInputContainerEl.children.length === 0) {
  for (let i = 0; i < 4; i++) {
    const s = document.createElement('span');
    s.style.width = '40px';
    s.style.height = '60px';
    s.style.background = '#ccc';
    s.style.borderRadius = '8px';
    s.style.display = 'inline-flex';
    s.style.alignItems = 'center';
    s.style.justifyContent = 'center';
    s.style.fontSize = '32px';
    s.style.fontWeight = '600';
    s.textContent = '';
    roomInputContainerEl.appendChild(s);
  }
}
// elements
const roomInput = document.getElementById('gc-room');
const roomInputContainer = document.getElementById('room-input-container');
const smoothEl = document.getElementById('gc-smooth');

// Create loading overlay
let loadingDiv = document.createElement('div');
loadingDiv.id = 'audio-loading';
loadingDiv.textContent = 'MACHINE #4';
loadingDiv.style.position = 'fixed';
loadingDiv.style.top = '0';
loadingDiv.style.left = '0';
loadingDiv.style.width = '100vw';
loadingDiv.style.height = '100vh';
loadingDiv.style.background = 'rgba(0,0,0,0.4)';
loadingDiv.style.color = 'white';
loadingDiv.style.display = 'flex';
loadingDiv.style.alignItems = 'center';
loadingDiv.style.justifyContent = 'center';
loadingDiv.style.fontSize = '6rem';
loadingDiv.style.zIndex = '999';
loadingDiv.style.backdropFilter = 'blur(16px)';
loadingDiv.style.filter = 'blur(4px)';
document.body.appendChild(loadingDiv);

// currentLon & currentLat is in interaction.js
window.addEventListener('DOMContentLoaded', () => {
  Cesium.Ion.defaultAccessToken =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJmZTU5NDc0ZC1hNDlkLTQ3MWUtYjI3Yi0xZWFjNDE2NTlhZWUiLCJpZCI6MzMwNzkzLCJpYXQiOjE3NTQ5MDY4MDF9.O3HwFCWurGQOrDKbLml-h6lQgfPZ8_1rzC-KIvUDgFg';
  viewer = new Cesium.Viewer('cesiumContainer', {
    terrain: Cesium.Terrain.fromWorldTerrain(),
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    navigationHelpButton: false,
    vrButton: false,
  });
  viewer.scene.globe.depthTestAgainstTerrain = true;

  // ensure camera can see point
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(currentLon, currentLat, height),
    orientation: {
      heading: 0, // always north
      pitch: Cesium.Math.toRadians(-15),
      roll: 0,
    },
  });

  // create moving point
  movingPoint = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(currentLon, currentLat, height),
    // point: { pixelSize: 10, color: Cesium.Color.RED },
  });

  // preload area around
  // --- Preload tiles around the current location (≈1 km radius) ---
  async function preloadLocalArea(lat, lon, radiusDeg = 0.01) {
    const steps = [-radiusDeg, 0, radiusDeg];
    for (const dx of steps) {
      for (const dy of steps) {
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(
            lon + dx,
            lat + dy,
            height,
          ),
        });
        // Wait one frame so Cesium requests the new tiles
        viewer.scene.requestRender();
        await new Promise((r) => setTimeout(r, 150)); // 150ms delay to let tiles queue
      }
    }

    // Return to the original position
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(
        currentLon,
        currentLat,
        height,
      ),
      orientation: {
        heading: 0, // always north
        pitch: Cesium.Math.toRadians(-15),
        roll: 0,
      },
    });

    console.log('✅ Preloaded local area tiles');
  }

  preloadLocalArea(currentLat, currentLon, 0.01).then(() => {
    console.log('Local area ready — starting playback');
    mapReady = true;

    setTimeout(() => {
      tryStartExperience();
    }, 1000);
  });

  viewer.scene.globe.maximumScreenSpaceError = 4.0; // coarser detail = faster

  loadAudio('/audio.wav').then(() => {
    audioReady = true;

    setTimeout(() => {
      tryStartExperience();
    }, 1000);
  });
});

function tryStartExperience() {
  if (audioReady && mapReady) {
    const loadingDiv = document.getElementById('audio-loading');
    if (loadingDiv) loadingDiv.remove();
    showPlayOnHover(); // your function to start playback/interaction
  }
}

// ==== inside your existing code, add these ====

async function loadAudio(url) {
  audioCtx = new AudioContext();
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  console.log('🎤 Audio loaded');
  audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
}

let startTime = 0; // when the playback started
let pauseTime = 0; // how many seconds have already played
const playBtn = document.getElementById('playBtn');
playBtn.style.pointerEvents = 'none'; // disable clicks globally
const playbackTimestamp = document.getElementById('playback-timestamp');
const pauseBtn = document.getElementById('pauseBtn');
pauseBtn.style.pointerEvents = 'none'; // disable clicks globally
const controls = document.getElementsByClassName('control-hover-area');

// --- SCRUBBER ---
let scrubber = document.getElementById('audio-scrubber');
if (!scrubber) {
  scrubber = document.createElement('input');
  scrubber.type = 'range';
  scrubber.id = 'audio-scrubber';
  scrubber.min = 0;
  scrubber.max = 100;
  scrubber.value = 0;
  scrubber.step = 0.01;
  scrubber.style.position = 'fixed';
  scrubber.style.left = '50%';
  scrubber.style.bottom = '70px';
  scrubber.style.transform = 'translateX(-50%)';
  scrubber.style.width = '60vw';
  scrubber.style.zIndex = 10001;
  scrubber.style.opacity = 0.8;
  document.body.appendChild(scrubber);
}

let scrubberIsDragging = false;

scrubber.addEventListener('input', (e) => {
  scrubberIsDragging = true;
  if (!audioBuffer) return;
  const percent = parseFloat(scrubber.value) / 100;
  const newTime = percent * audioBuffer.duration;
  if (playbackTimestamp) playbackTimestamp.textContent = formatTime(newTime);
});

scrubber.addEventListener('change', (e) => {
  if (!audioBuffer) return;
  const percent = parseFloat(scrubber.value) / 100;
  const newTime = percent * audioBuffer.duration;
  // Restart playback from newTime
  stopPlayback();
  startPlayback(newTime);
  startPlaybackTimestamp(newTime);
  pauseTime = newTime;
  scrubberIsDragging = false;
});
let isPlaying = false;
let isPaused = false;
let audioEnded = false;
let restartBtn;

function startPlayback(fromOffset = 0) {
  if (audioCtx.state === 'suspended') audioCtx.resume();

  source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  timeDomainData = new Float32Array(analyser.fftSize);

  source.connect(analyser);
  analyser.connect(audioCtx.destination);

  startTime = audioCtx.currentTime - fromOffset; // start time accounting for offset
  source.start(0, fromOffset); // start at offset seconds
  isPlaying = true;

  // fixed direction (north)
  let directionAngle = 0; // 0 radians = north

  interval = setInterval(() => {
    // count speed based on audio amplitude
    // --- Guest Mode: move map along audio ---
    analyser.getFloatTimeDomainData(timeDomainData);

    // Compute average amplitude to control speed
    let sum = 0;
    for (let i = 0; i < timeDomainData.length; i++) {
      sum += Math.abs(timeDomainData[i]);
    }
    const amplitude = sum / timeDomainData.length;

    let speed = amplitude * 0.001; // tweak as needed

    // Access as GUEST
    if (isGuest) {
      currentLat += speed * 2; // move northward
      currentLon += Math.sin(audioCtx.currentTime) * speed * 0.5; // small sideways movement for variation
      locDiv.innerText = `${currentLat.toFixed(6)}, ${currentLon.toFixed(6)}`;
      deltaInfoUI.innerText = amplitude;
      idUI.innerText = '0AUT0PIL0T00';

      // console.log('amp', amplitude);
      if (movingPoint && viewer) {
        const newPosition = Cesium.Cartesian3.fromDegrees(
          currentLon,
          currentLat,
          height,
        );
        movingPoint.position = newPosition;

        viewer.camera.setView({
          destination: newPosition,
          orientation: {
            heading: 0, // always north
            pitch: Cesium.Math.toRadians(-15),
            roll: 0,
          },
        });
      }
    } else {
      deltaInfoUI.innerText = amplitude;
      currentLat += speed;
    }

    // Update scrubber position if not dragging
    if (!scrubberIsDragging && audioBuffer && source && audioCtx) {
      let elapsed = audioCtx.currentTime - startTime;
      let percent = Math.max(0, Math.min(1, elapsed / audioBuffer.duration));
      scrubber.value = (percent * 100).toString();
    }

    // console.log(
    //   `→ Moving north | Lon: ${currentLon.toFixed(
    //     6,
    //   )} | Lat: ${currentLat.toFixed(6)}`,
    // );
  }, intervalFrame);

  source.onended = () => {
    stopPlayback();
    isPlaying = false;
    audioEnded = true;
    if (isPaused) return;
    pauseTime = 0; // reset
    // Change playBtn to restart mode
    if (playBtn) {
      playBtn.textContent = 'RESTART';
      playBtn.style.pointerEvents = 'auto';
      playBtn.onclick = function (e) {
        e.preventDefault();
        audioEnded = false;
        playBtn.textContent = 'PAUSE';
        startPlayback(0);
        startPlaybackTimestamp(0);
        // Remove credit overlay if present
        const credit = document.getElementById('credit-overlay');
        if (credit) credit.remove();
      };
    }
    // Hide pauseBtn
    if (pauseBtn) pauseBtn.style.opacity = '0';
    // Stop the timer
    stopPlaybackTimestamp();

    // Show credit overlay (always on top, blinking, and with a fixed restart button)
    let credit = document.getElementById('credit-overlay');
    if (credit) credit.remove();
    credit = document.createElement('div');
    credit.id = 'credit-overlay';
    credit.style.position = 'fixed';
    credit.style.top = '0';
    credit.style.left = '0';
    credit.style.width = '100vw';
    credit.style.height = '100vh';
    credit.style.display = 'flex';
    credit.style.flexDirection = 'column';
    credit.style.alignItems = 'center';
    credit.style.justifyContent = 'center';
    credit.style.zIndex = '2147483647';
    credit.style.pointerEvents = 'none';
    credit.style.background = 'rgba(0,0,0,0)';
    credit.innerHTML = `
      <div id="credit-blink" style="display:flex;flex-direction:column;align-items:center;pointer-events:auto;cursor:pointer;">
        <span style=\"font-size:1.1rem;opacity:0.7;letter-spacing:1px;\">CREATIVE DIRECTION & WEBSITE DEVELOPMENT BY</span>
        <span style=\"font-size:2.2rem;font-weight:700;line-height:1.2;\">ELIZABETH KEZIA WIDJAJA<br/>@EKEZIA</span>
      </div>
    `;
    document.body.appendChild(credit);
    // Blinking effect (same as loading)
    const creditBlink = document.getElementById('credit-blink');
    let blink = true;
    let blinkInterval = setInterval(() => {
      if (!document.body.contains(credit)) {
        clearInterval(blinkInterval);
        return;
      }
      creditBlink.style.opacity = blink ? '1' : '0.2';
      blink = !blink;
    }, 600);
    // Hide on hover, show on mouseleave
    creditBlink.addEventListener('mouseenter', () => {
      creditBlink.style.display = 'none';
    });
    creditBlink.addEventListener('mouseleave', () => {
      creditBlink.style.display = 'flex';
    });
    // Add a fixed restart button under the credit
    let creditRestart = document.getElementById('credit-restart-btn');
    if (creditRestart) creditRestart.remove();
    creditRestart = document.createElement('button');
    creditRestart.id = 'credit-restart-btn';
    creditRestart.textContent = 'RESTART';
    creditRestart.style.position = 'fixed';
    creditRestart.style.bottom = '8vh';
    creditRestart.style.left = '50%';
    creditRestart.style.transform = 'translateX(-50%)';
    creditRestart.style.zIndex = '2147483648';
    creditRestart.style.fontSize = '2rem';
    creditRestart.style.padding = '0.7em 2em';
    creditRestart.style.background = 'rgba(0,0,0,0.7)';
    creditRestart.style.color = 'white';
    creditRestart.style.border = 'none';
    creditRestart.style.borderRadius = '1em';
    creditRestart.style.cursor = 'pointer';
    creditRestart.style.pointerEvents = 'auto';
    creditRestart.style.fontFamily = 'inherit';
    document.body.appendChild(creditRestart);
    creditRestart.onclick = function (e) {
      e.preventDefault();
      // Remove credit overlay and restart button
      if (credit) credit.remove();
      if (creditRestart) creditRestart.remove();
      audioEnded = false;
      playBtn.textContent = 'PAUSE';
      startPlayback(0);
      startPlaybackTimestamp(0);
    };
  };
}

function pausePlayback() {
  if (!isPlaying) return;
  source.stop();
  clearInterval(interval);
  pauseTime = audioCtx.currentTime - startTime; // save current position
  isPlaying = false;
  if (playBtn) playBtn.textContent = 'PLAY';
}

function togglePlayback() {
  if (!playBtn || !pauseBtn) return;

  const canPlay = playBtn.style.pointerEvents !== 'none';
  const canPause = pauseBtn.style.pointerEvents !== 'none';

  if (isPlaying) {
    if (!canPause) return;
    pauseBtn.click();
  } else {
    if (!canPlay) return;
    playBtn.click();
  }
}

function stopPlayback() {
  if (source) {
    try {
      source.stop();
    } catch (e) {}
    source.disconnect();
    source = null; // Reset source so playback can be started again
  }
  clearInterval(interval);
  console.log('Playback stopped');
}

// ---- USER LOCATION
let currentLon = -74.006; // Initial longitude (New York City)
let currentLat = 40.7128; // Initial latitude
// --- USER LOCATION (LATITUDE & LONGITUDE) ---
const locDiv = document.createElement('div');
locDiv.id = 'location-display';
locDiv.style.position = 'fixed';
locDiv.style.bottom = '10px';
locDiv.style.left = '10px';
locDiv.style.color = 'white';
locDiv.style.zIndex = '10000';
locDiv.style.fontFamily = "'Wallpoet', sans-serif";
locDiv.innerText = '00.00, 00.00';
document.body.appendChild(locDiv);

function showUserLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        // update global lat & lon
        currentLat = lat;
        currentLon = lon;
        console.log(`User location: Latitude ${lat}, Longitude ${lon}`);
        // Optionally display on page
        locDiv.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
      },
      (error) => {
        console.error('Geolocation error:', error);
      },
    );
  } else {
    console.error('Geolocation is not supported by this browser.');
  }
}

// Call location function on page load
document.addEventListener('DOMContentLoaded', showUserLocation);

// ---- GYRO ----
// Connects to the server (Socket.IO) and applies incoming gyro messages to the global map.
(function () {
  let status = null;

  let socket = null;
  let last = { alpha: 0, beta: 0, gamma: 0 };
  let offset = { alpha: 0, beta: 0, gamma: 0 };
  let smoothing = 0.2;

  // On init, initialize socket early and request a room code from the server and prefill the room input
  socket = io(defaultServer);

  (async function assignRoom() {
    const tried = [];
    const candidates = [
      `${defaultServer}/api/new-room`,
      'http://localhost:5503/api/new-room',
      '/api/new-room',
    ];

    for (const url of candidates) {
      try {
        tried.push(url);
        // avoid http->https mixed content
        if (location.protocol === 'https:' && url.startsWith('http:')) {
          console.warn('Skipping mixed-content URL', url);
          continue;
        }
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) {
          console.warn('Non-OK response', resp.status, url);
          continue;
        }
        const j = await resp.json();
        // desktop join the room (guarded in case socket isn't ready)
        try {
          if (socket && typeof socket.emit === 'function') {
            socket.emit('join-room', j.room, 'desktop');
          }
        } catch (emitErr) {
          console.warn('socket.emit failed while assigning room:', emitErr);
        }
        if (j && j.room) {
          roomInput.value = j.room;
          for (let i = 0; i < roomInputContainer.children.length; i++) {
            roomInputContainer.children[i].textContent = j.room[i] || '';
          }
          // Add Enter Button
          // roomInputContainer.innerHTML += `<span id="gc-loading-room" style="margin-left:8px width:100%;display:flex;align-items:center;justify-content:center;">${
          //   !status ? 'Waiting...' : status
          // }</span>`;

          // roomInputContainer.innerHTML += `<button id="gc-enter-room" style="margin-left:8px width:100%;">Enter</button>`;
          console.log('Assigned room:', j.room, 'from', url);
          setStatus('Room assigned: ' + j.room);
          return;
        }
      } catch (err) {
        console.warn(
          'fetch failed for',
          url,
          err && err.message ? err.message : err,
        );
      }
    }

    console.warn('Could not get room from server; tried:', tried);
    setStatus('Room assignment failed — check server');
  })();

  function setStatus(s) {
    status = s;
  }
  // --- SOCKET
  socket = io(defaultServer);
  socket.on('join-result', (data) => {
    if (data.success && data.source === 'remote') {
      hasSelectedMode = true;
      // Change the UI Guest Panel
      // Hide the room code UI
      hideRoomCodePanel();
      status = 'OK';
      setTimeout(() => {
        playBtn.style.pointerEvents = 'auto'; // enable clicks globally
        pauseBtn.style.pointerEvents = 'auto'; // enable clicks globally
      }, 1000);
    } else console.log('Wrong room code.');
  });

  socket.on('gyro', (data) => {
    // Update Gyro UI
    gyroInfoUI.innerText = data.gyro;
    // deltaInfoUI.innerText = data.delta;
    idUI.innerText = data.id;

    // change distance of lon with delta
    if (isPlaying) {
      currentLat += Math.abs(Number(data.delta)) * 0.0001; // move according to how much you rotate your phone
    } // only move forward if music is playing

    // data.gyro controls rotation (turn left/right)
    const gyroValue = Number(data.gyro) || 0;

    // Adjust heading based on gyro — scale down so it’s not too sensitive
    cameraHeading = Cesium.Math.toRadians(gyroValue * 0.1 * -1); // radians per update (tweak multiplier)

    if (viewer) {
      const newPosition = Cesium.Cartesian3.fromDegrees(
        currentLon,
        currentLat,
        height,
      );

      viewer.camera.setView({
        destination: newPosition,
        orientation: {
          heading: cameraHeading, // rotate view left/right
          pitch: Cesium.Math.toRadians(-15), // slight downward angle
          roll: 0,
        },
      });
    }
  });

  socket.on('connect_error', (err) => {
    setStatus('Connect error');
    console.error('socket connect error', err);
  });

  // expose for debugging
  window._gyroBridge = {
    setSmoothing: (v) => {
      smoothing = v;
      smoothEl.value = v;
    },
  };
})();

// --- SOCKET ---

// UI ELEMENTS & LOGIC
// redirect to /remote/ if on mobile device — but only if that path exists
if (isMobile) {
  (async () => {
    try {
      const remoteIndex = new URL('/remote/index.html', window.location.origin)
        .href;
      // Try a HEAD request first; some hosts don't allow HEAD so fall back to GET
      let ok = false;
      try {
        const resp = await fetch(remoteIndex, { method: 'HEAD' });
        ok = resp && resp.ok;
      } catch (headErr) {
        try {
          const resp2 = await fetch(remoteIndex, { method: 'GET' });
          ok = resp2 && resp2.ok;
        } catch (getErr) {
          ok = false;
        }
      }

      if (ok) {
        const currentUrl = new URL(window.location.href);
        currentUrl.pathname = '/remote/';
        window.location.href = currentUrl.href;
      } else {
        console.warn(
          'Remote path not found; skipping mobile redirect to /remote/',
        );
      }
    } catch (err) {
      console.warn('Error checking remote path, skipping redirect', err);
    }
  })();
}

// UI elements
// Playback timestamp element
playbackTimestamp.id = 'playback-timestamp';
playbackTimestamp.style.position = 'fixed';
playbackTimestamp.style.bottom = '30px';
playbackTimestamp.style.left = '50%';
playbackTimestamp.style.transform = 'translateX(-50%)';
playbackTimestamp.style.color = 'white';
playbackTimestamp.style.fontFamily = "'Wallpoet', sans-serif";
playbackTimestamp.style.fontSize = '1.2rem';
playbackTimestamp.style.zIndex = 10000;
playbackTimestamp.style.textContent = '00:00';
playbackTimestamp.style.textAlign = 'center';
playbackTimestamp.style.display = 'flex';
playbackTimestamp.style.alignItems = 'center';
playbackTimestamp.style.justifyContent = 'center';
playbackTimestamp.style.color = 'white';
document.body.appendChild(playbackTimestamp);

let playbackInterval = null;
let playbackStartTime = null;

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((v) => v.toString().padStart(2, '0')).join(':');
}

function startPlaybackTimestamp(offset = 0) {
  if (window.audioCtx && window.audioCtx.currentTime !== undefined) {
    playbackStartTime = window.audioCtx.currentTime - offset;
  } else {
    playbackStartTime = performance.now() / 1000 - offset;
  }

  if (playbackInterval) clearInterval(playbackInterval);

  playbackInterval = setInterval(() => {
    let elapsed;
    if (window.audioCtx && window.audioCtx.currentTime !== undefined) {
      elapsed = window.audioCtx.currentTime - playbackStartTime;
    } else {
      elapsed = performance.now() / 1000 - playbackStartTime;
    }
    playbackTimestamp.textContent = formatTime(elapsed);
  }, 500);
}

function pausePlaybackTimestamp(time) {
  if (playbackInterval) clearInterval(playbackInterval);
  playbackTimestamp.textContent = formatTime(time);
}

function stopPlaybackTimestamp() {
  if (playbackInterval) clearInterval(playbackInterval);
  playbackInterval = null;
  playbackTimestamp.textContent = '00:00';
}

function showPlayOnHover() {
  playBtn.addEventListener('mouseenter', () => {
    if (isPlaying && !audioEnded) {
      pauseBtn.style.opacity = '1';
      playBtn.style.opacity = '0';
    } else if (!isPlaying && !audioEnded) {
      playBtn.style.opacity = '1';
      pauseBtn.style.opacity = '0';
    }
  });
  playBtn.addEventListener('mouseleave', () => {
    playBtn.style.opacity = '0';
    pauseBtn.style.opacity = '0';
  });

  pauseBtn.style.zIndex = '15';
  playBtn.style.zIndex = '16';
}

// Show pause button only on hover
function showPauseOnHover() {
  pauseBtn.addEventListener('mouseenter', () => {
    pauseBtn.style.opacity = '1';
  });
  pauseBtn.addEventListener('mouseleave', () => {
    pauseBtn.style.opacity = '0';
  });
  pauseBtn.style.zIndex = '16';
  playBtn.style.zIndex = '15';
}

// Create restart button
function createRestartBtn() {
  if (!restartBtn) {
    restartBtn = document.createElement('button');
    restartBtn.id = 'restartBtn';
    restartBtn.className = 'wallpoet-regular';
    restartBtn.textContent = '⟲ RESTART';
    restartBtn.style.position = 'fixed';
    restartBtn.style.top = '50%';
    restartBtn.style.left = '50%';
    restartBtn.style.transform = 'translate(-50%, -50%)';
    restartBtn.style.zIndex = '13';
    restartBtn.style.display = 'block';
    controls[0].appendChild(restartBtn);
    restartBtn.addEventListener('click', () => {
      showPlayButton();
      audioEnded = false;
      document.dispatchEvent(new CustomEvent('restart-clicked'));
    });
  } else {
    restartBtn.style.display = 'block';
  }
}

// Click Listener
// Play button click
playBtn.addEventListener('click', function (e) {
  e.preventDefault();
  // Ensure audio context is resumed for autoplay policy
  if (window.audioCtx && window.audioCtx.state === 'suspended') {
    window.audioCtx.resume();
  }
  startPlayback(pauseTime || 0); // <-- pass pauseTime
  isPlaying = true;
  isPaused = false;
  audioEnded = false;
  document.dispatchEvent(new CustomEvent('play-clicked'));
  showPauseOnHover();
  startPlaybackTimestamp(pauseTime || 0);
});

// Pause button click
pauseBtn.addEventListener('click', function (e) {
  e.preventDefault();

  if (!isPlaying) return;

  // Stop audio and save current position
  if (source) {
    try {
      source.stop();
    } catch (e) {}
    source.disconnect();
    source = null;
  }

  clearInterval(interval);

  // Save offset to resume from
  pauseTime = audioCtx.currentTime - startTime;

  isPlaying = false;
  isPaused = true;
  audioEnded = false;

  document.dispatchEvent(new CustomEvent('pause-clicked'));

  // fade out play button & hide
  document.getElementById('pauseBtn').style.opacity = '0';
  showPlayOnHover();
  pausePlayback(pauseTime);
  pausePlaybackTimestamp(pauseTime);
});

// Listen for audio end event from convert-sound.js
document.addEventListener('audio-ended', function () {
  isPlaying = false;
  isPaused = false;
  audioEnded = true;
  createRestartBtn();
  stopPlaybackTimestamp();
});

// Listen for restart event
document.addEventListener('restart-clicked', function () {
  if (restartBtn) restartBtn.style.display = 'none';
  isPlaying = false;
  isPaused = false;
  showPlayButton();
});

const guestBtn = document.getElementById('gc-connect');
guestBtn.addEventListener('click', () => {
  isGuest = true;
  hasSelectedMode = true;

  // Hide the room UI
  hideRoomCodePanel();

  // Enable playback controls
  playBtn.style.pointerEvents = 'auto';
  pauseBtn.style.pointerEvents = 'auto';

  // Immediately start playback in guest mode
  if (typeof startPlayback === 'function') {
    playBtn.textContent = 'PAUSE';
    startPlayback(0);
    startPlaybackTimestamp(0);
    isPlaying = true;
    isPaused = false;
    audioEnded = false;
    document.dispatchEvent(new CustomEvent('play-clicked'));
    showPauseOnHover();
  }
});

// Space bar and Fullscreen listener
document.addEventListener('keydown', (e) => {
  // Avoid triggering if typing in an input
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'))
    return;

  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    togglePlayback();
  }

  // Fullscreen on 'F' key
  if (e.key === 'f' || e.key === 'F') {
    const docElm = document.documentElement;
    if (!document.fullscreenElement) {
      if (docElm.requestFullscreen) {
        docElm.requestFullscreen();
      } else if (docElm.mozRequestFullScreen) {
        /* Firefox */
        docElm.mozRequestFullScreen();
      } else if (docElm.webkitRequestFullscreen) {
        /* Chrome, Safari & Opera */
        docElm.webkitRequestFullscreen();
      } else if (docElm.msRequestFullscreen) {
        /* IE/Edge */
        docElm.msRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    }
  }
});

function hideRoomCodePanel() {
  const roomCodePanel = document.getElementById('room-code-panel');
  if (roomCodePanel) {
    roomCodePanel.style.backdropFilter = 'blur(0px)';
    roomCodePanel.style.opacity = '0';
  }

  setTimeout(() => {
    if (roomCodePanel) roomCodePanel.remove();
  }, 700);
}

// --- BLINKING ---
// Text animation
const texts = [
  { text: 'MACHINE#4', fontSize: '6rem' },
  { text: 'DAVID', fontSize: '12rem' },
  { text: 'BORING', fontSize: '12rem' },
];
let textInterval;
let textCount = 0;
textInterval = setInterval(() => {
  textCount++;
  if (loadingDiv) {
    const entry = texts[textCount % texts.length];
    if (typeof entry === 'string') {
      loadingDiv.textContent = entry;
      loadingDiv.style.fontSize = '12rem';
    } else {
      loadingDiv.textContent = entry.text;
      loadingDiv.style.fontSize = entry.fontSize;
    }
  }
}, 100);

// Webcam
// === BLINK DETECTION WITH MEDIAPIPE ===
const videoElement = document.createElement('video');
videoElement.autoplay = true;
videoElement.style.display = 'none';
document.body.appendChild(videoElement);

let lastBlinkTime = 0;
const blinkThreshold = 0.25; // smaller = more sensitive

const faceMesh = new FaceMesh({
  locateFile: (file) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
});

faceMesh.setOptions({
  maxNumFaces: 1,
  refineLandmarks: true, // gives iris landmarks
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
});

faceMesh.onResults(onResults);

const camera = new Camera(videoElement, {
  onFrame: async () => await faceMesh.send({ image: videoElement }),
  width: 320,
  height: 240,
});
camera.start();

function onResults(results) {
  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0)
    return;

  const landmarks = results.multiFaceLandmarks[0];

  // Left eye: 159 = top, 145 = bottom
  const leftTop = landmarks[159];
  const leftBottom = landmarks[145];
  const leftDist = Math.hypot(
    leftTop.x - leftBottom.x,
    leftTop.y - leftBottom.y,
  );

  // Right eye: 386 = top, 374 = bottom
  const rightTop = landmarks[386];
  const rightBottom = landmarks[374];
  const rightDist = Math.hypot(
    rightTop.x - rightBottom.x,
    rightTop.y - rightBottom.y,
  );

  // approximate eye width
  const leftWidth = Math.hypot(
    landmarks[33].x - landmarks[133].x,
    landmarks[33].y - landmarks[133].y,
  );
  const rightWidth = Math.hypot(
    landmarks[263].x - landmarks[362].x,
    landmarks[263].y - landmarks[362].y,
  );

  const ratio = (leftDist / leftWidth + rightDist / rightWidth) / 2;

  if (ratio < blinkThreshold && Date.now() - lastBlinkTime > 500) {
    lastBlinkTime = Date.now();
    // console.log('Blink detected!');
    if (loadingDiv) {
      loadingDiv.style.background = 'rgba(0,0,0,0)';
      loadingDiv.style.color = 'white';
    }

    // Optional: fade back after 200ms
    setTimeout(() => {
      if (loadingDiv) {
        loadingDiv.style.background = 'rgba(0,0,0,1)';
        loadingDiv.style.color = 'black';
      }
    }, 200);
  }
}
