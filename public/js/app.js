// MinePulse Telemetry OS Engine (Multi-View Navigation)

let currentActiveTab = 'dashboard';
let oscilloscopeChart = null;
let sirenActive = false;
let sirenAcknowledged = false;
let audioCtx = null;
let historicalReadings = [];
let allDatabaseReadings = [];
let allAlerts = [];
let registeredNodes = [];
let seismicPhase = 0;
let triggerCount = 0;
let lastPacketHex = 0x45A0;

// Initialize Web Audio
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playBuzzer(freq = 900, duration = 0.15) {
  if (sirenAcknowledged || !audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.005, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {
    // silent fail
  }
}

// Tab Switching Engine
function switchTab(tabId) {
  currentActiveTab = tabId;

  // 1. Update navigation active pills
  const navItems = document.querySelectorAll('.nav-dock-item');
  const tabNames = ['dashboard', 'nodes', 'analytics', 'alerts', 'settings'];
  navItems.forEach((item, index) => {
    if (tabNames[index] === tabId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // 2. Switch visible view container
  document.querySelectorAll('.view-section').forEach(view => {
    view.classList.remove('active');
  });
  const targetView = document.getElementById(`view-${tabId}`);
  if (targetView) targetView.classList.add('active');

  // 3. Tab-specific data loading
  if (tabId === 'nodes') {
    setTimeout(initMineGuardCanvas, 40);
  } else if (tabId === 'analytics') {
    fetchAnalyticsData();
  } else if (tabId === 'alerts') {
    fetchAlerts();
  } else if (tabId === 'dashboard') {
    drawVectorGrid();
    if (historicalReadings.length > 0) {
      drawTensionSparkline(historicalReadings.map(r => Number(r.tension || 0)));
    }
  }
}

// 1. Vector Grid Canvas Renderer (Tilt MPU6050)
function drawVectorGrid(pitch = 2.4, roll = -1.1) {
  const canvas = document.getElementById('canvasVectorGrid');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio || 240;
  canvas.height = rect.height * window.devicePixelRatio || 140;
  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

  const w = rect.width;
  const h = rect.height;
  const cx = w / 2;
  const cy = h / 2;

  ctx.clearRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
  ctx.lineWidth = 1;
  const gridSize = 14;
  for (let x = 0; x <= w; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Target Box
  const boxW = 50;
  const boxH = 50;
  ctx.strokeStyle = 'rgba(180, 83, 9, 0.8)';
  ctx.fillStyle = 'rgba(180, 83, 9, 0.08)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
  ctx.fillRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);

  // Axes
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, h);
  ctx.moveTo(0, cy);
  ctx.lineTo(w, cy);
  ctx.stroke();

  // Labels
  ctx.fillStyle = '#64748b';
  ctx.font = "9px 'JetBrains Mono', monospace";
  ctx.textAlign = 'center';
  ctx.fillText('Y', cx, 10);
  ctx.fillText('X', w - 8, cy - 4);
  ctx.fillText('X', 8, cy - 4);

  // Vector Target
  const targetX = cx + (roll * 5);
  const targetY = cy - (pitch * 5);

  ctx.strokeStyle = '#b45309';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(targetX, targetY);
  ctx.stroke();

  // Crosshair point
  ctx.strokeStyle = '#b45309';
  ctx.lineWidth = 2.5;
  const pSize = 5;
  ctx.beginPath();
  ctx.moveTo(targetX - pSize, targetY);
  ctx.lineTo(targetX + pSize, targetY);
  ctx.moveTo(targetX, targetY - pSize);
  ctx.lineTo(targetX, targetY + pSize);
  ctx.stroke();
}

// 2. Seismic Waveform Canvas Renderer
function drawSeismicWaveform(isVibrating = false) {
  const canvas = document.getElementById('canvasSeismic');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * (window.devicePixelRatio || 1) || 240;
  canvas.height = rect.height * (window.devicePixelRatio || 1) || 80;
  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

  const w = rect.width;
  const h = rect.height;
  const cy = h / 2;

  ctx.clearRect(0, 0, w, h);

  // Center Zero Reference Grid Line
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, cy);
  ctx.lineTo(w, cy);
  ctx.stroke();

  if (!isVibrating) {
    // RESTING / STABLE FLATLINE (Zero Activity)
    ctx.strokeStyle = '#15803d'; // Tactical Calm Green
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.stroke();

    // Resting micro-glow
    ctx.fillStyle = 'rgba(21, 128, 61, 0.08)';
    ctx.fillRect(0, cy - 2, w, 4);
    return;
  }

  // ACTIVE SEISMIC VIBRATION DETECTED (High-frequency spikes)
  ctx.strokeStyle = '#dc2626'; // Hazard Red
  ctx.lineWidth = 2.5;
  ctx.beginPath();

  seismicPhase += 0.35;
  const baseAmp = 26;

  for (let x = 0; x < w; x++) {
    const freq1 = Math.sin(x * 0.12 + seismicPhase);
    const freq2 = Math.sin(x * 0.28 - seismicPhase * 2.2);
    const noise = (Math.random() - 0.5) * 14;
    const y = cy + (freq1 * freq2 * baseAmp) + noise;

    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// 3. Tension Sparkline Canvas Renderer
function drawTensionSparkline(dataSeries) {
  const canvas = document.getElementById('canvasSparkline');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio || 240;
  canvas.height = rect.height * window.devicePixelRatio || 38;
  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

  const w = rect.width;
  const h = rect.height;

  ctx.clearRect(0, 0, w, h);
  if (!dataSeries || dataSeries.length < 2) return;

  const maxVal = Math.max(...dataSeries, 180);
  const minVal = 0;
  const stepX = w / (dataSeries.length - 1);

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(180, 83, 9, 0.25)');
  grad.addColorStop(1, 'rgba(180, 83, 9, 0.0)');

  ctx.beginPath();
  dataSeries.forEach((val, i) => {
    const x = i * stepX;
    const y = h - ((val - minVal) / (maxVal - minVal)) * (h - 6) - 3;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.strokeStyle = '#b45309';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
}

// =========================================================================
// 4. MINEGUARD STRING TENSION RESCUE SIMULATOR ENGINE (NODES VIEW)
// =========================================================================
let mineC = null;
let mineX = null;
let mineW = 0;
let mineH = 0;
let mineDpr = 1;
let mineSimRunning = false;
let mineLogs = [];
let draggedNode = null;
let dragStartPos = null;

let mineNodes = [
  ['N1', 0.18, 0.34, 12],
  ['N2', 0.36, 0.31, 13],
  ['N3', 0.54, 0.34, 11],
  ['N4', 0.72, 0.31, 14],
  ['N5', 0.84, 0.48, 12],
  ['N6', 0.64, 0.56, 13],
  ['N7', 0.43, 0.55, 12],
  ['N8', 0.23, 0.53, 11]
].map(a => ({
  id: a[0],
  x: a[1],
  y: a[2],
  ox: a[1],
  oy: a[2],
  t: a[3],
  base: a[3],
  target: a[3],
  shake: 0,
  drag: false
}));

function getMineStatus(t) {
  if (t < 25) return ['SAFE', '#16a34a', 'Normal structural tension'];
  if (t < 50) return ['CAUTION', '#eab308', 'Increased tension • inspect area'];
  if (t < 75) return ['EVACUATE', '#f97316', 'Structural movement detected • evacuate'];
  return ['EMERGENCY', '#dc2626', 'Critical tension • immediate evacuation'];
}

function simLog(s) {
  mineLogs.unshift('<div class="sim-log-item"><b>' + new Date().toLocaleTimeString() + '</b> — ' + s + '</div>');
  mineLogs = mineLogs.slice(0, 15);
  const logEl = document.getElementById('simEventLog');
  if (logEl) logEl.innerHTML = mineLogs.join('');
}

function updateSimPanel() {
  const panel = document.getElementById('simNodesList');
  if (!panel) return;
  panel.innerHTML = mineNodes.map(n => {
    let q = getMineStatus(n.t);
    return `<div class="sim-node-row">
      <span class="sim-node-dot" style="background:${q[1]}; box-shadow:0 0 6px ${q[1]}"></span>
      <div>
        <strong style="color:var(--text-black); font-size:0.75rem;">${n.id}</strong>
        <div style="font-size:0.65rem; color:${q[1]}; font-weight:700;">${q[0]}</div>
      </div>
      <strong style="color:var(--text-black);">${Math.round(n.t)}%</strong>
    </div>`;
  }).join('');
}

function initMineGuardCanvas() {
  mineC = document.getElementById('c_mine');
  if (!mineC) return;
  mineX = mineC.getContext('2d');

  function resizeMine() {
    if (!mineC) return;
    mineDpr = Math.min(window.devicePixelRatio || 1, 2);
    mineW = mineC.clientWidth;
    mineH = mineC.clientHeight;
    mineC.width = mineW * mineDpr;
    mineC.height = mineH * mineDpr;
    mineX.setTransform(mineDpr, 0, 0, mineDpr, 0, 0);
  }
  window.addEventListener('resize', resizeMine);
  resizeMine();

  // Pointer Interaction (Drag and Drop Nodes)
  function pointerPos(e) {
    const r = mineC.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  function nearestNode(p) {
    let best = null, bd = 0.06;
    mineNodes.forEach(n => {
      let d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < bd) { bd = d; best = n; }
    });
    return best;
  }

  mineC.addEventListener('pointerdown', e => {
    const p = pointerPos(e), n = nearestNode(p);
    if (n) {
      draggedNode = n;
      dragStartPos = { x: n.x, y: n.y };
      n.drag = true;
      mineC.setPointerCapture(e.pointerId);
      simLog(n.id + ' anchor selected — simulating displacement');
    }
  });

  mineC.addEventListener('pointermove', e => {
    if (!draggedNode) return;
    const p = pointerPos(e);
    draggedNode.x = Math.max(0.06, Math.min(0.94, p.x));
    draggedNode.y = Math.max(0.18, Math.min(0.72, p.y));
    draggedNode.target = Math.min(100, draggedNode.base + Math.hypot(draggedNode.x - draggedNode.ox, draggedNode.y - draggedNode.oy) * 420);
    draggedNode.shake = 1;
  });

  mineC.addEventListener('pointerup', e => {
    if (!draggedNode) return;
    const n = draggedNode;
    n.drag = false;
    const displacement = Math.hypot(n.x - n.ox, n.y - n.oy);
    if (displacement > 0.015) {
      simLog(n.id + ' displaced ' + Math.round(displacement * 1000) / 10 + '% — string tension increased');
    }
    draggedNode = null;
  });

  mineC.addEventListener('pointercancel', () => {
    if (draggedNode) { draggedNode.drag = false; draggedNode = null; }
  });

  if (mineLogs.length === 0) {
    simLog('MineGuard Network Online — 8 Strata Nodes Active');
    simLog('Baseline mechanical string tension calibrated');
  }

  if (!mineSimRunning) {
    mineSimRunning = true;
    let lastTime = performance.now();
    function mineSimLoop(t) {
      let dt = Math.min((t - lastTime) / 1000, 0.05);
      lastTime = t;
      if (currentActiveTab === 'nodes') {
        updateMinePhysics(dt);
        drawMineMap();
      }
      requestAnimationFrame(mineSimLoop);
    }
    requestAnimationFrame(mineSimLoop);
  }
}

function triggerMineSimMove(amount, msg) {
  mineNodes.forEach((n, i) => {
    let effect = amount * (1.1 - (Math.abs(n.x - 0.55) + Math.abs(n.y - 0.45)) * 0.55);
    n.target = Math.min(100, n.base + effect + (amount > 80 ? (i % 3) * 4 : 0));
    n.shake = 1;
  });
  simLog(msg);
}

function resetMineSim() {
  mineNodes.forEach(n => {
    n.target = n.base;
    n.x = n.ox;
    n.y = n.oy;
    n.shake = 0;
  });
  simLog('Mine reset — baseline string tension restored');
}

function updateMinePhysics(dt) {
  mineNodes.forEach((n, i) => {
    let neighborEffect = 0;
    if (i > 0) neighborEffect += Math.hypot(n.x - mineNodes[i - 1].x, n.y - mineNodes[i - 1].y);
    if (i < mineNodes.length - 1) neighborEffect += Math.hypot(n.x - mineNodes[i + 1].x, n.y - mineNodes[i + 1].y);
    let natural = neighborEffect > 0.42 ? (neighborEffect - 0.42) * 180 : 0;
    if (!n.drag) n.target = Math.max(n.base, Math.min(100, n.target + natural * dt * 2));
    n.t += (n.target - n.t) * Math.min(1, dt * 4);
    n.target += (n.base - n.target) * dt * 0.035;
    n.shake = Math.max(0, n.shake - dt * 0.5);
  });

  let peak = Math.max(...mineNodes.map(n => n.t));
  let q = getMineStatus(peak);

  const stateEl = document.getElementById('simState');
  if (stateEl) {
    stateEl.textContent = q[0];
    stateEl.style.color = q[1];
    document.getElementById('simDesc').textContent = q[2];
    document.getElementById('simPeak').textContent = Math.round(peak) + '%';
    document.getElementById('simFill').style.width = peak + '%';
    document.getElementById('simFill').style.background = q[1];

    let b = document.getElementById('simBanner');
    if (b) {
      b.style.borderColor = q[1];
      document.getElementById('simBt').textContent = q[0];
      document.getElementById('simBt').style.color = q[1];
      document.getElementById('simBs').textContent = q[2];
      b.classList.toggle('show', peak >= 25);
    }
  }

  updateSimPanel();
}

function drawMineMap() {
  if (!mineX || !mineW || !mineH) return;
  const x = mineX, W = mineW, H = mineH;

  x.clearRect(0, 0, W, H);

  // Background rock
  const bg = x.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#25231f');
  bg.addColorStop(1, '#111210');
  x.fillStyle = bg;
  x.fillRect(0, 0, W, H);

  x.fillStyle = '#35332d';
  x.fillRect(0, 0, W, H);

  // Rock patches
  for (let i = 0; i < 55; i++) {
    let xx = (i * 137) % W, yy = (i * 83) % H, r = 12 + (i % 8) * 5;
    x.fillStyle = i % 2 ? 'rgba(80,75,64,.35)' : 'rgba(20,20,18,.3)';
    x.beginPath();
    x.arc(xx, yy, r, 0, Math.PI * 2);
    x.fill();
  }

  // Corridors
  x.fillStyle = '#171815';
  x.fillRect(W * 0.08, H * 0.18, W * 0.84, H * 0.64);
  x.fillRect(W * 0.08, H * 0.10, W * 0.12, H * 0.16);
  x.fillRect(W * 0.80, H * 0.10, W * 0.12, H * 0.16);
  x.fillRect(W * 0.08, H * 0.72, W * 0.12, H * 0.18);
  x.fillRect(W * 0.80, H * 0.72, W * 0.12, H * 0.18);

  // Tunnel edges
  x.strokeStyle = '#625c4e';
  x.lineWidth = 4;
  x.strokeRect(W * 0.08, H * 0.18, W * 0.84, H * 0.64);
  x.strokeRect(W * 0.08, H * 0.10, W * 0.12, H * 0.16);
  x.strokeRect(W * 0.80, H * 0.10, W * 0.12, H * 0.16);
  x.strokeRect(W * 0.08, H * 0.72, W * 0.12, H * 0.18);
  x.strokeRect(W * 0.80, H * 0.72, W * 0.12, H * 0.18);

  // Mine Pillars
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 7; col++) {
      let xx = W * (0.17 + col * 0.11), yy = H * (0.29 + row * 0.20);
      x.fillStyle = '#5d4c35';
      x.fillRect(xx - 7, yy - 7, 14, 14);
      x.strokeStyle = '#8a7049';
      x.lineWidth = 1.5;
      x.strokeRect(xx - 7, yy - 7, 14, 14);
    }
  }

  // Mine Rails
  x.strokeStyle = '#817967';
  x.lineWidth = 3;
  x.beginPath(); x.moveTo(W * 0.50, H * 0.12); x.lineTo(W * 0.50, H * 0.88); x.stroke();
  x.beginPath(); x.moveTo(W * 0.54, H * 0.12); x.lineTo(W * 0.54, H * 0.88); x.stroke();
  x.strokeStyle = '#4d493f';
  x.lineWidth = 2;
  for (let yy = H * 0.15; yy < H * 0.88; yy += 30) {
    x.beginPath(); x.moveTo(W * 0.47, yy); x.lineTo(W * 0.57, yy); x.stroke();
  }

  // Section labels
  x.font = "bold 10px 'JetBrains Mono', monospace";
  x.textAlign = 'left';
  x.fillStyle = '#8f958f';
  x.fillText('TUNNEL A', W * 0.10, H * 0.21);
  x.fillText('MONITORED ZONE (MINEGUARD)', W * 0.10, H * 0.25);
  x.fillText('TUNNEL B', W * 0.82, H * 0.21);

  // Drainage
  x.fillStyle = 'rgba(52,78,83,.45)';
  x.fillRect(W * 0.12, H * 0.75, W * 0.22, H * 0.035);
  x.fillStyle = '#83989a';
  x.font = "9px 'JetBrains Mono', monospace";
  x.fillText('DRAINAGE', W * 0.14, H * 0.775);

  // Cracks
  x.strokeStyle = 'rgba(180,160,120,.55)';
  x.lineWidth = 1.5;
  [[0.22, 0.22, 0.28, 0.29], [0.67, 0.28, 0.72, 0.22], [0.76, 0.62, 0.70, 0.68], [0.29, 0.65, 0.34, 0.59]].forEach(a => {
    x.beginPath(); x.moveTo(W * a[0], H * a[1]); x.lineTo(W * a[2], H * a[3]); x.stroke();
  });

  // String Tension Cables between nodes
  for (let i = 0; i < mineNodes.length - 1; i++) {
    let a = mineNodes[i], b = mineNodes[i + 1], q = getMineStatus((a.t + b.t) / 2);
    x.strokeStyle = q[1];
    x.lineWidth = 3.5;
    x.shadowColor = q[1];
    x.shadowBlur = (a.t + b.t) / 2 > 25 ? 10 : 2;
    x.beginPath();
    x.moveTo(W * a.x, H * a.y);
    x.lineTo(W * b.x, H * b.y);
    x.stroke();
    x.shadowBlur = 0;
  }

  // Network return loop
  {
    let a = mineNodes[mineNodes.length - 1], b = mineNodes[0], q = getMineStatus((a.t + b.t) / 2);
    x.strokeStyle = q[1];
    x.lineWidth = 2.5;
    x.setLineDash([8, 5]);
    x.beginPath(); x.moveTo(W * a.x, H * a.y); x.lineTo(W * b.x, H * b.y); x.stroke();
    x.setLineDash([]);
  }

  // Nodes
  mineNodes.forEach(n => {
    let q = getMineStatus(n.t), xx = W * n.x, yy = H * n.y;
    if (n.shake) xx += Math.sin(Date.now() / 35 + n.x * 10) * 2;

    x.fillStyle = 'rgba(0,0,0,.4)';
    x.beginPath(); x.arc(xx + 2, yy + 3, 18, 0, Math.PI * 2); x.fill();

    x.fillStyle = '#111619';
    x.beginPath(); x.arc(xx, yy, 15, 0, Math.PI * 2); x.fill();
    x.strokeStyle = q[1];
    x.lineWidth = n.drag ? 4 : 2.5;
    x.stroke();

    x.fillStyle = q[1];
    x.shadowColor = q[1];
    x.shadowBlur = n.drag ? 18 : 8;
    x.beginPath(); x.arc(xx, yy, 6, 0, Math.PI * 2); x.fill();
    x.shadowBlur = 0;

    x.fillStyle = '#ffffff';
    x.font = "bold 10px 'JetBrains Mono', monospace";
    x.textAlign = 'center';
    x.fillText(n.id, xx, yy - 20);
    x.fillStyle = '#c7cdd0';
    x.font = "8px 'JetBrains Mono', monospace";
    x.fillText(Math.round(n.t) + '%', xx, yy + 25);
  });

  // Airborne Dust (Visual verification that dust does not trigger false mechanical alarm)
  for (let i = 0; i < 70; i++) {
    let xx = (i * 97 + Date.now() * 0.012 * (i % 3 + 1)) % W;
    let yy = (i * 53 + Date.now() * 0.004 * (i % 5 + 1)) % H;
    if (xx > W * 0.08 && xx < W * 0.92 && yy > H * 0.18 && yy < H * 0.82) {
      x.fillStyle = 'rgba(200,190,165,.14)';
      x.beginPath(); x.arc(xx, yy, 1 + (i % 2), 0, Math.PI * 2); x.fill();
    }
  }

  // Rescue Rover
  let rx = W * 0.50, ry = H * 0.91;
  x.fillStyle = '#080909'; x.fillRect(rx - 24, ry - 14, 48, 28);
  x.fillStyle = '#d49a27'; x.fillRect(rx - 18, ry - 10, 36, 20);
  x.fillStyle = '#26353a'; x.fillRect(rx - 8, ry - 6, 16, 12);
  x.fillStyle = '#111';
  x.fillRect(rx - 26, ry - 10, 5, 20);
  x.fillRect(rx + 21, ry - 10, 5, 20);

  // North Arrow
  x.fillStyle = '#d5d8d9';
  x.font = "bold 10px 'JetBrains Mono', monospace";
  x.textAlign = 'center';
  x.fillText('N', W * 0.95, H * 0.07);
  x.strokeStyle = '#d5d8d9';
  x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(W * 0.95, H * 0.10); x.lineTo(W * 0.95, H * 0.16); x.stroke();
  x.beginPath(); x.moveTo(W * 0.95, H * 0.10); x.lineTo(W * 0.945, H * 0.12); x.moveTo(W * 0.95, H * 0.10); x.lineTo(W * 0.955, H * 0.12); x.stroke();
}

// 5. Engineering Oscilloscope
function initOscilloscope() {
  const canvas = document.getElementById('oscilloscopeChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const fontConfig = { family: "'JetBrains Mono', monospace", size: 9 };

  const hazardZonesPlugin = {
    id: 'hazardZones',
    beforeDraw: (chart) => {
      const { ctx, chartArea: { top, bottom, left, right }, scales: { y } } = chart;
      if (!y) return;

      const y150 = y.getPixelForValue(150);
      const y200 = y.getPixelForValue(200);
      ctx.fillStyle = 'rgba(220, 38, 38, 0.08)';
      ctx.fillRect(left, y200, right - left, y150 - y200);

      const y75 = y.getPixelForValue(75);
      ctx.fillStyle = 'rgba(217, 119, 6, 0.07)';
      ctx.fillRect(left, y150, right - left, y75 - y150);

      ctx.strokeStyle = 'rgba(220, 38, 38, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(left, y150); ctx.lineTo(right, y150);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(217, 119, 6, 0.6)';
      ctx.beginPath();
      ctx.moveTo(left, y75); ctx.lineTo(right, y75);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#dc2626';
      ctx.font = "9px 'JetBrains Mono', monospace";
      ctx.fillText('Hazard zone', left + 8, y200 + 14);
    }
  };

  oscilloscopeChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Tension (N)',
          data: [],
          borderColor: '#b45309',
          backgroundColor: 'transparent',
          borderWidth: 2,
          tension: 0.25,
          pointRadius: 0,
          yAxisID: 'y',
        },
        {
          label: 'Angular Deflection (°)',
          data: [],
          borderColor: '#0284c7',
          backgroundColor: 'transparent',
          borderWidth: 1.8,
          tension: 0.25,
          pointRadius: 0,
          yAxisID: 'y1',
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#ffffff',
          borderColor: '#e2e8f0',
          borderWidth: 1,
          titleColor: '#0f172a',
          bodyColor: '#334155',
          titleFont: fontConfig,
          bodyFont: fontConfig,
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(0, 0, 0, 0.05)' },
          ticks: { color: '#64748b', font: fontConfig, maxRotation: 0 }
        },
        y: {
          type: 'linear',
          position: 'left',
          min: 0,
          max: 200,
          title: { display: true, text: 'Tension (N)', color: '#92400e', font: fontConfig },
          grid: { color: 'rgba(0, 0, 0, 0.05)' },
          ticks: { color: '#92400e', font: fontConfig, stepSize: 50 }
        },
        y1: {
          type: 'linear',
          position: 'right',
          min: -10,
          max: 10,
          title: { display: true, text: 'Angular Deflection (°)', color: '#0284c7', font: fontConfig },
          grid: { drawOnChartArea: false },
          ticks: { color: '#0284c7', font: fontConfig, stepSize: 5 }
        }
      }
    },
    plugins: [hazardZonesPlugin]
  });
}

let activeNodeFilter = 'NodeB';

function changeActiveNode(nodeId) {
  activeNodeFilter = nodeId;
  fetchTelemetry();
}

// 6. Fetch Telemetry Data
async function fetchTelemetry() {
  try {
    const url = (activeNodeFilter && activeNodeFilter !== 'ALL')
      ? `/api/readings?nodeId=${activeNodeFilter}&limit=30` 
      : '/api/readings?limit=30';
    const res = await fetch(url);
    if (!res.ok) return;
    const json = await res.json();
    if (!json.success || !json.readings || json.readings.length === 0) return;

    historicalReadings = json.readings;
    const latest = json.readings[0];

    if (currentActiveTab === 'dashboard') {
      updateDashboardView(latest, historicalReadings);
    } else if (currentActiveTab === 'nodes') {
      if (typeof drawMineMap === 'function') drawMineMap();
    }
  } catch (err) {
    console.error('Fetch error', err);
  }
}

function updateDashboardView(item, history) {
  const tension = getCleanLoadValue(item);
  const pitch = Number(item.tiltX ?? 0);
  const roll = Number(item.tiltY ?? 0);
  const isVibrating = item.vibration === true || (item.vibrationCount != null && item.vibrationCount > 0);
  const soil = Math.round(Number(item.soilMoisture ?? item.soil ?? 14.8));

  // 1. Tension Readout & ASTM bar
  document.getElementById('readoutTension').textContent = `${tension.toFixed(1)}N`;
  
  const percent = tension > 500 ? Math.min(Math.max((tension / 10000) * 100, 5), 95) : Math.min(Math.max((tension / 150) * 100, 5), 95);
  document.getElementById('astmCursor').style.left = `${percent}%`;

  const statusLabel = document.getElementById('astmStatusLabel');
  const maxLvl = Math.max(Number(item.loadLevel || 0), Number(item.movementLevel || 0), Number(item.vibrationLevel || 0));
  
  if (item.alertStatus === 'CRITICAL' || maxLvl === 2) {
    statusLabel.textContent = 'Critical Hazard: High Shift Detected';
    statusLabel.style.color = 'var(--hazard-red)';
    sirenActive = true;
    playBuzzer(920, 0.2);
  } else if (item.alertStatus === 'MODERATE' || maxLvl === 1) {
    statusLabel.textContent = 'Warning: Moderate Movement';
    statusLabel.style.color = 'var(--earth-amber)';
    sirenActive = false;
  } else {
    statusLabel.textContent = 'Normal: Stable Rock Load';
    statusLabel.style.color = 'var(--tactical-green)';
    sirenActive = false;
  }

  // 2. Tension Sparkline
  const tensionHistory = [...history].reverse().map(r => Number(r.tension ?? r.displacement ?? 0));
  drawTensionSparkline(tensionHistory);

  // 3. Tilt Coords & 2D Vector Grid
  document.getElementById('valPitch').textContent = `${pitch >= 0 ? '+' : ''}${pitch.toFixed(1)}°`;
  document.getElementById('valRoll').textContent = `${roll >= 0 ? '+' : ''}${roll.toFixed(1)}°`;
  drawVectorGrid(pitch, roll);

  // 4. Seismic Waveform & Trigger
  const activePulses = item.vibrationCount != null ? Number(item.vibrationCount) : (isVibrating ? 1 : 0);
  document.getElementById('valTriggerCount').textContent = activePulses > 0 ? `${activePulses} Pulses (Tremor Active)` : '0 (Calm / At Rest)';
  drawSeismicWaveform(isVibrating);

  // 5. Soil Saturation
  document.getElementById('readoutSoil').textContent = `${soil}%`;
  document.getElementById('fillMoisture').style.width = `${soil}%`;
  const soilBadge = document.getElementById('badgeSoil');
  if (soil > 60) {
    soilBadge.textContent = 'Liquefaction Risk';
    soilBadge.className = 'soil-badge critical';
  } else if (soil > 40) {
    soilBadge.textContent = 'Elevated';
    soilBadge.className = 'soil-badge elevated';
  } else {
    soilBadge.textContent = 'Stable';
    soilBadge.className = 'soil-badge';
  }

  // 6. Kinematics Strip
  document.getElementById('kinAx').textContent = `${Number(item.accelX ?? 0.02) >= 0 ? '+' : ''}${Number(item.accelX ?? 0.02).toFixed(2)}g`;
  document.getElementById('kinAy').textContent = `${Number(item.accelY ?? -0.01) >= 0 ? '+' : ''}${Number(item.accelY ?? -0.01).toFixed(2)}g`;
  document.getElementById('kinAz').textContent = `${Number(item.accelZ ?? 0.98) >= 0 ? '+' : ''}${Number(item.accelZ ?? 0.98).toFixed(2)}g`;

  document.getElementById('kinGx').textContent = `${Number(item.gyroX ?? 0.5) >= 0 ? '+' : ''}${Number(item.gyroX ?? 0.5).toFixed(1)}°/s`;
  document.getElementById('kinGy').textContent = `${Number(item.gyroY ?? -0.2) >= 0 ? '+' : ''}${Number(item.gyroY ?? -0.2).toFixed(1)}°/s`;
  document.getElementById('kinGz').textContent = `${Number(item.gyroZ ?? 0.1) >= 0 ? '+' : ''}${Number(item.gyroZ ?? 0.1).toFixed(1)}°/s`;

  // 7. Update Oscilloscope Chart
  updateOscilloscopeChart(history);

  // 8. Update Packet Stream Log
  prependPacketLog(item);
}

function updateOscilloscopeChart(history) {
  if (!oscilloscopeChart) return;
  const chronological = [...history].reverse();
  const labels = chronological.map(r => {
    const d = new Date(r.receivedAt);
    return `${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  });

  const tensionData = chronological.map(r => Number(r.tension ?? r.displacement ?? 0));
  const tiltData = chronological.map(r => Number(r.tiltX ?? 0));

  oscilloscopeChart.data.labels = labels;
  oscilloscopeChart.data.datasets[0].data = tensionData;
  oscilloscopeChart.data.datasets[1].data = tiltData;
  oscilloscopeChart.update('none');
}

function prependPacketLog(item) {
  const container = document.getElementById('packetLogContainer');
  if (!container) return;

  const hexId = (++lastPacketHex).toString(16).toUpperCase();
  const time = new Date(item.receivedAt || Date.now()).toLocaleTimeString();
  const tension = Number(item.tension ?? item.displacement ?? 0).toFixed(1);
  const pitch = Number(item.tiltX ?? 0).toFixed(1);
  const roll = Number(item.tiltY ?? 0).toFixed(1);
  const status = item.alertStatus || 'NORMAL';

  let statusHtml = '<span class="status-ok">OK</span>';
  if (status === 'CRITICAL') statusHtml = '<span class="status-crit">CRITICAL</span>';
  else if (status === 'MODERATE') statusHtml = '<span class="status-warn">WARNING</span>';

  const row = document.createElement('div');
  row.className = 'packet-log-row';
  row.innerHTML = `
    <div class="packet-log-text">
      [${time}] PACKET_ID: <strong>${hexId}</strong> - DATA: Tension: <strong>${tension}N</strong>, Pitch: ${pitch}°, Roll: ${roll}° - STATUS: ${statusHtml}
    </div>
    <button class="btn-packet-ack" onclick="this.textContent='ACKNOWLEDGED'; this.style.color='var(--tactical-green)';">Acknowledge</button>
  `;

  container.insertBefore(row, container.firstChild);
  while (container.children.length > 8) {
    container.removeChild(container.lastChild);
  }
}

// =========================================================================
// FETCH NODES VIEW
// =========================================================================
async function fetchNodes() {
  try {
    const res = await fetch('/api/nodes');
    if (!res.ok) return;
    const data = await res.json();
    registeredNodes = data.nodes || [];

    const container = document.getElementById('nodePlacementList');
    if (!container) return;
    container.innerHTML = '';

    registeredNodes.forEach(node => {
      const card = document.createElement('div');
      card.className = 'node-item-card';

      let statusColor = 'var(--tactical-green)';
      if (node.status === 'CRITICAL') statusColor = 'var(--hazard-red)';
      else if (node.status === 'MODERATE') statusColor = 'var(--earth-amber)';

      const readingText = node.latestReading 
        ? `Tension: ${Number(node.latestReading.tension || 0).toFixed(1)}N • Tilt: ${Number(node.latestReading.tiltX || 0).toFixed(1)}°`
        : 'Standby Telemetry Link';

      card.innerHTML = `
        <div class="node-main-info">
          <h4><span style="color: ${statusColor};">●</span> ${node.nodeId} — ${node.name}</h4>
          <p>${node.location} • Depth: ${node.depth}</p>
          <p style="color: var(--text-black); font-weight: 600; margin-top: 4px;">${readingText}</p>
        </div>
        <div class="node-metrics-pills">
          <span class="pill-metric" style="color: ${statusColor};">${node.status}</span>
          <span class="pill-metric">🔋 ${node.battery}%</span>
          <span class="pill-metric">📶 ${node.signalDbm} dBm</span>
        </div>
      `;
      container.appendChild(card);
    });

  } catch (err) {
    console.error('Nodes fetch error', err);
  }
}

function getCleanLoadValue(row) {
  if (!row) return 0;
  let val = row.tension;
  if (val != null && !/^[01]{6,}$/.test(String(val))) {
    return Number(val);
  }
  val = row.loadDifference ?? row.displacement ?? 0;
  const str = String(val).trim();
  if (/^[01]{6,}$/.test(str)) {
    const parsed = parseInt(str, 2);
    if (!isNaN(parsed)) return parsed;
  }
  return Number(val) || 0;
}

// =========================================================================
// FETCH ANALYTICS (ENTIRE MONGODB DATABASE)
// =========================================================================
async function fetchAnalyticsData() {
  try {
    const res = await fetch('/api/readings?limit=250');
    if (!res.ok) return;
    const json = await res.json();
    allDatabaseReadings = json.readings || [];

    // Calculate aggregated KPIs
    const total = allDatabaseReadings.length;
    let peakTension = 0;
    let hazardCount = 0;
    let totalSoil = 0;

    allDatabaseReadings.forEach(r => {
      const t = getCleanLoadValue(r);
      if (t < 50000 && t > peakTension) peakTension = t;
      if (t > 150 || r.alertStatus === 'CRITICAL') hazardCount++;
      totalSoil += Number(r.soilMoisture || 15);
    });

    const avgSoil = total > 0 ? (totalSoil / total).toFixed(0) : 15;

    document.getElementById('kpiTotalReadings').textContent = total;
    document.getElementById('kpiPeakTension').textContent = `${peakTension.toFixed(1)}N`;
    document.getElementById('kpiHazardCount').textContent = hazardCount;
    document.getElementById('kpiAvgSoil').textContent = `${avgSoil}%`;

    renderAnalyticsTable(allDatabaseReadings);
  } catch (err) {
    console.error('Analytics fetch error', err);
  }
}

function renderAnalyticsTable(readings) {
  const tbody = document.getElementById('analyticsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  readings.forEach(row => {
    const tr = document.createElement('tr');
    const loadNum = getCleanLoadValue(row);
    const loadDisplay = loadNum.toFixed(1);
    
    // Status respects hardware levels from ESP32 first
    let status = row.alertStatus;
    if (!status || status === 'CRITICAL') {
      if (row.loadLevel != null || row.movementLevel != null || row.vibrationLevel != null) {
        const maxLevel = Math.max(Number(row.loadLevel || 0), Number(row.movementLevel || 0), Number(row.vibrationLevel || 0));
        status = maxLevel === 2 ? 'CRITICAL' : (maxLevel === 1 ? 'MODERATE' : 'NORMAL');
      } else {
        status = row.alertStatus || 'NORMAL';
      }
    }

    const time = new Date(row.receivedAt).toLocaleTimeString();
    const date = new Date(row.receivedAt).toLocaleDateString();
    
    // Raw ADC & Zero Offset
    const rawAdc = row.rawADC != null ? `${row.rawADC}` : '--';
    const zeroAdc = row.zeroOffset != null ? ` (0:${row.zeroOffset})` : '';
    const adcDisplay = `${rawAdc}${zeroAdc}`;

    // Tilt (Pitch / Roll)
    const pitch = Number(row.tiltX || 0).toFixed(1);
    const roll = Number(row.tiltY || 0).toFixed(1);

    // Accel 3-Axis
    const ax = Number(row.accelX || 0).toFixed(2);
    const ay = Number(row.accelY || 0).toFixed(2);
    const az = Number(row.accelZ || 0.98).toFixed(2);
    const accelDisplay = `${ax}, ${ay}, ${az}`;

    // Vibration
    let vibDisplay = 'NORMAL';
    if (row.vibrationCount != null && row.vibrationCount > 0) {
      vibDisplay = `🚨 ${row.vibrationCount} Pulses`;
    } else if (row.vibration) {
      vibDisplay = '🚨 DETECTED';
    }

    // Temperature & RSSI
    const tempDisplay = row.temperatureC != null ? `${Number(row.temperatureC).toFixed(1)}°C` : '--';
    const rssiDisplay = row.wifiRSSI != null ? `${row.wifiRSSI} dBm` : '--';

    let statusStyle = 'color: var(--tactical-green); font-weight: 700;';
    if (status === 'CRITICAL') statusStyle = 'color: var(--hazard-red); font-weight: 800;';
    else if (status === 'MODERATE') statusStyle = 'color: var(--earth-amber); font-weight: 700;';

    tr.innerHTML = `
      <td style="color: var(--text-muted); white-space: nowrap;">${date} ${time}</td>
      <td><strong>${row.nodeId || 'NodeB'}</strong></td>
      <td><strong>${loadDisplay} N</strong></td>
      <td style="font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; color: #475569;">${adcDisplay}</td>
      <td>${pitch}° / ${roll}°</td>
      <td style="font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; color: #64748b;">${accelDisplay}</td>
      <td style="font-weight: 600;">${vibDisplay}</td>
      <td style="font-weight: 600; color: #0284c7;">${tempDisplay}</td>
      <td style="font-size: 0.72rem; color: #64748b;">${rssiDisplay}</td>
      <td style="${statusStyle}">${status}</td>
    `;
    tbody.appendChild(tr);
  });
}

function filterAnalyticsTable() {
  const query = document.getElementById('analyticsSearch').value.toLowerCase();
  const filtered = allDatabaseReadings.filter(r => {
    return (
      (r.nodeId && r.nodeId.toLowerCase().includes(query)) ||
      (r.alertStatus && r.alertStatus.toLowerCase().includes(query)) ||
      (r.loadDifference != null && String(r.loadDifference).includes(query)) ||
      (r.tension != null && String(r.tension).includes(query)) ||
      (r.rawADC != null && String(r.rawADC).includes(query))
    );
  });
  renderAnalyticsTable(filtered);
}

// =========================================================================
// FETCH ALERTS VIEW (INCIDENT FEED)
// =========================================================================
async function fetchAlerts() {
  try {
    const res = await fetch('/api/alerts');
    if (!res.ok) return;
    const data = await res.json();
    allAlerts = data.alerts || [];

    const container = document.getElementById('alertsListContainer');
    if (!container) return;
    container.innerHTML = '';

    if (allAlerts.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 0.82rem;">
          ✅ No active hazard alerts in the database. All nodes nominal.
        </div>
      `;
      return;
    }

    allAlerts.forEach(alert => {
      const item = document.createElement('div');
      const tension = Number(alert.tension || 0).toFixed(1);
      const isCritical = alert.alertStatus === 'CRITICAL' || tension > 150;
      const time = new Date(alert.receivedAt).toLocaleString();

      item.className = `alert-incident-item ${isCritical ? 'critical' : 'moderate'}`;
      
      const title = isCritical 
        ? `🚨 CRITICAL HAZARD: High Tension (${tension} N) Exceeded 150 N Limit`
        : `⚠️ WARNING: Tension (${tension} N) In Warning Range (75–150 N)`;

      item.innerHTML = `
        <div>
          <div class="incident-title">${title}</div>
          <div class="incident-desc">
            Node: <strong>${alert.nodeId || 'NODE_C'}</strong> • Time: ${time} • Vibration: ${alert.vibration ? 'DETECTED' : 'NORMAL'}
          </div>
        </div>
        <div>
          <button class="btn-ctrl" onclick="this.textContent='RESOLVED'; this.style.color='var(--tactical-green)';">ACK</button>
        </div>
      `;
      container.appendChild(item);
    });

  } catch (err) {
    console.error('Alerts fetch error', err);
  }
}

let servoAutoRetractTimer = null;

// Servo Motor Command Dispatcher
async function sendServoCommand(angle, isAutoPulse = false) {
  const parsed = Math.min(180, Math.max(0, parseInt(angle) || 0));
  const badge = document.getElementById('servoStatusBadge');
  const slider = document.getElementById('servoSlider');
  const sliderVal = document.getElementById('sliderAngleVal');
  const autoRetractCheck = document.getElementById('chkAutoRetract');

  if (slider) slider.value = parsed;
  if (sliderVal) sliderVal.textContent = parsed + '°';

  // Clear any existing timer
  if (servoAutoRetractTimer) {
    clearTimeout(servoAutoRetractTimer);
    servoAutoRetractTimer = null;
  }

  if (badge) {
    badge.textContent = `SENDING (${parsed}°)...`;
    badge.style.color = '#0284c7';
  }

  try {
    const res = await fetch('/api/command/servo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: activeNodeFilter || 'NodeB',
        angle: parsed
      })
    });
    const data = await res.json();
    if (badge) {
      badge.textContent = parsed === 0 ? 'STANDBY (0°)' : (parsed === 90 ? 'BARRIER LOCKED (90°)' : `DEPLOYED (${parsed}°)`);
      badge.style.color = parsed >= 90 ? 'var(--hazard-red)' : (parsed > 0 ? 'var(--earth-amber)' : 'var(--tactical-green)');
    }

    // Auto-retract back to 0° after 4 seconds if enabled or triggered
    if (parsed > 0 && (autoRetractCheck?.checked || isAutoPulse)) {
      if (badge) badge.textContent += ' ⏱️ (Auto-reset in 4s)';
      servoAutoRetractTimer = setTimeout(() => {
        sendServoCommand(0, false);
      }, 4000);
    }
  } catch (err) {
    console.error('Servo command error', err);
    if (badge) badge.textContent = 'ERROR';
  }
}

async function pulseServoAction(angle = 90) {
  await sendServoCommand(angle, true);
}

// User Actions
function toggleSiren() {
  initAudio();
  sirenAcknowledged = !sirenAcknowledged;
  const btn = document.getElementById('btnSirenAck');
  if (sirenAcknowledged) {
    btn.className = 'btn-ack active';
    btn.textContent = 'MUTED';
  } else {
    btn.className = 'btn-ack';
    btn.textContent = 'ACK';
  }
}

function resetOscilloscopeZoom() {
  if (oscilloscopeChart) oscilloscopeChart.resetZoom?.();
}

async function quickSim(scenario) {
  try {
    await fetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario })
    });
    fetchTelemetry();
    if (currentActiveTab === 'analytics') fetchAnalyticsData();
    if (currentActiveTab === 'alerts') fetchAlerts();
  } catch (e) {
    console.error(e);
  }
}

async function simulateNextEvent() {
  await quickSim('random');
}

function exportDataLog() {
  window.location.href = '/api/readings?limit=500';
}

// Boot loop
document.addEventListener('DOMContentLoaded', () => {
  initOscilloscope();
  drawVectorGrid(2.4, -1.1);
  drawSeismicWaveform(false);
  
  fetchTelemetry();
  setInterval(fetchTelemetry, 1500);

  function animLoop() {
    if (currentActiveTab === 'dashboard') {
      drawSeismicWaveform(sirenActive);
    }
    requestAnimationFrame(animLoop);
  }
  requestAnimationFrame(animLoop);

  window.addEventListener('resize', () => {
    if (currentActiveTab === 'dashboard') {
      drawVectorGrid();
      if (historicalReadings.length > 0) {
        drawTensionSparkline(historicalReadings.map(r => Number(r.tension || 0)));
      }
    } else if (currentActiveTab === 'nodes') {
      drawSpatialMineSimulation();
    }
  });

  document.body.addEventListener('click', () => {
    initAudio();
  }, { once: true });
});
