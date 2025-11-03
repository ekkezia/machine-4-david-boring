// UI Check
// redirect to /remote/ if on mobile device
// todo refactor
const isMobile = (() => {
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const ua = navigator.userAgent;
  const mobileUA =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const isSmall = Math.min(window.innerWidth, window.innerHeight) < 768;
  return hasTouch && (mobileUA || isSmall);
})();

if (isMobile) {
  const currentUrl = new URL(window.location.href);
  currentUrl.pathname = '/remote/';
  window.location.href = currentUrl.href;
}

// UI elements
// Playback timestamp element
let playbackTimestamp = document.createElement('div');
playbackTimestamp.id = 'playback-timestamp';
playbackTimestamp.style.position = 'fixed';
playbackTimestamp.style.bottom = '30px';
playbackTimestamp.style.left = '50%';
playbackTimestamp.style.transform = 'translateX(-50%)';
playbackTimestamp.style.background = 'rgba(0,0,0,0.7)';
playbackTimestamp.style.color = 'white';
playbackTimestamp.style.padding = '8px 16px';
playbackTimestamp.style.borderRadius = '8px';
playbackTimestamp.style.fontFamily = "'Wallpoet', sans-serif";
playbackTimestamp.style.fontSize = '1.2rem';
playbackTimestamp.style.zIndex = '1000';
playbackTimestamp.textContent = '00:00:00';
document.body.appendChild(playbackTimestamp);

let playbackInterval = null;
let playbackStartTime = null;

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((v) => v.toString().padStart(2, '0')).join(':');
}

function startPlaybackTimestamp() {
  if (window.audioCtx && window.audioCtx.currentTime !== undefined) {
    playbackStartTime = window.audioCtx.currentTime;
  } else {
    playbackStartTime = performance.now() / 1000;
  }
  playbackTimestamp.textContent = '00:00:00';
  playbackTimestamp.style.display = 'block';
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

function stopPlaybackTimestamp() {
  if (playbackInterval) clearInterval(playbackInterval);
  playbackInterval = null;
  playbackTimestamp.textContent = '00:00:00';
  playbackTimestamp.style.display = 'none';
}

// Fade out and hide the play button when clicked
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const controls = document.getElementsByClassName('control-hover-area');
let isPlaying = false;
let isPaused = false;
let audioEnded = false;
let restartBtn;

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
  startPlayback();
  isPlaying = true;
  isPaused = false;
  audioEnded = false;
  document.dispatchEvent(new CustomEvent('play-clicked'));
  showPauseOnHover();
  startPlaybackTimestamp();
});

// Pause button click
pauseBtn.addEventListener('click', function (e) {
  e.preventDefault();

  stopPlayback();
  isPlaying = false;
  isPaused = true;
  audioEnded = false;
  document.dispatchEvent(new CustomEvent('pause-clicked'));

  // fade out play button & hide
  document.getElementById('pauseBtn').style.opacity = '0';
  showPlayOnHover();
  stopPlaybackTimestamp();
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
