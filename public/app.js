// Spinwheel Application Frontend Logic

let prizes = [];
let activePrizes = []; // Prizes with stock > 0
let winnerHistory = [];
let isSpinning = false;

// Authentication State
let currentUser = null;

// Wheel physics & rotation state
let currentAngle = 0;
let targetAngle = 0;
let spinVelocity = 0;

// Slices Colors Palette (19 vibrant distinct colors)
const sliceColors = [
  '#f59e0b', '#ec4899', '#3b82f6', '#10b981', '#8b5cf6',
  '#ef4444', '#06b6d4', '#84cc16', '#f97316', '#a855f7',
  '#14b8a6', '#6366f1', '#eab308', '#d946ef', '#0284c7',
  '#059669', '#7c3aed', '#dc2626', '#65a30d'
];

// Initialize application on load
window.addEventListener('DOMContentLoaded', () => {
  checkUserSession();
  autoFillPasswordSuggestion();
  initWheelCanvas();
  loadPrizesAndHistory();
  loadServerInfo();

  setInterval(loadPrizesAndHistory, 5000);
});

// Check Session in SessionStorage
function checkUserSession() {
  const savedSession = sessionStorage.getItem('user_session');
  if (savedSession) {
    try {
      currentUser = JSON.parse(savedSession);
      showAppView();
      return;
    } catch (e) {}
  }

  // Not logged in -> Show Landing Login View
  showLoginView();
}

function autoFillPasswordSuggestion() {
  const select = document.getElementById('login-username-select');
  const passInput = document.getElementById('login-password');
  if (!select || !passInput) return;

  const uname = select.value;
  if (uname === 'admin') {
    passInput.value = 'admin123';
  } else {
    passInput.value = uname; // operator1, operator2, etc.
  }
}

// Handle Fullscreen Main Login
async function handleMainLogin(event) {
  event.preventDefault();
  const select = document.getElementById('login-username-select');
  const passInput = document.getElementById('login-password');
  const errEl = document.getElementById('main-login-error');

  const username = select.value;
  const password = passInput.value;

  errEl.classList.add('hidden');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      currentUser = data.user;
      sessionStorage.setItem('user_session', JSON.stringify(currentUser));
      showAppView();
    } else {
      errEl.textContent = data.error || "Username atau password salah!";
      errEl.classList.remove('hidden');
    }
  } catch (err) {
    errEl.textContent = "Gagal terhubung ke server.";
    errEl.classList.remove('hidden');
  }
}

function showLoginView() {
  document.getElementById('view-login').classList.remove('hidden');
  document.getElementById('view-app').classList.add('hidden');
}

function showAppView() {
  document.getElementById('view-login').classList.add('hidden');
  document.getElementById('view-app').classList.remove('hidden');

  // Update Header & User Badge
  const userBadge = document.getElementById('user-badge');
  const opInput = document.getElementById('operator-name-input');
  const boothSelect = document.getElementById('booth-select');
  const navAdminBtn = document.getElementById('nav-admin');

  if (currentUser) {
    userBadge.textContent = `👤 ${currentUser.username} (${currentUser.booth_name || 'Booth 1'})`;
    userBadge.classList.remove('hidden');

    if (opInput) opInput.value = currentUser.username;

    // Set Booth Select according to account
    if (boothSelect && currentUser.booth_name) {
      boothSelect.value = currentUser.booth_name;
    }

    if (currentUser.role === 'admin') {
      switchTab('admin');
    } else {
      switchTab('operator');
      // Hide Admin Tab for operators
      if (navAdminBtn) navAdminBtn.style.display = 'none';
    }
  }

  resizeCanvasToFit();
}

function logout() {
  sessionStorage.removeItem('user_session');
  currentUser = null;
  showLoginView();
}

// Switch Navigation Tabs
function switchTab(tabName) {
  const opTab = document.getElementById('tab-operator');
  const adminTab = document.getElementById('tab-admin');
  const navOp = document.getElementById('nav-operator');
  const navAdmin = document.getElementById('nav-admin');

  if (tabName === 'operator') {
    opTab.classList.remove('hidden');
    adminTab.classList.add('hidden');
    navOp.className = "px-2.5 py-1 rounded-lg text-xs font-bold transition bg-amber-500 text-slate-950 shadow";
    navAdmin.className = "px-2.5 py-1 rounded-lg text-xs font-bold transition text-slate-400 hover:text-white hover:bg-slate-800";
    resizeCanvasToFit();
  } else {
    // If not admin role, block access
    if (currentUser && currentUser.role !== 'admin') {
      alert("Akses Admin hanya untuk akun Admin!");
      return;
    }
    opTab.classList.add('hidden');
    adminTab.classList.remove('hidden');
    navOp.className = "px-2.5 py-1 rounded-lg text-xs font-bold transition text-slate-400 hover:text-white hover:bg-slate-800";
    navAdmin.className = "px-2.5 py-1 rounded-lg text-xs font-bold transition bg-amber-500 text-slate-950 shadow";
    renderAdminStockGrid();
    renderHistoryTable();
  }
}

// Handle Booth Selector
function onBoothChange() {
  const select = document.getElementById('booth-select');
  const customInput = document.getElementById('custom-booth-input');
  if (select.value === 'Custom') {
    customInput.classList.remove('hidden');
  } else {
    customInput.classList.add('hidden');
  }
}

function getSelectedBooth() {
  const select = document.getElementById('booth-select');
  if (select.value === 'Custom') {
    const customVal = document.getElementById('custom-booth-input').value.trim();
    return customVal || 'Booth Custom';
  }
  return select.value;
}

// Fetch Prizes & Winner History from API
async function loadPrizesAndHistory() {
  try {
    const prizesRes = await fetch('/api/prizes');
    const prizesData = await prizesRes.json();
    prizes = prizesData.prizes || [];
    activePrizes = prizes.filter(p => p.current_stock > 0);

    const historyRes = await fetch('/api/history');
    const historyData = await historyRes.json();
    winnerHistory = historyData.winners || [];

    updateStockBadge();
    drawWheel();
    renderAdminStockGrid();
    renderHistoryTable();
    renderDrawerStockList();
  } catch (err) {
    console.error("Error fetching data:", err);
  }
}

// Update Top Badge Stock Count
function updateStockBadge() {
  const totalRemaining = prizes.reduce((sum, p) => sum + p.current_stock, 0);
  const totalInitial = prizes.reduce((sum, p) => sum + p.initial_stock, 0);
  const badgeEl = document.getElementById('total-stock-badge');
  if (badgeEl) {
    badgeEl.textContent = `${totalRemaining}/${totalInitial}`;
  }
}

// Canvas Spinwheel Rendering Engine
const canvas = document.getElementById('wheelCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;

function initWheelCanvas() {
  if (!canvas) return;
  resizeCanvasToFit();
  window.addEventListener('resize', resizeCanvasToFit);
}

function resizeCanvasToFit() {
  if (!canvas) return;
  const parent = canvas.parentElement;
  if (!parent) return;
  const rect = parent.getBoundingClientRect();
  const size = Math.max(Math.min(rect.width, rect.height, 420), 240);
  canvas.width = Math.round(size);
  canvas.height = Math.round(size);
  drawWheel();
}

function drawWheel() {
  if (!ctx || !canvas) return;

  const width = canvas.width;
  const height = canvas.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = width / 2 - 12;

  ctx.clearRect(0, 0, width, height);

  const displayPrizes = activePrizes.length > 0 ? activePrizes : [{ name: 'Stok Habis!', current_stock: 0 }];
  const numSlices = displayPrizes.length;
  const sliceAngle = (2 * Math.PI) / numSlices;

  const fontSize = Math.max(Math.floor(radius / 16), 9);

  for (let i = 0; i < numSlices; i++) {
    const startRad = currentAngle + i * sliceAngle;
    const endRad = startRad + sliceAngle;
    const color = sliceColors[i % sliceColors.length];

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startRad, endRad);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(startRad + sliceAngle / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${fontSize}px "Plus Jakarta Sans", sans-serif`;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 3;

    const label = displayPrizes[i].name;
    const words = label.split(' ');
    let line1 = '', line2 = '';
    if (words.length > 2 && label.length > 14) {
      const mid = Math.ceil(words.length / 2);
      line1 = words.slice(0, mid).join(' ');
      line2 = words.slice(mid).join(' ');
    } else {
      line1 = label;
    }

    if (line2) {
      ctx.fillText(line1, radius - 18, -4);
      ctx.font = `${fontSize - 1}px "Plus Jakarta Sans", sans-serif`;
      ctx.fillText(line2, radius - 18, fontSize);
    } else {
      ctx.fillText(line1, radius - 18, fontSize / 3);
    }

    ctx.restore();
  }

  // Draw Outer Ring
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#f59e0b';
  ctx.stroke();

  // Draw Center Hub
  const hubRadius = Math.max(radius * 0.18, 26);
  ctx.beginPath();
  ctx.arc(centerX, centerY, hubRadius, 0, 2 * Math.PI);
  ctx.fillStyle = '#0f172a';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#f59e0b';
  ctx.stroke();

  ctx.fillStyle = '#f59e0b';
  ctx.font = `black ${Math.max(fontSize, 11)}px "Plus Jakarta Sans", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SPIN', centerX, centerY);
}

// Execute Spin Request & Animation
async function triggerSpin() {
  if (isSpinning) return;
  if (activePrizes.length === 0) {
    alert("Stok semua hadiah telah habis! Harap isi ulang stok di menu Admin.");
    return;
  }

  sounds.init();
  const spinBtn = document.getElementById('spin-btn');
  spinBtn.disabled = true;
  spinBtn.classList.add('opacity-50', 'cursor-not-allowed');
  isSpinning = true;

  const visitor_name = document.getElementById('visitor-name').value;
  const visitor_phone = document.getElementById('visitor-phone').value;
  const booth_name = getSelectedBooth();
  const operator_name = currentUser ? currentUser.username : 'operator1';

  try {
    const res = await fetch('/api/spin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitor_name, visitor_phone, booth_name, operator_name })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      alert(data.error || "Gagal melakukan spin.");
      spinBtn.disabled = false;
      spinBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      isSpinning = false;
      return;
    }

    const wonPrize = data.prize;
    const winnerInfo = data.winner;

    let targetIndex = activePrizes.findIndex(p => p.id === wonPrize.id);
    if (targetIndex === -1) targetIndex = 0;

    animateWheelToPrize(targetIndex, () => {
      sounds.playWin();
      triggerConfetti();

      document.getElementById('win-prize-name').textContent = wonPrize.name;
      document.getElementById('win-visitor-name').textContent = winnerInfo.visitor_name;
      document.getElementById('win-booth-name').textContent = winnerInfo.booth_name;
      document.getElementById('win-prize-stock').textContent = wonPrize.remaining_stock;

      document.getElementById('winner-modal').classList.remove('hidden');

      spinBtn.disabled = false;
      spinBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      isSpinning = false;

      loadPrizesAndHistory();
    });

  } catch (err) {
    console.error("Spin error:", err);
    alert("Terjadi kesalahan jaringan saat mengundi.");
    spinBtn.disabled = false;
    spinBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    isSpinning = false;
  }
}

// Deceleration Animation
function animateWheelToPrize(targetIndex, onComplete) {
  const numSlices = activePrizes.length;
  const sliceAngle = (2 * Math.PI) / numSlices;

  const targetSliceCenter = (targetIndex + 0.5) * sliceAngle;
  let desiredModAngle = (1.5 * Math.PI - targetSliceCenter) % (2 * Math.PI);
  if (desiredModAngle < 0) desiredModAngle += 2 * Math.PI;

  const fullRotations = (5 + Math.floor(Math.random() * 3)) * 2 * Math.PI;
  const totalRotation = fullRotations + (desiredModAngle - (currentAngle % (2 * Math.PI)));

  const startAngle = currentAngle;
  const destinationAngle = startAngle + totalRotation;
  const duration = 4500;
  const startTime = performance.now();

  let lastSliceTick = Math.floor((startAngle + 0.5 * sliceAngle) / sliceAngle);

  function frame(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeOutProgress = 1 - Math.pow(1 - progress, 3);
    currentAngle = startAngle + (destinationAngle - startAngle) * easeOutProgress;

    const currentSliceTick = Math.floor((currentAngle + 0.5 * sliceAngle) / sliceAngle);
    if (currentSliceTick !== lastSliceTick) {
      sounds.playTick();
      lastSliceTick = currentSliceTick;
    }

    drawWheel();

    if (progress < 1) {
      requestAnimationFrame(frame);
    } else {
      currentAngle = destinationAngle % (2 * Math.PI);
      drawWheel();
      onComplete();
    }
  }

  requestAnimationFrame(frame);
}

function triggerConfetti() {
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    });
  }
}

function closeWinnerModal() {
  document.getElementById('winner-modal').classList.add('hidden');
  document.getElementById('visitor-name').value = '';
  document.getElementById('visitor-phone').value = '';
}

function renderAdminStockGrid() {
  const container = document.getElementById('stock-grid');
  if (!container) return;

  container.innerHTML = prizes.map(p => {
    const percent = Math.round((p.current_stock / p.initial_stock) * 100);
    const isOut = p.current_stock === 0;

    return `
      <div class="bg-slate-900 border ${isOut ? 'border-rose-600/50 bg-rose-950/10' : 'border-slate-800'} rounded-xl p-2.5 space-y-1.5 relative shadow">
        <div class="flex justify-between items-start">
          <h4 class="font-bold text-xs text-white leading-tight max-w-[70%]">${p.name}</h4>
          <span class="text-[11px] font-black px-2 py-0.5 rounded ${isOut ? 'bg-rose-600 text-white' : 'bg-amber-500/20 text-amber-300'}">
            ${p.current_stock} / ${p.initial_stock}
          </span>
        </div>

        <div class="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
          <div class="h-1.5 ${isOut ? 'bg-rose-600' : 'bg-gradient-to-r from-amber-500 to-emerald-400'}" style="width: ${percent}%"></div>
        </div>

        <div class="flex items-center justify-between text-[10px] pt-0.5">
          <span class="text-slate-400">Sisa: ${percent}%</span>
          <button onclick="editStockPrompt(${p.id}, '${p.name.replace(/'/g, "\\'")}', ${p.current_stock})" class="text-amber-400 hover:underline font-semibold">
            <i class="fa-solid fa-pen-to-square mr-1"></i> Edit
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function editStockPrompt(id, name, currentStock) {
  const newStockStr = prompt(`Ubah stok sisa untuk: ${name}`, currentStock);
  if (newStockStr === null) return;
  const newStock = parseInt(newStockStr, 10);
  if (isNaN(newStock) || newStock < 0) {
    alert("Jumlah stok tidak valid!");
    return;
  }

  try {
    const res = await fetch('/api/prizes/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, current_stock: newStock })
    });
    if (res.ok) {
      loadPrizesAndHistory();
    }
  } catch (err) {
    alert("Gagal memperbarui stok.");
  }
}

function renderHistoryTable() {
  const tbody = document.getElementById('history-tbody');
  if (!tbody) return;

  if (winnerHistory.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">Belum ada riwayat pengundian.</td></tr>`;
    return;
  }

  tbody.innerHTML = winnerHistory.map((r, idx) => {
    const dateObj = new Date(r.won_at);
    const timeStr = dateObj.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const dateStr = dateObj.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });

    return `
      <tr class="hover:bg-slate-800/50 transition text-[11px]">
        <td class="p-2 font-bold text-slate-500">${idx + 1}</td>
        <td class="p-2 text-slate-300 font-mono text-[10px]">${dateStr} ${timeStr}</td>
        <td class="p-2 font-semibold text-amber-300">${r.booth_name || 'Booth 1'}</td>
        <td class="p-2 text-white font-medium">${r.visitor_name || 'Pengunjung'} <span class="text-slate-500 text-[10px]">(${r.visitor_phone || '-'})</span></td>
        <td class="p-2 text-slate-400">${r.operator_name || '-'}</td>
        <td class="p-2 font-bold text-emerald-400">${r.prize_name}</td>
      </tr>
    `;
  }).join('');
}

function filterHistoryTable() {
  const query = document.getElementById('history-search').value.toLowerCase();
  const rows = document.querySelectorAll('#history-tbody tr');

  rows.forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(query) ? '' : 'none';
  });
}

function renderDrawerStockList() {
  const container = document.getElementById('drawer-stock-list');
  if (!container) return;

  container.innerHTML = prizes.map(p => `
    <div class="flex justify-between items-center bg-slate-800/60 p-1.5 rounded-lg border border-slate-800 text-xs">
      <span class="text-slate-300 font-medium truncate max-w-[170px]">${p.name}</span>
      <span class="font-bold ${p.current_stock > 0 ? 'text-amber-400' : 'text-rose-500'}">${p.current_stock} pcs</span>
    </div>
  `).join('');
}

function toggleStockDrawer() {
  const drawer = document.getElementById('stock-drawer');
  drawer.classList.toggle('hidden');
}

async function resetStockPrompt() {
  if (!confirm("Apakah Anda yakin ingin mengembalikan semua stok ke data awal Excel?")) return;

  const clearHist = confirm("Apakah Anda juga ingin MENGHAPUS SELURUH RIWAYAT pemenang?");
  try {
    const res = await fetch('/api/prizes/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clear_history: clearHist })
    });
    const data = await res.json();
    alert(data.message);
    loadPrizesAndHistory();
  } catch (err) {
    alert("Gagal mereset stok.");
  }
}

function exportToExcel() {
  window.location.href = '/api/export';
}

async function loadServerInfo() {
  try {
    const res = await fetch('/api/server-info');
    const data = await res.json();
    if (data.qrCode) {
      document.getElementById('qr-image').src = data.qrCode;
    }
    document.getElementById('qr-url-text').textContent = data.url;
  } catch (e) {}
}

function openQrModal() {
  loadServerInfo();
  document.getElementById('qr-modal').classList.remove('hidden');
}

function closeQrModal() {
  document.getElementById('qr-modal').classList.add('hidden');
}
