const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const rooms = new Map();
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }
  const requestedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = path.resolve(PUBLIC_DIR, `.${requestedPath}`);

  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(contents);
  });
});

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 1024 });

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function sendError(socket, message) {
  send(socket, { type: "error", message });
}

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from(crypto.randomBytes(5), (byte) => alphabet[byte % alphabet.length]).join("");
  } while (rooms.has(code));
  return code;
}

function createPlayer(id, side) {
  return {
    id,
    x: side === 0 ? 190 : 770,
    y: 300,
    hp: 100,
    wins: 0,
    side,
    keys: [],
    lastAttackAt: 0,
  };
}

function getSnapshot(room) {
  return {
    type: "state",
    roomCode: room.code,
    status: room.players.size === 2 ? "playing" : "waiting",
    winnerId: room.winnerId,
    players: Array.from(room.players.values(), (player) => ({
      id: player.id,
      x: player.x,
      y: player.y,
      hp: player.hp,
      wins: player.wins,
      side: player.side,
    })),
  };
}

function broadcast(room) {
  const snapshot = JSON.stringify(getSnapshot(room));
  for (const socket of room.sockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(snapshot);
    }
  }
}

function detachSocket(socket) {
  const room = rooms.get(socket.roomCode);
  if (!room) {
    socket.roomCode = null;
    return;
  }

  room.sockets.delete(socket);
  room.players.delete(socket.playerId);
  socket.roomCode = null;
  socket.playerId = null;

  if (room.players.size === 0) {
    clearInterval(room.timer);
    rooms.delete(room.code);
    return;
  }

  room.winnerId = null;
  broadcast(room);
}

function joinRoom(socket, room) {
  const takenSides = new Set(Array.from(room.players.values(), (player) => player.side));
  const side = takenSides.has(0) ? 1 : 0;
  const playerId = crypto.randomUUID();
  socket.roomCode = room.code;
  socket.playerId = playerId;
  room.sockets.add(socket);
  room.players.set(playerId, createPlayer(playerId, side));
  send(socket, { type: "roomJoined", playerId, roomCode: room.code });
  broadcast(room);
}

function handleMessage(socket, rawMessage) {
  let message;
  try {
    message = JSON.parse(rawMessage.toString());
  } catch {
    sendError(socket, "訊息格式無效，請重新連線。");
    return;
  }

  if (!message || typeof message.type !== "string") {
    sendError(socket, "無法辨識的訊息。");
    return;
  }

  if (message.type === "createRoom") {
    if (socket.roomCode) {
      sendError(socket, "請先離開目前的房間。");
      return;
    }

    const code = createRoomCode();
    const room = {
      code,
      players: new Map(),
      sockets: new Set(),
      winnerId: null,
      resetAt: 0,
      timer: null,
    };
    rooms.set(code, room);
    joinRoom(socket, room);
    return;
  }

  if (message.type === "joinRoom") {
    if (socket.roomCode) {
      sendError(socket, "請先離開目前的房間。");
      return;
    }

    const code = typeof message.code === "string" ? message.code.trim().toUpperCase() : "";
    const room = rooms.get(code);
    if (!room) {
      sendError(socket, "找不到這個房間，請確認房間碼。");
      return;
    }
    if (room.players.size >= 2) {
      sendError(socket, "這個房間已滿。");
      return;
    }
    joinRoom(socket, room);
    return;
  }

  if (message.type === "leaveRoom") {
    detachSocket(socket);
    return;
  }

  if (!socket.roomCode) {
    sendError(socket, "請先加入房間。");
    return;
  }

  const room = rooms.get(socket.roomCode);
  const player = room && room.players.get(socket.playerId);
  if (!room || !player) {
    sendError(socket, "房間已結束，請重新加入。");
    return;
  }

  if (message.type === "input") {
    const allowedKeys = new Set(["up", "down", "left", "right"]);
    player.keys = Array.isArray(message.keys)
      ? [...new Set(message.keys.filter((key) => allowedKeys.has(key)))]
      : [];
    return;
  }

  if (message.type === "attack") {
    const now = Date.now();
    if (room.players.size !== 2 || room.winnerId || now - player.lastAttackAt < 650) {
      return;
    }

    const opponent = Array.from(room.players.values()).find((other) => other.id !== player.id);
    if (!opponent || Math.hypot(opponent.x - player.x, opponent.y - player.y) > 155) {
      send(socket, { type: "notice", message: "對手還在攻擊範圍外" });
      return;
    }

    player.lastAttackAt = now;
    opponent.hp = Math.max(0, opponent.hp - 18);
    if (opponent.hp === 0) {
      player.wins += 1;
      room.winnerId = player.id;
      room.resetAt = now + 2200;
    }
    broadcast(room);
  }
}

wss.on("connection", (socket) => {
  socket.roomCode = null;
  socket.playerId = null;
  send(socket, { type: "connected" });

  socket.on("message", (message) => handleMessage(socket, message));
  socket.on("close", () => detachSocket(socket));
  socket.on("error", (error) => console.error("WebSocket error:", error.message));
});

function startRoomTimer(room) {
  if (room.timer) {
    return;
  }

  let previousTick = Date.now();
  room.timer = setInterval(() => {
    const now = Date.now();
    const delta = Math.min((now - previousTick) / 1000, 0.1);
    previousTick = now;

    if (room.winnerId && now >= room.resetAt) {
      room.winnerId = null;
      for (const player of room.players.values()) {
        player.hp = 100;
        player.x = player.side === 0 ? 190 : 770;
        player.y = 300;
        player.keys = [];
      }
    }

    if (room.players.size === 2 && !room.winnerId) {
      for (const player of room.players.values()) {
        const horizontal = Number(player.keys.includes("right")) - Number(player.keys.includes("left"));
        const vertical = Number(player.keys.includes("down")) - Number(player.keys.includes("up"));
        const magnitude = Math.hypot(horizontal, vertical) || 1;
        player.x = Math.max(48, Math.min(912, player.x + (horizontal / magnitude) * 230 * delta));
        player.y = Math.max(70, Math.min(530, player.y + (vertical / magnitude) * 230 * delta));
      }
    }

    broadcast(room);
  }, 50);
}

setInterval(() => {
  for (const room of rooms.values()) {
    startRoomTimer(room);
  }
}, 500);

server.listen(PORT, () => {
  console.log(`Riftbound Arena is ready at http://localhost:${PORT}`);
});
