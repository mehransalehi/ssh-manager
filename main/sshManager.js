const { spawn } = require("child_process");
const net = require("net");
const http = require("http");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { getDB } = require("./db");

const activeConnections = new Map();

function tcpTest(ip, port, timeout = 4000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let finished = false;

    socket.setTimeout(timeout);

    socket.connect(port, ip, () => {
      if (finished) return;
      finished = true;
      const latency = Date.now() - start;
      socket.destroy();
      resolve({ success: true, latency });
    });

    socket.on("error", () => {
      if (finished) return;
      finished = true;
      resolve({ success: false });
    });

    socket.on("timeout", () => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve({ success: false });
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runSocksSpeedTest(localSocksPort) {
  return new Promise((resolve) => {
    const proxyUrl = `socks5h://127.0.0.1:${localSocksPort}`;
    const agent = new SocksProxyAgent(proxyUrl);
    const startedAt = Date.now();
    let totalBytes = 0;

    const req = http.get(
      "http://speed.cloudflare.com/__down?bytes=200000",
      { agent, timeout: 7000 },
      (res) => {
        res.on("data", (chunk) => {
          totalBytes += chunk.length;
        });

        res.on("end", () => {
          const elapsedSeconds = (Date.now() - startedAt) / 1000;
          if (!elapsedSeconds || !totalBytes) {
            resolve({ success: false, message: "No data received" });
            return;
          }

          const kbps = Number(((totalBytes * 8) / 1024 / elapsedSeconds).toFixed(1));
          resolve({ success: true, kbps });
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });

    req.on("error", () => {
      resolve({ success: false, message: "Speed test failed" });
    });
  });
}

async function connectSSH(serverId) {
  const db = getDB();

  const server = db.prepare("SELECT * FROM servers WHERE id=?").get(serverId);
  const credential = db.prepare("SELECT * FROM credentials WHERE id=?").get(server?.credential_id);
  const profile = db.prepare("SELECT * FROM port_profiles WHERE id=?").get(server?.port_profile_id);

  if (!server || !credential || !profile) {
    return { success: false, message: "Missing server, credential, or profile" };
  }

  const port = server.optional_port || server.best_port;
  if (!port) {
    db.prepare("UPDATE servers SET status='FAILED_CONNECT' WHERE id=?").run(serverId);
    return { success: false, message: "No working port found" };
  }

  const localSocksPort = profile.local_socks_port;
  for (const conn of activeConnections.values()) {
    if (conn.socksPort === localSocksPort) {
      return { success: false, message: "This local SOCKS port is already in use" };
    }
  }

  db.prepare("UPDATE servers SET status='CONNECTING' WHERE id=?").run(serverId);

  const args = [
    "-N",
    "-D",
    localSocksPort,
    "-p",
    port,
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "ExitOnForwardFailure=yes",
    `${credential.username}@${server.ip}`,
  ];
  const ssh = spawn("sshpass", ["-p", credential.password, "ssh", ...args]);

  ssh.on("error", (err) => console.error("SSH Error:", err));
  ssh.stderr.on("data", (data) => console.error(`SSH stderr: ${data}`));

  await wait(1800);
  const probe = await tcpTest("127.0.0.1", localSocksPort, 2500);

  if (!probe.success) {
    try {
      process.kill(ssh.pid);
    } catch (error) {
      // ignore
    }
    db.prepare("UPDATE servers SET status='FAILED_CONNECT' WHERE id=?").run(serverId);
    return { success: false, message: "SSH tunnel did not come up" };
  }

  activeConnections.set(serverId, { pid: ssh.pid, socksPort: localSocksPort, connectedAt: Date.now() });

  ssh.on("exit", () => {
    activeConnections.delete(serverId);
    db.prepare("UPDATE servers SET status='DISCONNECTED' WHERE id=?").run(serverId);
  });

  db.prepare("UPDATE servers SET socks_port=?, status=? WHERE id=?").run(localSocksPort, "CONNECTED", serverId);
  return { success: true, socksPort: localSocksPort };
}

function disconnectSSH(serverId) {
  const db = getDB();
  const connection = activeConnections.get(serverId);

  if (!connection) return { success: false };

  try {
    process.kill(connection.pid);
  } catch (error) {
    // ignore
  }

  activeConnections.delete(serverId);
  db.prepare("UPDATE servers SET status='DISCONNECTED' WHERE id=?").run(serverId);

  return { success: true };
}

function testSocksLatency(serverId) {
  const db = getDB();
  const server = db.prepare("SELECT * FROM servers WHERE id=?").get(serverId);

  if (!server?.socks_port) {
    return Promise.resolve({ success: false });
  }

  return tcpTest("127.0.0.1", server.socks_port).then((result) => {
    if (result.success) {
      db.prepare("UPDATE servers SET last_latency_socks=? WHERE id=?").run(result.latency, serverId);
      return { success: true, latency: result.latency };
    }

    return { success: false };
  });
}

function testConnectedProxySpeed(serverId) {
  const db = getDB();
  const server = db.prepare("SELECT * FROM servers WHERE id=?").get(serverId);

  if (!server?.socks_port) {
    return Promise.resolve({ success: false, message: "No SOCKS port" });
  }

  return runSocksSpeedTest(server.socks_port).then((result) => {
    if (result.success) {
      db.prepare("UPDATE servers SET last_speed_kbps=? WHERE id=?").run(result.kbps, serverId);
    }
    return result;
  });
}

async function testServerProxyCapability(serverId) {
  const db = getDB();
  const server = db.prepare("SELECT * FROM servers WHERE id=?").get(serverId);
  const credential = db.prepare("SELECT * FROM credentials WHERE id=?").get(server?.credential_id);

  if (!server || !credential) {
    return { success: false, message: "Missing test prerequisites" };
  }

  const port = server.optional_port || server.best_port;
  if (!port) {
    db.prepare("UPDATE servers SET status='FAILED_CONNECT_TEST' WHERE id=?").run(serverId);
    return { success: false, message: "No usable SSH port" };
  }

  const tempSocksPort = 24000 + (serverId % 10000);
  const args = [
    "-N",
    "-D",
    tempSocksPort,
    "-p",
    port,
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "ExitOnForwardFailure=yes",
    `${credential.username}@${server.ip}`,
  ];

  const ssh = spawn("sshpass", ["-p", credential.password, "ssh", ...args]);
  ssh.stderr.on("data", () => {});

  await wait(1700);
  const probe = await tcpTest("127.0.0.1", tempSocksPort, 2500);

  if (!probe.success) {
    try {
      process.kill(ssh.pid);
    } catch (error) {
      // ignore
    }
    db.prepare("UPDATE servers SET status='FAILED_CONNECT_TEST', last_speed_kbps=NULL WHERE id=?").run(serverId);
    return { success: false, message: "Cannot establish SSH SOCKS tunnel" };
  }

  const speed = await runSocksSpeedTest(tempSocksPort);

  try {
    process.kill(ssh.pid);
  } catch (error) {
    // ignore
  }

  if (!speed.success) {
    db.prepare("UPDATE servers SET status='FAILED_CONNECT_TEST', last_speed_kbps=NULL WHERE id=?").run(serverId);
    return { success: false, message: "Tunnel opened but speed test failed" };
  }

  db.prepare("UPDATE servers SET status='OK', last_speed_kbps=? WHERE id=?").run(speed.kbps, serverId);
  return { success: true, kbps: speed.kbps };
}

function getActiveConnectionIds() {
  return Array.from(activeConnections.keys());
}

module.exports = {
  connectSSH,
  disconnectSSH,
  testSocksLatency,
  testConnectedProxySpeed,
  testServerProxyCapability,
  getActiveConnectionIds,
};
