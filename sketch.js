// Map & Audio, Cesium

import { defaultServer } from './config.js';
import { isMobile } from './utils.js';
import LYRICS from './lyrics.js';

// Helper: detect whether the device is rotated to landscape
function isDeviceRotated() {
  if (typeof isMobile === 'boolean' && !isMobile) return true;
  try {
    if (
      screen &&
      screen.orientation &&
      typeof screen.orientation.type === 'string'
    ) {
      return screen.orientation.type.indexOf('landscape') !== -1;
    }
  } catch (e) {}
  if (typeof window.orientation !== 'undefined')
    return Math.abs(window.orientation) === 90;
  if (window.matchMedia)
    return window.matchMedia('(orientation: landscape)').matches;
  return false;
}

// Attempt to lock screen orientation to landscape. Must be called from a user gesture.
async function lockLandscape() {
  try {
    if (
      screen &&
      screen.orientation &&
      typeof screen.orientation.lock === 'function'
    ) {
      await screen.orientation.lock('landscape');
      console.log('Orientation locked to landscape');
      return true;
    }
  } catch (e) {
    console.warn('screen.orientation.lock failed', e);
  }

  // Some platforms (older iOS Safari) don't support lock; return false so caller can fallback.
  console.warn('Orientation lock not supported or failed');
  return false;
}

// --- Cesium Standalone Logic ---
let viewer, movingPoint;
let audioCtx, source, analyser, timeDomainData, frequencyData, audioBuffer;
let interval;
let height = 100;
let idx = 0;
let intervalFrame = 100; // ms
let shadowX = window.innerWidth / 2; // current X position for smooth random walk (start at center)
let shadowTargetX = window.innerWidth / 2; // target X position for random walk (start at center)
let shadowY = window.innerHeight / 2; // current Y position for smooth random walk (start at center)
let shadowTargetY = window.innerHeight / 2; // target Y position for random walk (start at center)
let shadowMovementEnabled = false; // toggle to enable/disable shadow movement
let lyricsRanges = null; // computed [{start,end,text}]
let lastLyricsIndex = -1;

// shared gyro state updated by Socket.IO messages (or device fallback)
const gyro = { alpha: null, beta: null, gamma: null };
let cameraHeading = 0; // store current camera rotation in radians - correlated with gyro's rotation

// Local gyro flag (when using the same device as controller)
window.localGyroEnabled = false;

async function enableLocalGyro() {
  if (window.localGyroEnabled) return;
  // iOS requires explicit permission
  try {
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      const perm = await DeviceOrientationEvent.requestPermission();
      if (perm !== 'granted') {
        console.warn('DeviceOrientation permission not granted');
        return;
      }
    }
  } catch (e) {
    console.warn('DeviceOrientation permission request failed', e);
  }

  function handleLocalOrientation(e) {
    // update shared gyro object so existing code can use it
    gyro.alpha = e.alpha;
    gyro.beta = e.beta;
    gyro.gamma = e.gamma;
  }

  window.addEventListener('deviceorientation', handleLocalOrientation, true);
  window.localGyroEnabled = true;
  console.log('Local gyro enabled');
}

let socket = null;

// Loading States
let audioReady = false;
let mapReady = false;
let roomReady = false;

// Modes
let hasSelectedMode = true;
let isAutopilot = false;
let isSolo = false;
let isRemote = false;

// UI Elements
// GYRO INFO UI
const gyroInfoUI = document.createElement('div');
gyroInfoUI.id = 'gyro-info-ui';
gyroInfoUI.style.position = 'fixed';
gyroInfoUI.style.left = '10px';
gyroInfoUI.style.top = '10px';
gyroInfoUI.style.zIndex = 10;
gyroInfoUI.style.color = 'white';
gyroInfoUI.innerText = '00.00';
document.body.appendChild(gyroInfoUI);

const deltaInfoUI = document.createElement('div');
deltaInfoUI.id = 'delta-info-ui';
deltaInfoUI.style.position = 'fixed';
deltaInfoUI.style.right = '10px';
deltaInfoUI.style.top = '10px';
deltaInfoUI.style.zIndex = 10;
deltaInfoUI.style.color = 'white';
deltaInfoUI.innerText = '00.00';
document.body.appendChild(deltaInfoUI);

const idUI = document.createElement('div');
idUI.id = 'id-ui';
idUI.style.position = 'fixed';
idUI.style.bottom = '10px';
idUI.style.right = '10px';
idUI.style.zIndex = 10;
idUI.style.color = 'white';
idUI.innerText = '000@EKEZIA00';
document.body.appendChild(idUI);

// Create a small overlay UI
const ui = document.createElement('div');
ui.id = 'room-code-panel';
ui.style.position = 'fixed';
ui.style.width = '100dvw';
ui.style.height = '100dvh';
ui.style.display = 'flex';
ui.style.flexDirection = 'column';
ui.style.justifyContent = 'center';
ui.style.alignItems = 'center';
ui.style.zIndex = 99;
ui.style.top = 0;
ui.style.color = 'white';
ui.style.pointerEvents = 'auto'; // panel itself is interactive
ui.style.opacity = 0;
ui.style.backdropFilter = 'blur(16px)';
ui.style.filter = 'blur(0.5px)';
ui.style.textAlign = 'center';
ui.style.transition =
  'backdrop-filter 0.7s cubic-bezier(.4,0,.2,1), background 0.7s cubic-bezier(.4,0,.2,1), opacity 0.7s cubic-bezier(.4,0,.2,1)';
ui.innerHTML = !isMobile
  ? `
    <p style="width:400px;font-size:1.2rem;">Enter the room code on your mobile device to use it as remote control</p>

    <div id="room-input-container" style="display:flex;gap:6px;margin-bottom:6px"></div>
    <input id="gc-room" type="hidden" />
    <p style="font-size:1.2rem;">Don't have a mobile device?</p>
    <button id="gc-connect" style="box-shadow: 0 0 50px 0 rgba(255, 255, 255, 0.5);transform: translateY(-16px);">AUTOPILOT</button>
  `
  : `
    <p style="font-size:1.2rem;">MACHINE #4 will autonomously drive for you.</p>
    <button id="gc-connect" style="box-shadow: 0 0 50px 0 rgba(255, 255, 255, 0.5);transform: translateY(-16px);">AUTOPILOT</button>
    <p style="font-size:1.2rem;">Do you have a Desktop? Use your device to control MACHINE #4 on Desktop.</p>
    <button id="remote-btn" style="box-shadow: 0 0 50px 0 rgba(255, 255, 255, 0.5);transform: translateY(-16px);">REMOTE</button>
    `;

//     <p style="font-size:1.2rem;">Use your device to control MACHINE #4 on your mobile device.</p>
// <button id="solo-remote-btn" style="box-shadow: 0 0 50px 0 rgba(255, 255, 255, 0.5);transform: translateY(-16px);">SOLO</button>

// <div id='gc-status' style='margin-top:6px;font-size:12px;opacity:0.9'>
//   Disconnected
// </div>;

document.body.appendChild(ui);

const rn = document.createElement('div');

function hideUiPanel() {
  if (ui) {
    ui.style.backdropFilter = 'blur(0px)';
    ui.style.opacity = '0';
    ui.style.pointerEvents = 'none';
  }

  // Keep `ui` in the DOM and rely on opacity/pointerEvents only.
}

// create visible digit spans
const roomInputContainerEl = document.getElementById('room-input-container');
if (roomInputContainerEl && roomInputContainerEl.children.length === 0) {
  for (let i = 0; i < 4; i++) {
    const s = document.createElement('span');
    s.style.width = '40px';
    s.style.height = '60px';
    s.style.background = 'rgba(0,0,0,0.3)';
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
loadingDiv.style.position = 'fixed';
loadingDiv.style.top = '0';
loadingDiv.style.left = '0';
loadingDiv.style.width = '100dvw';
loadingDiv.style.height = '100dvh';
loadingDiv.style.background = 'rgba(0,0,0,0.4)';
loadingDiv.style.color = 'white';
loadingDiv.style.display = 'flex';
loadingDiv.style.alignItems = 'center';
loadingDiv.style.justifyContent = 'center';
loadingDiv.style.fontSize = '6rem';
loadingDiv.style.zIndex = 10001;
loadingDiv.style.backdropFilter = 'blur(16px)';
loadingDiv.style.opacity = 1;
loadingDiv.style.pointerEvents = 'none';
loadingDiv.style.transition =
  'backdrop-filter 0.7s cubic-bezier(.4,0,.2,1), background 0.7s cubic-bezier(.4,0,.2,1), opacity 0.7s cubic-bezier(.4,0,.2,1)';

// container for rotating texts (so other overlays can be independent)
const loadingTexts = document.createElement('div');
loadingTexts.id = 'loading-texts';
loadingTexts.style.pointerEvents = 'none';
loadingTexts.style.textAlign = 'center';
loadingTexts.style.fontSize = '6rem';
loadingTexts.textContent = 'MACHINE #4';
loadingTexts.style.filter = 'blur(4px)';
loadingTexts.style.color = 'white';
loadingTexts.style.opacity = '1';
loadingDiv.appendChild(loadingTexts);
// Blinking text — start immediately so desktop shows it
loadingTexts.style.color = 'white';
loadingTexts.style.opacity = '1';
loadingTexts.style.zIndex = '10002';
const blinkTexts = [
  { text: 'MACHINE #4', fontSize: '12rem' },
  { text: 'DAVID BORING', fontSize: '12rem' },
];
let textCount = 0;
const textInterval = setInterval(() => {
  textCount++;
  const entry = blinkTexts[textCount % blinkTexts.length];
  console.debug('loading-text blink', textCount, entry);
  const td = document.getElementById('loading-texts');
  if (td) td.textContent = entry.text;
  if (td) td.style.fontSize = entry.fontSize;
}, 500);

// on mobile, show a small hint at the bottom of the loading overlay
document.body.appendChild(loadingDiv);

// If mobile and not rotated, show the rotate notice immediately so it's
// visible alongside the loading texts from the start.
if (isMobile) {
  rn.id = 'rotate-notice';
  rn.style.position = 'fixed';
  rn.style.left = '50%';
  rn.style.bottom = '20%';
  rn.style.transform = 'translateX(-50%)';
  rn.style.padding = '12px 18px';
  rn.style.background = 'rgba(0,0,0,0.6)';
  rn.style.color = 'white';
  rn.style.borderRadius = '8px';
  rn.style.zIndex = 10001;
  rn.style.fontSize = '2.5rem';
  rn.style.textAlign = 'center';
  rn.textContent = 'Please rotate your device to landscape to continue.';
  rn.style.opacity = '0.2';
  rn.style.transition = 'opacity 0.3s ease';
  loadingDiv.appendChild(rn);
}

// shared rotation handler to toggle visibility of rotate notices
function handleRotationChange() {
  const rotated = isDeviceRotated();
  const rnEl = document.getElementById('rotate-notice');

  if (!rotated) {
    // Portrait: always show loading overlay (opacity) and hide main UI
    if (loadingDiv) loadingDiv.style.opacity = '1';
    if (ui) {
      ui.style.opacity = '0';
      ui.style.pointerEvents = 'none';
    }
    if (rnEl) rnEl.style.opacity = audioReady && mapReady ? '1' : '0';
    return;
  }

  // Landscape: hide loading overlay (fade) and adjust UI
  if (loadingDiv) loadingDiv.style.opacity = '0';
  if (rnEl) rnEl.style.opacity = '0';
  if (ui) {
    ui.style.opacity = audioReady && mapReady && !isAutopilot ? '1' : '0';
    ui.style.pointerEvents = audioReady && mapReady ? 'auto' : 'none';
  }

  if (audioReady && mapReady) tryStartExperience();
}

if (isMobile) {
  window.addEventListener('orientationchange', handleRotationChange);
  window.addEventListener('resize', handleRotationChange);
}

// Mobile-only fullscreen toggle (top-center, 10px from top)
if (isMobile) {
  (function createMobileFullscreenToggle() {
    function isFullscreen() {
      return !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
      );
    }

    const fsBtn = document.createElement('button');
    fsBtn.id = 'mobile-fullscreen-toggle';
    fsBtn.title = 'Toggle fullscreen';
    fsBtn.textContent = isFullscreen() ? '(-)' : '+';
    fsBtn.style.position = 'fixed';
    fsBtn.style.left = '50%';
    fsBtn.style.transform = 'translateX(-50%)';
    fsBtn.style.top = '10px';
    fsBtn.style.zIndex = '999';
    fsBtn.style.width = '46px';
    fsBtn.style.height = '46px';
    fsBtn.style.borderRadius = '24px';
    fsBtn.style.background = 'rgba(0,0,0,0.6)';
    fsBtn.style.color = 'white';
    fsBtn.style.border = 'none';
    fsBtn.style.fontSize = '24px';
    fsBtn.style.display = 'flex';
    fsBtn.style.alignItems = 'center';
    fsBtn.style.justifyContent = 'center';
    fsBtn.style.cursor = 'pointer';
    fsBtn.style.pointerEvents = 'auto';
    fsBtn.style.display = 'none';

    async function enterFullscreen() {
      const el = document.documentElement;
      try {
        if (el.requestFullscreen) await el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        else if (el.mozRequestFullScreen) el.mozRequestFullScreen();
        else if (el.msRequestFullscreen) el.msRequestFullscreen();
      } catch (e) {
        console.warn('requestFullscreen failed', e);
      }
    }

    async function exitFullscreen() {
      try {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
        else if (document.msExitFullscreen) document.msExitFullscreen();
      } catch (e) {
        console.warn('exitFullscreen failed', e);
      }
    }

    fsBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!isFullscreen()) await enterFullscreen();
      else await exitFullscreen();
      // label will be updated by fullscreenchange handlers
    });

    function updateLabel() {
      fsBtn.textContent = isFullscreen() ? '(-)' : '+';
    }

    document.addEventListener('fullscreenchange', updateLabel);
    document.addEventListener('webkitfullscreenchange', updateLabel);
    document.addEventListener('mozfullscreenchange', updateLabel);
    document.addEventListener('MSFullscreenChange', updateLabel);

    document.body.appendChild(fsBtn);
  })();
}
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

  // Remove any hover overlay if present (should not exist)
  const hoverOverlay = document.getElementById('cesium-hover-overlay');
  if (hoverOverlay) hoverOverlay.remove();

  // --- Show feathered oval mask on map from the beginning ---
  function updateMapMask() {
    const cesiumContainer = document.getElementById('cesiumContainer');
    if (!cesiumContainer) return;
    const canvas = cesiumContainer.querySelector('canvas');
    if (!canvas) return;
    const svgMask = "url('/mask.svg')";
    cesiumContainer.style.webkitMaskImage = svgMask;
    cesiumContainer.style.maskImage = svgMask;
    cesiumContainer.style.webkitMaskRepeat = 'no-repeat';
    cesiumContainer.style.maskRepeat = 'no-repeat';
    cesiumContainer.style.webkitMaskSize = '80% 50%';
    cesiumContainer.style.maskSize = '80% 50%';
    cesiumContainer.style.objectFit = 'cover'; // Ensure mask covers and centers
    cesiumContainer.style.webkitMaskPosition = 'center';
    cesiumContainer.style.maskPosition = 'center';
  }
  // Show mask on load
  updateMapMask();
  // Update mask on resize
  window.addEventListener('resize', updateMapMask);
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
  // Preload a much larger area with higher density
  async function preloadLocalArea(lat, lon, radiusDeg = 0.05, gridSteps = 7) {
    // gridSteps: number of points per axis (odd number, e.g. 7 for -3*step to +3*step)
    const stepSize = (2 * radiusDeg) / (gridSteps - 1);
    const offsets = [];
    for (let i = 0; i < gridSteps; i++) {
      offsets.push(-radiusDeg + i * stepSize);
    }
    for (const dx of offsets) {
      for (const dy of offsets) {
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(
            lon + dx,
            lat + dy,
            height,
          ),
        });
        viewer.scene.requestRender();
        await new Promise((r) => setTimeout(r, 100)); // shorter delay for more points
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

    console.log('✅ Preloaded large area tiles');
  }

  preloadLocalArea(currentLat, currentLon, 0.05, 7).then(() => {
    console.log('Local area ready — starting playback');
    mapReady = true;
    checkAllReady();

    setTimeout(() => {
      tryStartExperience();
    }, 1000);
  });

  viewer.scene.globe.maximumScreenSpaceError = 4.0; // coarser detail = faster

  loadAudio('/public/audio.wav').then(() => {
    setTimeout(() => {
      tryStartExperience();
    }, 1000);
  });
});

function checkAllReady() {
  if (!(audioReady && mapReady)) return;

  if (isMobile) if (rn) rn.style.opacity = '1';

  ui.style.opacity = 1;
  // use shared isDeviceRotated() helper above

  // show a small rotate prompt on mobile when not rotated
  if (isMobile && !isDeviceRotated()) {
    // ensure loading overlay stays visible and main UI stays hidden in portrait
    if (loadingDiv) loadingDiv.style.opacity = '1';
    // ensure rotation handler updates UI immediately
    if (typeof handleRotationChange === 'function') handleRotationChange();
    return;
  }

  // Desktop or mobile rotated to landscape: show UI (opacity-only)
  if (!isAutopilot && ui) {
    ui.style.pointerEvents = 'auto';
    ui.style.opacity = '1';
  }
}

function tryStartExperience() {
  if (audioReady && mapReady) {
    setInfoUIVisibility(true); // Show info UIs when music starts

    // Only remove the loading overlay when not on mobile portrait
    if (isDeviceRotated()) {
      if (loadingDiv) {
        loadingDiv.style.opacity = '0';
      }
    } else {
      // keep loading overlay visible in portrait
      if (loadingDiv) {
        loadingDiv.style.opacity = '1';
      }
    }
  }
}

// ==== inside your existing code, add these ====

async function loadAudio(url) {
  audioCtx = new AudioContext();
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  console.log('🎤 Audio loaded');
  audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  audioReady = true;
  checkAllReady();
}

let startTime = 0; // when the playback started
let pauseTime = 0; // how many seconds have already played
const playBtn = document.getElementById('playBtn');
playBtn.style.pointerEvents = 'none';
playBtn.style.zIndex = '20001';
playBtn.style.opacity = '0';
playBtn.onmouseenter = () => {
  if (!isPlaying) playBtn.style.opacity = '1';
};
playBtn.onmouseleave = () => {
  if (!isPlaying) playBtn.style.opacity = '0';
};
const playbackTimestamp = document.getElementById('playback-timestamp');
const pauseBtn = document.getElementById('pauseBtn');
pauseBtn.style.pointerEvents = 'none';
pauseBtn.style.zIndex = '20001';
pauseBtn.style.opacity = '0';
pauseBtn.onmouseenter = () => {
  if (isPlaying) pauseBtn.style.opacity = '1';
};
pauseBtn.onmouseleave = () => {
  if (isPlaying) pauseBtn.style.opacity = '0';
};
const controls = document.getElementsByClassName('control-hover-area');
let isPlaying = false;
let isPaused = false;
let audioEnded = false;
let restartBtn;
const SHOW_SCRUBBER = false; // Set to true to show scrubber
let scrubber;
// Debug-only scrubber
if (SHOW_SCRUBBER) {
  scrubber = document.createElement('input');
  scrubber.type = 'range';
  scrubber.min = 0;
  scrubber.max = 100;
  scrubber.value = 0;
  scrubber.step = 0.01;
  scrubber.style.position = 'fixed';
  scrubber.style.left = '50%';
  scrubber.style.bottom = '80px';
  scrubber.style.transform = 'translateX(-50%)';
  scrubber.style.width = '60vw';
  scrubber.style.zIndex = 10001;
  document.body.appendChild(scrubber);
  scrubber.addEventListener('input', (e) => {
    if (audioBuffer && audioCtx) {
      const percent = parseFloat(scrubber.value) / 100;
      const seekTime = percent * audioBuffer.duration;
      // Only jump to credit if seekTime >= audioBuffer.duration
      if (seekTime >= audioBuffer.duration) {
        stopPlayback();
        startPlayback(audioBuffer.duration);
        startPlaybackTimestamp(audioBuffer.duration);
      } else {
        stopPlayback();
        startPlayback(seekTime);
        startPlaybackTimestamp(seekTime);
        audioEnded = false;
      }
    }
  });
}

function startPlayback(fromOffset = 0) {
  if (audioCtx.state === 'suspended') audioCtx.resume();

  source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  timeDomainData = new Float32Array(analyser.fftSize);
  frequencyData = new Float32Array(analyser.frequencyBinCount);

  source.connect(analyser);
  analyser.connect(audioCtx.destination);

  startTime = audioCtx.currentTime - fromOffset; // start time accounting for offset
  source.start(0, fromOffset); // start at offset seconds
  isPlaying = true;

  // fixed direction (north)
  let directionAngle = 0; // 0 radians = north

  // Build lyrics ranges once (compute end from next start, fallback to duration)
  if (!lyricsRanges) {
    const sorted = [...LYRICS].sort((a, b) => a.start - b.start);
    const duration = audioBuffer ? audioBuffer.duration : 1e9;
    lyricsRanges = sorted.map((entry, i) => {
      const next = sorted[i + 1];
      const end = next ? next.start - 0.05 : duration;
      return { start: entry.start, end, text: entry.text };
    });
  }

  // Ensure lyrics container exists and is styled once (outer container, full screen)
  let lyricsContainer = document.getElementById('lyrics-container');
  if (!lyricsContainer) {
    lyricsContainer = document.createElement('div');
    lyricsContainer.id = 'lyrics-container';
    lyricsContainer.style.zIndex = '1'; // behind map
    lyricsContainer.style.position = 'fixed';
    lyricsContainer.style.left = '0';
    lyricsContainer.style.top = '0';
    lyricsContainer.style.width = '100dvw';
    lyricsContainer.style.height = '100dvh';
    lyricsContainer.style.pointerEvents = 'none';
    lyricsContainer.style.overflow = 'hidden';
    lyricsContainer.style.display = 'flex';
    lyricsContainer.style.justifyContent = 'center';
    lyricsContainer.style.alignItems = 'center';
    lyricsContainer.style.flexDirection = 'column';
    lyricsContainer.classList.add('pinyon-script-regular');

    document.body.appendChild(lyricsContainer);
  }

  // Create lyrics shadow overlay (same technique as map shadow)
  // Remove lyrics shadow overlay logic. Instead, mask the map container.
  const cesiumContainer = document.getElementById('cesiumContainer');
  if (cesiumContainer) {
    cesiumContainer.style.position = 'fixed';
    cesiumContainer.style.top = '0';
    cesiumContainer.style.left = '0';
    cesiumContainer.style.width = '100dvw';
    cesiumContainer.style.height = '100dvh';
    cesiumContainer.style.zIndex = '10'; // above lyrics
    cesiumContainer.style.pointerEvents = '';
  }

  interval = setInterval(() => {
    // count speed based on audio amplitude
    // --- Guest Mode: move map along audio ---
    analyser.getFloatTimeDomainData(timeDomainData);
    analyser.getFloatFrequencyData(frequencyData);

    // Compute average amplitude to control speed
    let sum = 0;
    for (let i = 0; i < timeDomainData.length; i++) {
      sum += Math.abs(timeDomainData[i]);
    }
    const amplitude = sum / timeDomainData.length;

    // animate the mask position using smooth random walk for both X and Y
    if (shadowMovementEnabled) {
      if (Math.abs(shadowX - shadowTargetX) < 1 || Math.random() < 0.02) {
        shadowTargetX = Math.random() * window.innerWidth;
      }
      shadowX += (shadowTargetX - shadowX) * 0.08;
      if (Math.abs(shadowY - shadowTargetY) < 1 || Math.random() < 0.02) {
        shadowTargetY = Math.random() * window.innerHeight;
      }
      shadowY += (shadowTargetY - shadowY) * 0.08;
    }
    // Move the mask image within the canvas
    if (cesiumContainer) {
      const canvas = cesiumContainer.querySelector('canvas');
      if (canvas) {
        // Animate mask position using percentage values for CSS mask
        const percentX = Math.round((shadowX / window.innerWidth) * 100);
        const percentY = Math.round((shadowY / window.innerHeight) * 100);
        const maskPos = `${percentX}% ${percentY}%`;
        cesiumContainer.style.webkitMaskPosition = maskPos;
        cesiumContainer.style.maskPosition = maskPos;
      }
    }

    let speed = amplitude * 0.001; // tweak as needed

    // Access as AUTOPILOT
    if (isAutopilot) {
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
      currentLat += speed * 2;
    }

    // Access as SOLO — speed scales with local gyro (device tilt)
    if (isSolo) {
      // ensure local gyro is enabled when possible
      if (isMobile && !window.localGyroEnabled) enableLocalGyro();

      // map beta tilt (front/back) to speed multiplier
      const gyroVal = Math.abs(gyro.beta || 0);
      let gyroMultiplier = 1 + gyroVal / 90; // ranges ~1..3
      gyroMultiplier = Math.min(Math.max(0.5, gyroMultiplier), 3);

      currentLat += speed * 2 * gyroMultiplier; // move northward scaled by tilt
      currentLon +=
        Math.sin(audioCtx.currentTime) * speed * 0.5 * gyroMultiplier; // small sideways movement scaled
      locDiv.innerText = `${currentLat.toFixed(6)}, ${currentLon.toFixed(6)}`;
      deltaInfoUI.innerText = amplitude;
      idUI.innerText = '0S0L000000';

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
      currentLat += speed * 2;
    }

    if (!isAutopilot) showPlayOnHover();

    // Show lyrics (active line only)
    if (lyricsContainer && lyricsRanges) {
      const elapsed = audioCtx.currentTime - startTime;
      // Find active index (linear scan is fine for small list)
      let activeIndex = -1;
      for (let i = 0; i < lyricsRanges.length; i++) {
        const r = lyricsRanges[i];
        if (elapsed >= r.start && elapsed < r.end) {
          activeIndex = i;
          break;
        }
      }
      if (activeIndex !== lastLyricsIndex) {
        lastLyricsIndex = activeIndex;
        // Always clear container when index changes (including when no lyric is active)
        lyricsContainer.innerHTML = '';
        if (activeIndex >= 0) {
          const text = lyricsRanges[activeIndex].text;
          const lyricSpan = document.createElement('span');
          lyricSpan.textContent = text;
          lyricSpan.style.color = 'white';
          lyricSpan.style.fontSize = isMobile ? '3rem' : '5rem';
          lyricSpan.style.fontWeight = 'bold';
          lyricSpan.style.whiteSpace = 'nowrap';
          lyricSpan.style.filter = isMobile ? 'blur(1px)' : 'blur(2px)';
          lyricSpan.style.textAlign = 'center';
          lyricSpan.style.opacity = '0.9';
          lyricSpan.style.position = 'absolute';
          // Constrain position so text is always fully visible
          const margin = 60;
          lyricsContainer.appendChild(lyricSpan); // temporarily add to measure size
          const spanRect = lyricSpan.getBoundingClientRect();
          lyricsContainer.removeChild(lyricSpan);
          const maxX = window.innerWidth - margin - spanRect.width;
          const maxY = window.innerHeight - margin - spanRect.height;
          const minX = margin;
          const minY = margin;
          const randX = Math.floor(Math.random() * (maxX - minX + 1)) + minX;
          const randY = Math.floor(Math.random() * (maxY - minY + 1)) + minY;
          lyricSpan.style.left = randX + 'px';
          lyricSpan.style.top = randY + 'px';
          lyricsContainer.style.position = 'fixed'; // ensure container is positioned
          lyricsContainer.style.justifyContent = '';
          lyricsContainer.style.alignItems = '';
          lyricsContainer.style.flexDirection = '';
          lyricsContainer.appendChild(lyricSpan);
        }
      }
    }
  }, intervalFrame);

  source.onended = () => {
    stopPlayback();
    isPlaying = false;
    audioEnded = true;
    if (isPaused) return;
    pauseTime = 0; // reset
    // Hide play/pause buttons
    if (playBtn) {
      playBtn.style.opacity = '0';
      playBtn.style.pointerEvents = 'none';
    }
    if (pauseBtn) {
      pauseBtn.style.opacity = '0';
      pauseBtn.style.pointerEvents = 'none';
    }
    // Stop the timer and hide it
    stopPlaybackTimestamp();
    if (playbackTimestamp) playbackTimestamp.style.display = 'none';

    // Hide the map when song finishes
    const cesiumContainer = document.getElementById('cesiumContainer');
    if (cesiumContainer) cesiumContainer.style.display = 'none';

    // Show credit overlay with fade-in and animated blur
    showCreditOverlay(true);

    // Show restart button styled like AUTOPILOT, replace timer
    if (!restartBtn) {
      restartBtn = document.createElement('button');
      restartBtn.id = 'restartBtn';
      restartBtn.textContent = 'RESTART';
      restartBtn.style.position = 'fixed';
      restartBtn.style.left = '50%';
      restartBtn.style.bottom = '30px';
      restartBtn.style.transform = 'translateX(-50%)';
      restartBtn.style.zIndex = 10001;
      restartBtn.style.boxShadow = '0 0 50px 0 rgba(255, 255, 255, 0.5)';
      restartBtn.onclick = () => {
        // Remove credit overlay
        const credit = document.getElementById('credit-overlay');
        if (credit && credit.parentNode) {
          if (credit._cleanup) credit._cleanup();
          credit.parentNode.removeChild(credit);
        }
        // Hide restart button
        restartBtn.style.display = 'none';
        // Show play/pause and timer again
        // if (playBtn) {
        //   playBtn.style.opacity = '1';
        //   playBtn.style.pointerEvents = 'auto';
        // }
        // if (pauseBtn) {
        //   pauseBtn.style.opacity = '1';
        //   pauseBtn.style.pointerEvents = 'auto';
        // }
        if (playbackTimestamp) playbackTimestamp.style.display = 'flex';
        // Show the map again
        const cesiumContainer = document.getElementById('cesiumContainer');
        if (cesiumContainer) cesiumContainer.style.display = '';
        // Restart audio
        audioEnded = false;
        startPlayback(0);
        startPlaybackTimestamp(0);
      };
      document.body.appendChild(restartBtn);
    } else {
      restartBtn.style.display = 'block';
    }
  };
}

function pausePlayback() {
  if (!isPlaying) return;
  source.stop();
  clearInterval(interval);
  pauseTime = audioCtx.currentTime - startTime; // save current position
  isPlaying = false;
  if (playBtn) {
    playBtn.textContent = '▶︎ PLAY';
    playBtn.style.opacity = '1';
    playBtn.style.pointerEvents = 'auto';
    playBtn.style.zIndex = '11000';
    // Defensive: always ensure visible after pause
    setTimeout(() => {
      playBtn.style.opacity = '1';
    }, 10);
  }
  if (pauseBtn) {
    pauseBtn.style.opacity = '0';
    pauseBtn.style.pointerEvents = 'none';
    pauseBtn.style.zIndex = '10000';
  }
  // Show play button after pausing
  playBtn.style.opacity = '1';
  playBtn.style.pointerEvents = 'auto';
  pauseBtn.style.opacity = '0';
  pauseBtn.style.pointerEvents = 'none';
}

function togglePlayback() {
  if (!playBtn || !pauseBtn) return;

  const canPlay = playBtn.style.pointerEvents !== 'none';
  const canPause = pauseBtn.style.pointerEvents !== 'none';

  if (isPlaying) {
    console.log('here');
    if (!canPause) return;
    pauseBtn.click();
  } else {
    console.log('no here');
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
  // Defensive: always ensure playBtn is visible after stop
  if (playBtn) {
    playBtn.textContent = '▶︎ PLAY';
    playBtn.style.opacity = '1';
    playBtn.style.pointerEvents = 'auto';
    playBtn.style.zIndex = '11000';
    pauseBtn.style.opacity = '0';
    pauseBtn.style.pointerEvents = 'none';
  }
  console.log('Playback stopped');
}

// ---- USER LOCATION
let currentLon = -74.006; // Initial longitude (New York City)
let currentLat = 40.7128; // Initial latitude
let startLon = null;
let startLat = null;
// --- USER LOCATION (LATITUDE & LONGITUDE) ---
const locDiv = document.createElement('div');
locDiv.id = 'location-display';
locDiv.style.position = 'fixed';
locDiv.style.bottom = '10px';
locDiv.style.left = '10px';
locDiv.style.color = 'white';
locDiv.style.zIndex = '10000';
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
        // Save original starting point
        startLat = lat;
        startLon = lon;
        console.log(`User location: Latitude ${lat}, Longitude ${lon}`);
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

// Update location display to follow map camera position
function updateLocationDisplayFromCamera() {
  if (viewer && viewer.camera) {
    const carto = Cesium.Cartographic.fromCartesian(viewer.camera.position);
    if (carto) {
      const lat = Cesium.Math.toDegrees(carto.latitude);
      const lon = Cesium.Math.toDegrees(carto.longitude);
      locDiv.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    }
  }
}

// Start interval to update location display
setInterval(updateLocationDisplayFromCamera, 500);

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
          roomReady = true;
          checkAllReady();
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
    roomReady = true; // Still allow UI to show even if room assignment fails
    checkAllReady();
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
      hideUiPanel();
      status = 'OK';
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
// if (isMobile) {
async function goToRemote() {
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
}
// }

// UI elements
// Playback timestamp element
playbackTimestamp.id = 'playback-timestamp';
playbackTimestamp.style.position = 'fixed';
playbackTimestamp.style.bottom = '10px';
playbackTimestamp.style.left = '50%';
playbackTimestamp.style.transform = 'translateX(-50%)';
playbackTimestamp.style.color = 'white';
playbackTimestamp.style.fontSize = '1.2rem';
playbackTimestamp.style.zIndex = 10000;
playbackTimestamp.style.textContent = '00:00';
playbackTimestamp.style.textAlign = 'center';
playbackTimestamp.style.display = 'flex';
playbackTimestamp.style.alignItems = 'center';
playbackTimestamp.style.justifyContent = 'center';
playbackTimestamp.style.color = 'white';
playbackTimestamp.style.opacity = 0.3;
document.body.appendChild(playbackTimestamp);

let playbackInterval = null;
let playbackStartTime = null;

// Update scrubber position to follow audio progress
function updateScrubberProgress(currentTime) {
  if (scrubber && audioBuffer) {
    const percent = (currentTime / audioBuffer.duration) * 100;
    scrubber.value = percent;
  }
}

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
    updateScrubberProgress(elapsed);
    // Show credit overlay if at end
    if (audioBuffer && elapsed >= audioBuffer.duration && !audioEnded) {
      audioEnded = true;
      if (typeof source !== 'undefined') stopPlayback();
      // Show credit overlay and restart button (single implementation)
      showCreditOverlay();
      // Show restart button styled like AUTOPILOT, replace timer
      if (!restartBtn) {
        restartBtn = document.createElement('button');
        restartBtn.id = 'restartBtn';
        restartBtn.textContent = 'RESTART';
        restartBtn.style.position = 'fixed';
        restartBtn.style.left = '50%';
        restartBtn.style.bottom = '30px';
        restartBtn.style.transform = 'translateX(-50%)';
        restartBtn.style.zIndex = 10001;
        restartBtn.style.boxShadow =
          '0 4px 24px 0 rgba(255,255,255,0.25), 0 2px 8px rgba(0,0,0,0.2)';
        restartBtn.style.cursor = 'pointer';
        restartBtn.style.transition = 'background 0.2s, color 0.2s';
        restartBtn.onclick = () => {
          // Remove credit overlay
          const credit = document.getElementById('credit-overlay');
          if (credit && credit.parentNode) {
            if (credit._cleanup) credit._cleanup();
            credit.parentNode.removeChild(credit);
          }
          // Hide restart button
          restartBtn.style.display = 'none';
          // Restore background to original state
          document.body.style.background = '';
          // Show play/pause and timer again
          if (playBtn) {
            playBtn.style.opacity = '1';
            playBtn.style.pointerEvents = 'auto';
          }
          if (pauseBtn) {
            pauseBtn.style.opacity = '1';
            pauseBtn.style.pointerEvents = 'auto';
          }
          if (playbackTimestamp) playbackTimestamp.style.display = 'flex';
          // Show the map again
          const cesiumContainer = document.getElementById('cesiumContainer');
          if (cesiumContainer) cesiumContainer.style.display = '';
          // Restart audio
          audioEnded = false;
          startPlayback(0);
          startPlaybackTimestamp(0);
        };
        document.body.appendChild(restartBtn);
      } else {
        restartBtn.style.display = 'block';
      }
      // Hide play/pause and timer
      if (playBtn) {
        playBtn.style.opacity = '0';
        playBtn.style.pointerEvents = 'none';
      }
      if (pauseBtn) {
        pauseBtn.style.opacity = '0';
        pauseBtn.style.pointerEvents = 'none';
      }
      if (playbackTimestamp) playbackTimestamp.style.display = 'none';
    }
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

function setInfoUIVisibility(visible) {
  const opacity = visible ? '0.7' : '0';
  gyroInfoUI.style.transition = 'opacity 0.7s cubic-bezier(.4,0,.2,1)';
  gyroInfoUI.style.fontSize = '1.2rem';
  deltaInfoUI.style.transition = 'opacity 0.7s cubic-bezier(.4,0,.2,1)';
  deltaInfoUI.style.fontSize = '1.2rem';
  idUI.style.transition = 'opacity 0.7s cubic-bezier(.4,0,.2,1)';
  idUI.style.fontSize = '1.2rem';
  locDiv.style.transition = 'opacity 0.7s cubic-bezier(.4,0,.2,1)';
  locDiv.style.fontSize = '1.2rem';
  playbackTimestamp.style.transition = 'opacity 0.7s cubic-bezier(.4,0,.2,1)';
  gyroInfoUI.style.opacity = opacity;
  deltaInfoUI.style.opacity = opacity;
  idUI.style.opacity = opacity;
  locDiv.style.opacity = opacity;
  playbackTimestamp.style.opacity = opacity;
}
setInfoUIVisibility(false);

// Helper function to show credit overlay
function showCreditOverlay(enableBlurAnimation = false) {
  let credit = document.getElementById('credit-overlay');
  if (!credit) {
    credit = document.createElement('div');
    credit.id = 'credit-overlay';
    credit.style.position = 'fixed';
    credit.style.top = '0';
    credit.style.left = '0';
    credit.style.width = '100dvw';
    credit.style.height = '100dvh';
    credit.style.background = 'rgba(0,0,0,0.8)';
    credit.style.color = 'white';
    credit.style.display = 'flex';
    credit.style.flexDirection = 'column';
    credit.style.alignItems = 'center';
    credit.style.justifyContent = 'center';
    credit.style.fontSize = '6rem';
    credit.style.zIndex = '10000';
    credit.style.backdropFilter = enableBlurAnimation
      ? 'blur(0px)'
      : 'blur(16px)';
    credit.style.filter = enableBlurAnimation ? 'blur(0px)' : 'blur(1px)';
    credit.style.userSelect = 'none';
    credit.style.cursor = 'pointer';
    credit.style.opacity = '0';
    credit.style.transition = enableBlurAnimation
      ? 'opacity 1.2s cubic-bezier(.4,0,.2,1), filter 0.7s cubic-bezier(.4,0,.2,1)'
      : 'opacity 1.2s cubic-bezier(.4,0,.2,1)';
    credit.innerHTML = `
      <span style="font-size:5rem;letter-spacing:1px;text-align:center;display:block;">MACHINE #4</span>
      <span style="font-size:2rem;letter-spacing:1px;text-align:center;display:block;">ORIGINAL PRODUCTION BY</span>
      <div style="width:200px;height:200px;border:8px solid white;background:black;display:flex;align-items:center;justify-content:center;margin:20px 0;">
        <span style="color:white;font-size:2.5rem;text-align:center;">DAVID BORING</span>
      </div>
      <div style="display: flex; align-items: center; gap: 0.25rem;">
        <span style="font-size:1.5rem;display:inline-block;width:2rem;height:2rem;line-height:2rem;text-align:center;border:2px solid white;border-radius:50%;">C</span><span style="font-size:2rem;display:inline-flex;">+</span><span style="font-size:1.5rem;display:inline-block;width:2rem;height:2rem;line-height:2rem;text-align:center;border:2px solid white;border-radius:50%;">P</span><span style="font-size:2rem;display:inline-flex;">2026 DAVID BORING / ELIZABETH KEZIA WIDJAJA</span>
      </div>
       <span style="font-size:2rem;text-align:center;display:block;">ALL RIGHTS RESERVED</span>
    `;
    document.body.appendChild(credit);

    // Animate blur from 0px to 4px and loop if enabled
    if (enableBlurAnimation) {
      let blurVal = 0;
      let blurDir = 1;
      credit._blurInterval = setInterval(() => {
        blurVal += blurDir * 0.2;
        if (blurVal >= 4) blurDir = -1;
        if (blurVal <= 0) blurDir = 1;
        credit.style.filter = `blur(${blurVal}px)`;
      }, 50);
      credit._cleanup = () => clearInterval(credit._blurInterval);
    }
  }
  setTimeout(() => {
    credit.style.opacity = '1';
  }, 50);
}

// Click Listener
// Play button click
playBtn.addEventListener('click', function (e) {
  e.preventDefault();
  if (isPlaying) return;
  if (window.audioCtx && window.audioCtx.state === 'suspended') {
    window.audioCtx.resume();
  }
  startPlayback(pauseTime || 0);
  isPlaying = true;
  isPaused = false;
  audioEnded = false;
  startPlaybackTimestamp(pauseTime || 0);
  setInfoUIVisibility(true);
  showPauseOnHover();
});

// Pause button click
pauseBtn.addEventListener('click', function (e) {
  e.preventDefault();
  if (!isPlaying) return;
  stopPlayback();
  pauseTime = audioCtx.currentTime - startTime;
  isPlaying = false;
  isPaused = true;
  audioEnded = false;
  pausePlaybackTimestamp(pauseTime);
  // setInfoUIVisibility(false);
  showPlayOnHover();
});
function showPlayOnHover() {
  playBtn.style.opacity = !isPlaying ? '1' : '0';
  pauseBtn.style.opacity = '0';
  playBtn.style.pointerEvents = 'auto';
}

function showPauseOnHover() {
  playBtn.style.opacity = '0';
  pauseBtn.style.opacity = isPlaying ? '1' : '0';
  pauseBtn.style.pointerEvents = 'auto';
}

// Listen for audio end event from convert-sound.js
document.addEventListener('audio-ended', function () {
  isPlaying = false;
  isPaused = false;
  audioEnded = true;
  createRestartBtn();
  stopPlaybackTimestamp();
  setInfoUIVisibility(false);
});

// Listen for restart event
document.addEventListener('restart-clicked', function () {
  if (restartBtn) restartBtn.style.display = 'none';
  isPlaying = false;
  isPaused = false;
  setInfoUIVisibility(false);
});

const guestBtn = document.getElementById('gc-connect');
guestBtn.addEventListener('click', async (e) => {
  e.preventDefault();

  shadowMovementEnabled = true;
  isAutopilot = true;
  hasSelectedMode = true;

  // Hide the room UI
  hideUiPanel();

  // Enable playback controls
  playBtn.style.pointerEvents = 'auto';
  pauseBtn.style.pointerEvents = 'auto';
  pauseBtn.style.opacity = '0'; // Ensure pauseBtn is hidden on entry
  // Start playback in guest mode. Uses shared isDeviceRotated() helper.

  if (typeof startPlayback === 'function') {
    const startNow = () => {
      startPlayback(0);
      startPlaybackTimestamp(0);
      isPlaying = true;
      isPaused = false;
      audioEnded = false;
      document.dispatchEvent(new CustomEvent('play-clicked'));
      loadingDiv.style.opacity = isDeviceRotated() ? '0' : '1';
      // cleanup listeners
      window.removeEventListener('orientationchange', onOrientationChange);
      window.removeEventListener('resize', onOrientationChange);
    };

    let onOrientationChange = null;

    if (isMobile) {
      if (isDeviceRotated()) {
        startNow();
      } else {
        onOrientationChange = () => {
          if (isDeviceRotated()) startNow();
        };
        window.addEventListener('orientationchange', onOrientationChange);
        window.addEventListener('resize', onOrientationChange);
      }
    } else {
      startNow();
    }
  }
});

const remoteBtn = document.getElementById('remote-btn');
remoteBtn.addEventListener('click', async () => {
  await goToRemote();
  isRemote = true;
});

const soloRemoteBtn = document.getElementById('solo-remote-btn');
if (soloRemoteBtn) {
  soloRemoteBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    // Attempt to enable local gyro (permission must run inside user gesture)
    isSolo = true;
    try {
      await enableLocalGyro();
    } catch (err) {
      console.warn('enableLocalGyro failed', err);
    }

    // Only hide UI after attempting permission so prompt isn't blocked
    try {
      hideUiPanel();
    } catch (hideErr) {
      console.warn('hideUiPanel failed', hideErr);
    }
  });
} else {
  console.warn('solo-remote-btn not found; cannot attach SOLO handler');
}

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

// --- BLINKING ---
