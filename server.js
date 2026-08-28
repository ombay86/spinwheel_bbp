const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();
const XLSX = require('xlsx');
const QRCode = require('qrcode');

const app = express();
let PORT = process.env.PORT || 3000;
const IS_VERCEL = !!process.env.VERCEL;

// On Vercel, use /tmp for writable SQLite DB
const DB_PATH = IS_VERCEL ? path.join('/tmp', 'database.db') : path.join(__dirname, 'database.db');
const EXCEL_PATH = path.join(__dirname, 'Resources', 'Perangsos Podcast Samarinda.xlsx');

// If on Vercel and /tmp/database.db doesn't exist, copy local database.db if available
if (IS_VERCEL && !fs.existsSync(DB_PATH)) {
  const localDb = path.join(__dirname, 'database.db');
  if (fs.existsSync(localDb)) {
    try {
      fs.copyFileSync(localDb, DB_PATH);
    } catch (e) {}
  }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'images')));

// Initialize SQLite Database
const db = new sqlite3.Database(DB_PATH);

// Initialize DB Tables & Seed Data
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS prizes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      initial_stock INTEGER NOT NULL,
      current_stock INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS winners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prize_id INTEGER,
      prize_name TEXT NOT NULL,
      visitor_name TEXT,
      visitor_phone TEXT,
      booth_name TEXT,
      operator_name TEXT,
      won_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      booth_name TEXT
    )
  `);

  // Seed default 5 operators & 1 admin user
  const initialUsers = [
    { username: 'operator1', password: 'operator1', role: 'operator', booth_name: 'Operasi Tangkap Tawa' },
    { username: 'operator2', password: 'operator2', role: 'operator', booth_name: 'Benar Benar Podcast Live' },
    { username: 'operator3', password: 'operator3', role: 'operator', booth_name: 'Game Arena Aksi' },
    { username: 'operator4', password: 'operator4', role: 'operator', booth_name: 'Game Integritas' },
    { username: 'operator5', password: 'operator5', role: 'operator', booth_name: 'Game Tembak Koruptor' },
    { username: 'admin', password: 'admin123', role: 'admin', booth_name: 'Admin Center' }
  ];

  const userStmt = db.prepare("INSERT OR IGNORE INTO users (username, password, role, booth_name) VALUES (?, ?, ?, ?)");
  initialUsers.forEach(u => {
    userStmt.run(u.username, u.password, u.role, u.booth_name);
  });
  userStmt.finalize();

  // Check if prizes table is empty, if so, seed from Excel
  db.get("SELECT COUNT(*) as count FROM prizes", (err, row) => {
    if (err) {
      console.error("Error checking prizes count:", err);
      return;
    }
    if (!row || row.count === 0) {
      console.log("Seeding prize data from Excel...");
      seedPrizesFromExcel();
    } else {
      console.log(`Database loaded with ${row.count} prizes.`);
    }
  });
});

// Function to parse Excel and seed prizes
function seedPrizesFromExcel(override = false) {
  try {
    if (!fs.existsSync(EXCEL_PATH)) {
      console.error("Excel file not found at:", EXCEL_PATH);
      return false;
    }

    const workbook = XLSX.readFile(EXCEL_PATH);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const range = XLSX.utils.decode_range(sheet['!ref']);
    let headers = [];
    let spinRowIndex = -1;

    for (let R = range.s.r; R <= range.e.r; ++R) {
      const cellA = sheet[XLSX.utils.encode_cell({ r: R, c: 0 })];
      const valA = cellA ? String(cellA.v).trim() : '';

      if (R === 4) { // Row 5 (0-indexed 4)
        for (let C = 1; C <= range.e.c; ++C) {
          const cell = sheet[XLSX.utils.encode_cell({ r: R, c: C })];
          headers[C] = cell ? String(cell.v).trim().replace(/\n/g, ' ') : '';
        }
      }

      if (valA.includes('Games (eceran dengan spinwheel)')) {
        spinRowIndex = R;
      }
    }

    if (spinRowIndex === -1) {
      console.error("Row 'Games (eceran dengan spinwheel)' not found in Excel!");
      return false;
    }

    const prizeData = [];
    for (let C = 1; C <= range.e.c; ++C) {
      const headerName = headers[C];
      const cell = sheet[XLSX.utils.encode_cell({ r: spinRowIndex, c: C })];
      const qty = cell && cell.v !== null ? parseInt(cell.v, 10) : 0;

      if (headerName && !isNaN(qty) && qty > 0) {
        prizeData.push({ name: headerName, stock: qty });
      }
    }

    console.log(`Found ${prizeData.length} prize items in Excel.`);

    db.serialize(() => {
      if (override) {
        db.run("DELETE FROM prizes");
      }
      const stmt = db.prepare("INSERT OR REPLACE INTO prizes (name, initial_stock, current_stock) VALUES (?, ?, ?)");
      prizeData.forEach(item => {
        stmt.run(item.name, item.stock, item.stock);
      });
      stmt.finalize();
    });

    return true;
  } catch (error) {
    console.error("Failed to seed prizes from Excel:", error);
    return false;
  }
}

// Helper: Get local network IPv4 address
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// --- REST API ENDPOINTS ---

// 0. User Login (Username & Password)
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const uname = username ? username.trim().toLowerCase() : '';
  const pass = password ? password.trim() : '';

  if (!uname || !pass) {
    return res.status(400).json({ error: "Username dan password wajib diisi!" });
  }

  db.get("SELECT * FROM users WHERE LOWER(username) = ?", [uname], (err, user) => {
    if (err) {
      return res.status(500).json({ error: "Kesalahan database" });
    }

    if (user) {
      if (user.password === pass || (user.role === 'operator' && (pass === 'operator123' || pass === uname))) {
        return res.json({
          success: true,
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
            booth_name: user.booth_name || 'Booth 1'
          }
        });
      }
    } else {
      if (uname === 'admin' && (pass === 'admin123' || pass === 'admin')) {
        return res.json({
          success: true,
          user: { id: 0, username: 'admin', role: 'admin', booth_name: 'Admin Center' }
        });
      }

      if (uname.startsWith('operator') && (pass === uname || pass === 'operator123' || pass === 'operator')) {
        const boothMap = {
          'operator1': 'Operasi Tangkap Tawa',
          'operator2': 'Benar Benar Podcast Live',
          'operator3': 'Game Arena Aksi',
          'operator4': 'Game Integritas',
          'operator5': 'Game Tembak Koruptor'
        };
        const booth = boothMap[uname] || 'Operasi Tangkap Tawa';
        return res.json({
          success: true,
          user: { id: 0, username: uname, role: 'operator', booth_name: booth }
        });
      }
    }

    return res.status(401).json({ error: "Username atau password salah!" });
  });
});

// Get User Accounts
app.get('/api/users', (req, res) => {
  db.all("SELECT id, username, role, booth_name FROM users ORDER BY id ASC", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ users: rows });
  });
});

// Update User Password
app.post('/api/users/update-password', (req, res) => {
  const { username, new_password } = req.body || {};
  if (!username || !new_password) {
    return res.status(400).json({ error: "Data tidak lengkap" });
  }

  db.run("UPDATE users SET password = ? WHERE LOWER(username) = ?", [new_password.trim(), username.trim().toLowerCase()], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, message: `Password ${username} berhasil diperbarui!` });
  });
});

// 1. Get all prizes
app.get('/api/prizes', (req, res) => {
  db.all("SELECT * FROM prizes ORDER BY id ASC", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ prizes: rows });
  });
});

// 2. Execute Spin & Record Winner (Atomic)
app.post('/api/spin', (req, res) => {
  const { visitor_name, visitor_phone, booth_name, operator_name } = req.body;

  db.all("SELECT * FROM prizes WHERE current_stock > 0", [], (err, activePrizes) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!activePrizes || activePrizes.length === 0) {
      return res.status(400).json({ error: "Stok semua hadiah telah habis!" });
    }

    const totalStock = activePrizes.reduce((sum, p) => sum + p.current_stock, 0);
    let randomNum = Math.floor(Math.random() * totalStock);
    let selectedPrize = activePrizes[0];

    for (const prize of activePrizes) {
      if (randomNum < prize.current_stock) {
        selectedPrize = prize;
        break;
      }
      randomNum -= prize.current_stock;
    }

    db.run(
      "UPDATE prizes SET current_stock = current_stock - 1 WHERE id = ? AND current_stock > 0",
      [selectedPrize.id],
      function (updateErr) {
        if (updateErr) {
          return res.status(500).json({ error: updateErr.message });
        }

        if (this.changes === 0) {
          return res.status(409).json({ error: "Stok terupdate, silakan coba lagi." });
        }

        const newStock = selectedPrize.current_stock - 1;

        const vName = visitor_name ? visitor_name.trim() : 'Pengunjung';
        const vPhone = visitor_phone ? visitor_phone.trim() : '-';
        const bName = booth_name ? booth_name.trim() : 'Booth 1';
        const opName = operator_name ? operator_name.trim() : 'Operator';

        db.run(
          `INSERT INTO winners (prize_id, prize_name, visitor_name, visitor_phone, booth_name, operator_name)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [selectedPrize.id, selectedPrize.name, vName, vPhone, bName, opName],
          function (insertErr) {
            if (insertErr) {
              console.error("Error logging winner:", insertErr);
            }

            res.json({
              success: true,
              prize: {
                id: selectedPrize.id,
                name: selectedPrize.name,
                remaining_stock: newStock
              },
              winner: {
                id: this ? this.lastID : null,
                visitor_name: vName,
                booth_name: bName,
                won_at: new Date().toISOString()
              }
            });
          }
        );
      }
    );
  });
});

// 3. Get Winner History
app.get('/api/history', (req, res) => {
  db.all("SELECT * FROM winners ORDER BY won_at DESC LIMIT 500", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ winners: rows });
  });
});

// 4. Reset Stock to Initial Values
app.post('/api/prizes/reset', (req, res) => {
  const { clear_history } = req.body || {};

  db.serialize(() => {
    db.run("UPDATE prizes SET current_stock = initial_stock");
    if (clear_history) {
      db.run("DELETE FROM winners");
    }
  });

  res.json({ success: true, message: "Stok hadiah berhasil di-reset ke data awal!" });
});

// 5. Re-import from Excel
app.post('/api/prizes/reimport', (req, res) => {
  const success = seedPrizesFromExcel(true);
  if (success) {
    res.json({ success: true, message: "Data hadiah berhasil di-import ulang dari Excel!" });
  } else {
    res.status(500).json({ error: "Gagal membaca file Excel!" });
  }
});

// 6. Update Prize Stock manually
app.post('/api/prizes/update', (req, res) => {
  const { id, current_stock } = req.body;
  if (id === undefined || current_stock === undefined) {
    return res.status(400).json({ error: "ID dan current_stock wajib diisi" });
  }

  db.run("UPDATE prizes SET current_stock = ? WHERE id = ?", [current_stock, id], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, message: "Stok hadiah diperbarui" });
  });
});

// 7. Export Winner History to Excel
app.get('/api/export', (req, res) => {
  db.all("SELECT * FROM winners ORDER BY won_at ASC", [], (err, rows) => {
    if (err) {
      return res.status(500).send("Error exporting data");
    }

    const exportData = rows.map((r, idx) => ({
      "No": idx + 1,
      "Waktu": r.won_at,
      "Nama Pengunjung": r.visitor_name,
      "No HP": r.visitor_phone,
      "Nama Booth": r.booth_name,
      "Operator": r.operator_name,
      "Hadiah Diperoleh": r.prize_name
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Riwayat Pemenang Spinwheel");

    const buf = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Riwayat_Pemenang_Spinwheel_${Date.now()}.xlsx`);
    res.send(buf);
  });
});

// 8. Server & QR Code Info
app.get('/api/server-info', async (req, res) => {
  const ip = getLocalIpAddress();
  const url = `http://${ip}:${PORT}`;
  try {
    const qrCode = await QRCode.toDataURL(url);
    res.json({ ip, port: PORT, url, qrCode });
  } catch (err) {
    res.json({ ip, port: PORT, url, qrCode: null });
  }
});

// Export app for Vercel
module.exports = app;

// Start Server locally if not on Vercel
if (!IS_VERCEL) {
  function startServer(portToTry) {
    const server = app.listen(portToTry, '0.0.0.0', () => {
      PORT = portToTry;
      const localIp = getLocalIpAddress();
      console.log(`====================================================`);
      console.log(`🚀 BBP SPINWHEEL SERVER RUNNING`);
      console.log(`💻 Local Access:   http://localhost:${PORT}`);
      console.log(`📱 Smartphone WiFi Access: http://${localIp}:${PORT}`);
      console.log(`====================================================`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`⚠️ Port ${portToTry} sedang digunakan. Mencoba port ${portToTry + 1}...`);
        startServer(portToTry + 1);
      } else {
        console.error("Server error:", err);
      }
    });
  }

  startServer(PORT);
}
