// Canvas visibility fix - runs after page load
document.addEventListener('DOMContentLoaded', function () {
  // Get or create canvas
  let canvas = document.getElementById('canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'canvas';
    canvas.width = 640;
    canvas.height = 480;
    document.body.appendChild(canvas);
  }

  // Force canvas to be visible and on top
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.zIndex = '10000';
  canvas.style.opacity = '0.5';
  canvas.style.filter = 'none';
  canvas.style.mixBlendMode = 'hard-light';
  canvas.style.pointerEvents = 'none';

  // Move canvas to the end of body to ensure it's on top
  document.body.appendChild(canvas);
});
