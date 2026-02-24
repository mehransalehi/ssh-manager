const net = require("net");
const { getDB } = require("./db");

function tcpTest(ip, port, timeout = 3000) {
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

async function testPortReliable(ip, port, attempts = 2) {
  const latencies = [];
  for (let i = 0; i < attempts; i += 1) {
    const result = await tcpTest(ip, port);
    if (result.success) {
      latencies.push(result.latency);
    }
  }

  if (!latencies.length) {
    return null;
  }

  const average = Math.round(
    latencies.reduce((total, latency) => total + latency, 0) / latencies.length,
  );
  return average;
}

async function testServer(server) {
  const db = getDB();
  const ip = server.ip;
  const optionalPort = server.optional_port;

  let bestLatency = null;
  let bestPort = null;

  if (optionalPort) {
    const optionalLatency = await testPortReliable(ip, optionalPort);

    bestLatency = optionalLatency;
    bestPort = optionalLatency ? optionalPort : null;

    db.prepare(
      `
      UPDATE servers
      SET last_latency_optional=?,
          best_port=?,
          last_speed_kbps=?,
          status=?
      WHERE id=?
    `,
    ).run(
      optionalLatency,
      bestPort,
      optionalLatency ? Math.round(100000 / optionalLatency) : null,
      optionalLatency ? "OK" : "FAILED",
      server.id,
    );

    return { bestPort, bestLatency };
  }

  const ports = [22, 414, 2122];
  const results = {
    22: null,
    414: null,
    2122: null,
  };

  for (const port of ports) {
    const latency = await testPortReliable(ip, port);
    results[port] = latency;

    if (latency !== null && (bestLatency === null || latency < bestLatency)) {
      bestLatency = latency;
      bestPort = port;
    }
  }

  db.prepare(
    `
    UPDATE servers
    SET last_latency_22=?,
        last_latency_414=?,
        last_latency_2122=?,
        best_port=?,
        last_speed_kbps=?,
        status=?
    WHERE id=?
  `,
  ).run(
    results[22],
    results[414],
    results[2122],
    bestPort,
    bestLatency ? Math.round(100000 / bestLatency) : null,
    bestPort ? "OK" : "FAILED",
    server.id,
  );

  return { bestPort, bestLatency };
}

async function testAllServers() {
  const db = getDB();
  const servers = db.prepare("SELECT * FROM servers").all();

  for (const server of servers) {
    await testServer(server);
  }
}

module.exports = { testServer, testAllServers, tcpTest };
