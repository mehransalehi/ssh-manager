const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification } = require("electron");
const path = require("path");
const { initDB, getDB } = require("./db");
const { testServer } = require("./testManager");
const {
  connectSSH,
  disconnectSSH,
  testSocksLatency,
  testConnectedProxySpeed,
  testServerProxyCapability,
  getActiveConnectionIds,
} = require("./sshManager");

let mainWindow;
let tray;
let speedMonitorInterval;
let loadBalanceInterval;
let loadBalanceInProgress = false;

function countryCodeToFlag(code) {
  if (!code || code.length !== 2) return null;
  return code
    .toUpperCase()
    .split("")
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt()))
    .join("");
}

function extractIp(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";

  if (value.startsWith("[")) {
    const endBracket = value.indexOf("]");
    if (endBracket > 1) return value.slice(1, endBracket);
  }

  const colonCount = (value.match(/:/g) || []).length;
  if (colonCount > 1) return value;
  if (value.includes(":")) return value.split(":")[0].trim();
  return value;
}

function getStatusColor(kbps) {
  if (!kbps) return "#ef4444";
  if (kbps >= 500) return "#22c55e";
  if (kbps >= 150) return "#f59e0b";
  return "#ef4444";
}

function createProxyIcon(color = "#22c55e", size = 18) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'>
      <rect x='8' y='8' width='48' height='48' rx='10' fill='#0f172a' stroke='#94a3b8' stroke-width='4'/>
      <path d='M20 40h24M20 32h24M20 24h24' stroke='#e2e8f0' stroke-width='4' stroke-linecap='round'/>
      <circle cx='50' cy='50' r='10' fill='${color}' stroke='#111827' stroke-width='2'/>
    </svg>`;
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
  return image.resize({ width: size, height: size });
}

function sendNotification(title, body) {
  if (Notification.isSupported()) new Notification({ title, body }).show();
}

function getSetting(key, fallback) {
  const db = getDB();
  const row = db.prepare("SELECT value FROM app_settings WHERE key=?").get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  const db = getDB();
  db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, String(value));
}

async function fetchGeoInfo(rawIp) {
  const ip = extractIp(rawIp);
  if (!ip) return { countryCode: null, countryFlag: null };

  const providers = [
    async () => {
      const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`);
      const data = await response.json();
      if (!data.success || !data.country_code) return null;
      return { countryCode: data.country_code };
    },
    async () => {
      const response = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
      const data = await response.json();
      if (!data || data.error || !data.country_code) return null;
      return { countryCode: data.country_code };
    },
    async () => {
      const response = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode`);
      const data = await response.json();
      if (!data || data.status !== "success" || !data.countryCode) return null;
      return { countryCode: data.countryCode };
    },
  ];

  for (const provider of providers) {
    try {
      const result = await provider();
      if (result?.countryCode) {
        const countryCode = String(result.countryCode).toUpperCase();
        return {
          countryCode,
          countryFlag: countryCodeToFlag(countryCode),
        };
      }
    } catch (error) {
      // try next provider
    }
  }

  return { countryCode: null, countryFlag: null };
}

function buildAppMenu() {
  const template = [
    {
      label: "Edit",
      submenu: [
        {
          label: "Settings",
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("ui:openSettings");
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1050,
    height: 920,
    icon: createProxyIcon("#22c55e", 64),
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("close", (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
      sendNotification("SSH Proxy Manager", "App is still running in tray.");
    }
  });

  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(path.join(__dirname, "../dist/index.html")));
  }
}

function updateTrayForConnectedServer() {
  if (!tray) return;

  const db = getDB();
  const connected = db
    .prepare("SELECT ip, best_port, socks_port, country_flag, last_speed_kbps FROM servers WHERE status='CONNECTED' ORDER BY COALESCE(last_speed_kbps, 0) DESC LIMIT 1")
    .get();

  if (!connected) {
    tray.setImage(createProxyIcon("#ef4444", 18));
    tray.setToolTip("SSH Proxy Manager\nNo active proxy\nSpeed: dc");
    tray.setTitle("dc");
    return;
  }

  const speedValue = connected.last_speed_kbps ? `${connected.last_speed_kbps} kbps` : "N/A";
  tray.setImage(createProxyIcon(getStatusColor(connected.last_speed_kbps), 18));
  tray.setTitle(connected.last_speed_kbps ? `${Math.round(connected.last_speed_kbps)}k` : "dc");
  tray.setToolTip(
    [`IP: ${connected.ip}`, `Remote Port: ${connected.best_port || "-"}`, `Local SOCKS: ${connected.socks_port || "-"}`, `Flag: ${connected.country_flag || "🏳️"}`, `Speed: ${speedValue}`].join("\n"),
  );
}

function createTray() {
  tray = new Tray(createProxyIcon("#ef4444", 18));
  tray.setToolTip("SSH Proxy Manager");

  const contextMenu = Menu.buildFromTemplate([
    { label: "Show", click: () => mainWindow.show() },
    {
      label: "Quit",
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => mainWindow.show());
}

function applySpeedSortRanks() {
  const db = getDB();
  const ranked = db
    .prepare("SELECT id FROM servers ORDER BY COALESCE(last_speed_kbps, 0) DESC, COALESCE(last_latency_socks, 999999) ASC, id DESC")
    .all();

  const updateRank = db.prepare("UPDATE servers SET sort_rank=? WHERE id=?");
  db.transaction((rows) => rows.forEach((row, index) => updateRank.run(index + 1, row.id)))(ranked);
}

function normalizeServerStateAfterLaunch() {
  const db = getDB();
  db.prepare("UPDATE servers SET status='OK', socks_port=NULL WHERE status IN ('CONNECTED','CONNECTING','DISCONNECTED')").run();
}

function setupSpeedMonitor() {
  if (speedMonitorInterval) clearInterval(speedMonitorInterval);
  const minutes = Number(getSetting("speed_check_interval_min", "5")) || 5;

  speedMonitorInterval = setInterval(async () => {
    const ids = getActiveConnectionIds();
    for (const id of ids) {
      await testConnectedProxySpeed(id);
      await testSocksLatency(id);
    }
    updateTrayForConnectedServer();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("servers:updated");
  }, Math.max(1, minutes) * 60 * 1000);
}

async function runPinnedLoadBalance() {
  if (loadBalanceInProgress) return;
  loadBalanceInProgress = true;

  try {
    const db = getDB();
    const pinnedServers = db
      .prepare("SELECT * FROM servers WHERE COALESCE(is_pinned, 0)=1 ORDER BY COALESCE(last_speed_kbps,0) DESC, id DESC")
      .all();

    if (!pinnedServers.length) return;

    for (const server of pinnedServers) {
      await testServer(server);
      await testServerProxyCapability(server.id);
    }

    const best = db
      .prepare("SELECT id, last_speed_kbps FROM servers WHERE COALESCE(is_pinned, 0)=1 AND status='OK' ORDER BY COALESCE(last_speed_kbps, 0) DESC, id DESC LIMIT 1")
      .get();

    if (!best) return;

    const activeIds = getActiveConnectionIds();
    for (const activeId of activeIds) disconnectSSH(activeId);

    const connectResult = await connectSSH(best.id);
    if (connectResult.success) {
      await testConnectedProxySpeed(best.id);
      await testSocksLatency(best.id);
      sendNotification("Load balancing", `Connected to best pinned server #${best.id}`);
    }

    applySpeedSortRanks();
    updateTrayForConnectedServer();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("servers:updated");
  } finally {
    loadBalanceInProgress = false;
  }
}

function setupLoadBalanceMonitor() {
  if (loadBalanceInterval) clearInterval(loadBalanceInterval);

  const enabled = getSetting("load_balance_enabled", "0") === "1";
  const minutes = Math.max(1, Number(getSetting("load_balance_interval_min", "5")) || 5);

  if (!enabled) return;

  loadBalanceInterval = setInterval(async () => {
    await runPinnedLoadBalance();
  }, minutes * 60 * 1000);
}

async function rebuildGeoForExistingServers() {
  const db = getDB();
  const servers = db.prepare("SELECT id, ip FROM servers").all();

  for (const server of servers) {
    const { countryCode, countryFlag } = await fetchGeoInfo(server.ip);
    db.prepare("UPDATE servers SET country_code=?, country_flag=? WHERE id=?").run(countryCode, countryFlag, server.id);
  }

  return { success: true, updated: servers.length };
}

app.whenReady().then(() => {
  initDB();
  normalizeServerStateAfterLaunch();
  setSetting("speed_check_interval_min", getSetting("speed_check_interval_min", "5"));
  setSetting("load_balance_enabled", getSetting("load_balance_enabled", "0"));
  setSetting("load_balance_interval_min", getSetting("load_balance_interval_min", "5"));
  setupIPC();
  buildAppMenu();
  createWindow();
  createTray();
  setupSpeedMonitor();
  setupLoadBalanceMonitor();
  updateTrayForConnectedServer();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow.show();
  });
});

app.on("before-quit", () => {
  app.isQuiting = true;
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
});

function setupIPC() {
  const db = getDB();

  ipcMain.handle("credentials:get", () => db.prepare("SELECT * FROM credentials ORDER BY id DESC").all());
  ipcMain.handle("credentials:add", (event, data) => {
    db.prepare("INSERT INTO credentials (label, username, password) VALUES (?, ?, ?)").run(data.label, data.username, data.password);
    return { success: true };
  });
  ipcMain.handle("credentials:delete", (event, id) => {
    db.prepare("DELETE FROM credentials WHERE id=?").run(id);
    return { success: true };
  });

  ipcMain.handle("profiles:get", () => db.prepare("SELECT * FROM port_profiles ORDER BY id DESC").all());
  ipcMain.handle("profiles:add", (event, data) => {
    db.prepare("INSERT INTO port_profiles (label, local_socks_port) VALUES (?, ?)").run(data.label, data.local_socks_port);
    return { success: true };
  });
  ipcMain.handle("profiles:delete", (event, id) => {
    db.prepare("DELETE FROM port_profiles WHERE id=?").run(id);
    return { success: true };
  });

  ipcMain.handle("settings:get", () => {
    return {
      speed_check_interval_min: Number(getSetting("speed_check_interval_min", "5")) || 5,
      load_balance_enabled: getSetting("load_balance_enabled", "0") === "1",
      load_balance_interval_min: Number(getSetting("load_balance_interval_min", "5")) || 5,
    };
  });

  ipcMain.handle("settings:update", (event, payload) => {
    const speedCheck = Math.max(1, Number(payload.speed_check_interval_min) || 5);
    const loadBalanceIntervalMin = Math.max(1, Number(payload.load_balance_interval_min) || 5);
    const loadBalanceEnabled = payload.load_balance_enabled ? "1" : "0";

    setSetting("speed_check_interval_min", String(speedCheck));
    setSetting("load_balance_enabled", loadBalanceEnabled);
    setSetting("load_balance_interval_min", String(loadBalanceIntervalMin));

    setupSpeedMonitor();
    setupLoadBalanceMonitor();
    return { success: true };
  });

  ipcMain.handle("settings:rebuildGeo", async () => {
    const result = await rebuildGeoForExistingServers();
    return result;
  });

  ipcMain.handle("servers:sortBySavedSpeed", () => {
    applySpeedSortRanks();
    return { success: true };
  });

  ipcMain.handle("servers:get", () =>
    db
      .prepare(
        `
        SELECT * FROM servers
        ORDER BY
          COALESCE(is_pinned, 0) DESC,
          COALESCE(sort_rank, 999999) ASC,
          id DESC
        `,
      )
      .all(),
  );

  ipcMain.handle("servers:add", async (event, data) => {
    const { countryCode, countryFlag } = await fetchGeoInfo(data.ip);
    db.prepare(
      "INSERT INTO servers (ip, optional_port, credential_id, port_profile_id, status, country_code, country_flag, is_pinned) VALUES (?, ?, ?, ?, 'NEW', ?, ?, 0)",
    ).run(data.ip, data.optional_port || null, data.credential_id, data.port_profile_id, countryCode, countryFlag);
    return { success: true };
  });

  ipcMain.handle("servers:delete", (event, id) => {
    db.prepare("DELETE FROM servers WHERE id=?").run(id);
    return { success: true };
  });

  ipcMain.handle("servers:togglePin", (event, id) => {
    db.prepare("UPDATE servers SET is_pinned = CASE WHEN COALESCE(is_pinned,0)=1 THEN 0 ELSE 1 END WHERE id=?").run(id);
    return { success: true };
  });

  ipcMain.handle("servers:testOne", async (event, serverId) => {
    const server = db.prepare("SELECT * FROM servers WHERE id=?").get(serverId);
    await testServer(server);
    return { success: true };
  });

  ipcMain.handle("servers:testAll", async () => {
    const servers = db.prepare("SELECT * FROM servers").all();
    for (let index = 0; index < servers.length; index += 1) {
      const server = servers[index];
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("servers:testAllProgress", {
          serverId: server.id,
          ip: server.ip,
          index: index + 1,
          total: servers.length,
        });
      }
      await testServer(server);
      await testServerProxyCapability(server.id);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("servers:testAllProgress", { done: true, total: servers.length });
    }
    applySpeedSortRanks();
    return { success: true };
  });

  ipcMain.handle("ssh:connect", async (event, serverId) => {
    const result = await connectSSH(serverId);
    sendNotification(result.success ? "Proxy connected" : "Proxy connection failed", result.success ? `Server #${serverId} connected.` : result.message);
    if (result.success) {
      await testConnectedProxySpeed(serverId);
      await testSocksLatency(serverId);
    }
    updateTrayForConnectedServer();
    return result;
  });

  ipcMain.handle("ssh:disconnect", async (event, serverId) => {
    const result = disconnectSSH(serverId);
    sendNotification(result.success ? "Proxy disconnected" : "Disconnect failed", `Server #${serverId}`);
    updateTrayForConnectedServer();
    return result;
  });

  ipcMain.handle("ssh:testSocks", async (event, serverId) => {
    const result = await testSocksLatency(serverId);
    if (result.success) await testConnectedProxySpeed(serverId);
    updateTrayForConnectedServer();
    return result;
  });

  ipcMain.handle("servers:bulkImport", async (event, { ips, credentialId, portProfileId, optionalPort }) => {
    for (const raw of ips) {
      const ip = raw.trim();
      if (!ip) continue;
      const countryCode = null;
      const countryFlag = null;

      const inserted = db
        .prepare(
          "INSERT INTO servers (ip, optional_port, credential_id, port_profile_id, status, country_code, country_flag, is_pinned) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
        )
        .run(ip, optionalPort || null, credentialId, portProfileId, "PENDING", countryCode, countryFlag);

      const server = db.prepare("SELECT * FROM servers WHERE id=?").get(inserted.lastInsertRowid);
      await testServer(server);
    }

    return { success: true };
  });
}
