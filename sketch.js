// Map & Audio, Cesium
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
const defaultServer = `${location.protocol}//${location.hostname}:3000`;
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
    destination: Cesium.Cartesian3.fromDegrees(currentLon, currentLat, 500),
  });

  // create moving point
  movingPoint = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(currentLon, currentLat, height),
    // point: { pixelSize: 10, color: Cesium.Color.RED },
  });

  // Create loading overlay
  let loadingDiv = document.createElement('div');
  loadingDiv.id = 'audio-loading';
  loadingDiv.textContent = 'DAVID BORING';
  loadingDiv.style.position = 'fixed';
  loadingDiv.style.top = '0';
  loadingDiv.style.left = '0';
  loadingDiv.style.width = '100vw';
  loadingDiv.style.height = '100vh';
  loadingDiv.style.background = 'rgba(0,0,0,0.6)';
  loadingDiv.style.color = 'white';
  loadingDiv.style.display = 'flex';
  loadingDiv.style.alignItems = 'center';
  loadingDiv.style.justifyContent = 'center';
  loadingDiv.style.fontSize = '2rem';
  loadingDiv.style.zIndex = '9999';
  loadingDiv.style.backdropFilter = 'blur(16px)';
  loadingDiv.style.transition =
    'backdrop-filter 0.7s cubic-bezier(.4,0,.2,1), background 0.7s cubic-bezier(.4,0,.2,1)';
  loadingDiv.style.opacity = '1';
  document.body.appendChild(loadingDiv);

  loadAudio('audio.wav').then(() => {
    // Animate blur out and fade background
    loadingDiv.style.backdropFilter = 'blur(0px)';
    loadingDiv.style.opacity = '0';

    loadingDiv.style.background = 'rgba(0,0,0,0)';
    setTimeout(() => {
      loadingDiv.remove();
      showPlayOnHover();
    }, 2000);
  });
});

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

// ==== inside your existing code, add these ====

async function loadAudio(url) {
  audioCtx = new AudioContext();
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
}

function startPlayback() {
  if (audioCtx.state === 'suspended') audioCtx.resume();

  source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  timeDomainData = new Float32Array(analyser.fftSize);

  source.connect(analyser);
  analyser.connect(audioCtx.destination);
  source.start();

  console.log('Playback started');

  // fixed direction (north)
  let directionAngle = 0; // 0 radians = north
  let speed = 0.0002; // forward step per interval

  interval = setInterval(() => {
    // compute deltas for northward movement
    const forwardLonDelta = Math.sin(directionAngle) * speed; // left/right
    const forwardLatDelta = Math.cos(directionAngle) * speed; // forward

    // update position
    // Access as GUEST
    // currentLon += forwardLonDelta;
    currentLat += forwardLatDelta;

    // update Cesium entity
    if (movingPoint && viewer) {
      const newPosition = Cesium.Cartesian3.fromDegrees(
        currentLon,
        currentLat,
        height,
      );
      movingPoint.position = newPosition;

      // move and orient camera north
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(currentLon, currentLat, 500),
        orientation: {
          heading: directionAngle,
          pitch: Cesium.Math.toRadians(-15),
          roll: 0,
        },
      });
    }

    console.log(
      `→ Moving north | Lon: ${currentLon.toFixed(
        6,
      )} | Lat: ${currentLat.toFixed(6)}`,
    );
  }, intervalFrame);

  source.onended = stopPlayback;
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
locDiv.style.zIndex = '1000';
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

// GLITCH
const glitchCanvas = document.getElementById('glitchCanvas');
const gctx = glitchCanvas.getContext('2d');

function resizeCanvas() {
  glitchCanvas.width = window.innerWidth;
  glitchCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Function to resize the main canvas to full screen dimensions
function resizeCanvasToFullScreen() {
  if (!canvas) return;

  // Get the device pixel ratio for high-DPI screens
  const pixelRatio = window.devicePixelRatio || 1;

  // Set the logical size (CSS size)
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';

  // Get the display size of the canvas in CSS pixels
  const displayWidth = window.innerWidth;
  const displayHeight = window.innerHeight;

  // Check if the canvas is a different size (ignoring pixelRatio for this check)
  const needResize =
    canvas.width !== displayWidth || canvas.height !== displayHeight;

  if (needResize) {
    // Set actual size in pixels, scaled for the device
    canvas.width = displayWidth;
    canvas.height = displayHeight;
  }
}

// ---- GYRO ----
// Connects to the server (Socket.IO) and applies incoming gyro messages to the global map.
(function () {
  // Prefer same protocol to avoid mixed-content issues
  const defaultServer = `https://714870b841be.ngrok-free.app`;

  let status = null;

  // Create a small overlay UI
  const ui = document.createElement('div');
  ui.id = 'room-code-panel';
  ui.style.position = 'fixed';
  ui.style.left = '50%';
  ui.style.top = '50%';
  ui.style.transform = 'translate(-50%, -50%)';
  ui.style.zIndex = 30000;
  ui.style.background = 'rgba(0,0,0,0.6)';
  ui.style.color = 'white';
  ui.style.padding = '10px';
  ui.style.borderRadius = '8px';
  ui.style.fontSize = '13px';
  ui.style.maxWidth = '300px';
  ui.innerHTML = `
    <p>Enter the room code and connect to stream gyroscope data from your mobile device to [DAVIDBORING][MATTER]</p>

    <div id="room-input-container" style="display:flex;gap:6px;margin-bottom:6px"></div>
    <input id="gc-room" type="hidden" />
    <p>Don't have a mobile device?<br/ ></p>
    <div style="display:flex;gap:6px;margin-bottom:6px"><button id="gc-connect">Guest</button></div>
  `;
  // <div id='gc-status' style='margin-top:6px;font-size:12px;opacity:0.9'>
  //   Disconnected
  // </div>;

  document.body.appendChild(ui);

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
  idUI.innerText = '000000000000';
  document.body.appendChild(idUI);

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
      s.style.fontSize = '20px';
      s.style.fontWeight = '600';
      s.textContent = '';
      roomInputContainerEl.appendChild(s);
    }
  }
  // elements
  const roomInput = document.getElementById('gc-room');
  const roomInputContainer = document.getElementById('room-input-container');
  const smoothEl = document.getElementById('gc-smooth');

  let socket = null;
  let last = { alpha: 0, beta: 0, gamma: 0 };
  let offset = { alpha: 0, beta: 0, gamma: 0 };
  let smoothing = 0.2;

  // On init, request a room code from the server and prefill the room input
  (async function assignRoom() {
    const tried = [];
    const candidates = [`${defaultServer}/api/new-room`, '/api/new-room'];

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
        // desktop join the room
        socket.emit('join-room', j.room, 'desktop');
        if (j && j.room) {
          roomInput.value = j.room;
          for (let i = 0; i < roomInputContainer.children.length; i++) {
            roomInputContainer.children[i].textContent = j.room[i] || '';
          }
          // Add Enter Button
          roomInputContainer.innerHTML += `<span id="gc-loading-room" style="margin-left:8px width:100%;display:flex;align-items:center;justify-content:center;">${
            !status ? 'Waiting...' : status
          }</span>`;

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
      // Change the UI Guest Panel
      // Hide the room code UI
      const roomCodePanel = document.getElementById('room-code-panel');
      status = 'OK';
      setTimeout(() => {
        roomCodePanel.style.display = 'none';
      }, 1000);
    } else console.log('Wrong room code.');
  });

  socket.on('gyro', (data) => {
    // Update Gyro UI
    gyroInfoUI.innerText = data.gyro;
    deltaInfoUI.innerText = data.delta;
    idUI.innerText = data.id;

    // change distance of lon with delta
    // currentLon += Number(data.delta) * 0.0001;
    currentLat += Math.abs(Number(data.delta)) * 0.0001;
    // change camera rot direction with gyro
    // data.gyro controls rotation (turn left/right)
    const gyroValue = Number(data.gyro) || 0;

    // Adjust heading based on gyro — scale down so it’s not too sensitive
    cameraHeading = Cesium.Math.toRadians(gyroValue * 0.1); // radians per update (tweak multiplier)

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
