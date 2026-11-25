const lobby = document.querySelector("#lobby");
const arena = document.querySelector("#arena");
const lobbyMessage = document.querySelector("#lobbyMessage");
const roomCodeInput = document.querySelector("#roomCode");
const canvas = document.querySelector("#gameCanvas");
const context = canvas.getContext("2d");
const keysDown = new Set();
let socket = null;
let playerId = null;
let gameState = null;
let lastInputSent = "";
let messageTimeout = null;
let previousWinnerId = null;

function connectAndSend(message) {
  lobbyMessage.textContent = "";
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
    return;
  }
  if (socket && socket.readyState === WebSocket.CONNECTING) {
    lobbyMessage.textContent = "正在連線，請稍候…";
    return;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
  socket.addEventListener("open", () => socket.send(JSON.stringify(message)), { once: true });
  socket.addEventListener("message", handleServerMessage);
  socket.addEventListener("close", () => {
    socket = null;
    playerId = null;
    gameState = null;
    if (!arena.classList.contains("is-hidden")) {
      showLobby();
      lobbyMessage.textContent = "連線已中斷，請重新加入房間。";
    }
  });
  socket.addEventListener("error", () => {
    lobbyMessage.textContent = "無法連線到遊戲伺服器，請確認伺服器已啟動。";
  });
}

function handleServerMessage(event) {
  let message;
  try {
    message = JSON.parse(event.data);
  } catch {
    lobbyMessage.textContent = "收到無效的伺服器回應，請重新連線。";
    return;
  }

  if (message.type === "roomJoined") {
    playerId = message.playerId;
    document.querySelector("#activeRoomCode").textContent = message.roomCode;
    lobby.classList.add("is-hidden");
    arena.classList.remove("is-hidden");
    document.querySelector("#gameOverlay").classList.remove("is-hidden");
    document.querySelector("#roundBanner").classList.add("is-hidden");
    return;
  }

  if (message.type === "state") {
    gameState = message;
    renderStatus(message);
    if (message.winnerId && message.winnerId !== previousWinnerId) {
      showRoundBanner(message.winnerId);
    } else if (!message.winnerId && previousWinnerId) {
      document.querySelector("#roundBanner").classList.add("is-hidden");
    }
    previousWinnerId = message.winnerId;
    return;
  }

  if (message.type === "error") {
    lobbyMessage.textContent = message.message;
    return;
  }

  if (message.type === "notice") {
    showArenaMessage(message.message);
  }
}

function renderStatus(state) {
  const ownPlayer = state.players.find((player) => player.id === playerId);
  const opponent = state.players.find((player) => player.id !== playerId);
  document.querySelector("#matchStatus").textContent = state.status === "playing" ? "對戰進行中" : "等待對手加入";
  document.querySelector("#gameOverlay").classList.toggle("is-hidden", state.status === "playing");

  if (ownPlayer) {
    document.querySelector("#ownHealth").style.width = `${ownPlayer.hp}%`;
    document.querySelector("#ownWins").textContent = ownPlayer.wins;
  }
  if (opponent) {
    document.querySelector("#enemyHealth").style.width = `${opponent.hp}%`;
    document.querySelector(".opponent-panel .score-player small").textContent = "勇者 02";
    document.querySelector("#enemyWins").textContent = opponent.wins;
  } else {
    document.querySelector("#enemyHealth").style.width = "100%";
    document.querySelector(".opponent-panel .score-player small").textContent = "等待加入…";
  }
}

function showRoundBanner(winnerId) {
  const ownWon = winnerId === playerId;
  const banner = document.querySelector("#roundBanner");
  banner.textContent = ownWon ? "本回合勝利" : "本回合落敗";
  banner.classList.remove("is-hidden");
  showArenaMessage(ownWon ? "漂亮的一擊！下一回合即將開始。" : "別急，調整站位再戰一回合。");
}

function showArenaMessage(message) {
  const element = document.querySelector("#arenaMessage");
  element.textContent = message;
  clearTimeout(messageTimeout);
  messageTimeout = setTimeout(() => {
    element.textContent = "與對手拉近距離，抓住時機出手。";
  }, 1700);
}

function showLobby() {
  arena.classList.add("is-hidden");
  lobby.classList.remove("is-hidden");
}

document.querySelector("#createRoom").addEventListener("click", () => {
  connectAndSend({ type: "createRoom" });
});

document.querySelector("#joinForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) {
    lobbyMessage.textContent = "請輸入 5 位英數房間代碼。";
    return;
  }
  connectAndSend({ type: "joinRoom", code });
});

roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
});

document.querySelector("#copyCode").addEventListener("click", async () => {
  const code = document.querySelector("#activeRoomCode").textContent;
  try {
    await navigator.clipboard.writeText(code);
    showArenaMessage("房間碼已複製，分享給朋友吧！");
  } catch {
    showArenaMessage(`房間碼：${code}`);
  }
});

document.querySelector("#leaveRoom").addEventListener("click", () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "leaveRoom" }));
  }
  playerId = null;
  gameState = null;
  keysDown.clear();
  lastInputSent = "";
  showLobby();
});

const keyMap = {
  w: "up", arrowup: "up",
  s: "down", arrowdown: "down",
  a: "left", arrowleft: "left",
  d: "right", arrowright: "right",
};

window.addEventListener("keydown", (event) => {
  if (arena.classList.contains("is-hidden")) return;
  const mapped = keyMap[event.key.toLowerCase()];
  if (mapped) {
    event.preventDefault();
    keysDown.add(mapped);
  }
  if (event.code === "Space") {
    event.preventDefault();
    sendAttack();
  }
});

window.addEventListener("keyup", (event) => {
  const mapped = keyMap[event.key.toLowerCase()];
  if (mapped) {
    keysDown.delete(mapped);
    sendInput();
  }
});

window.addEventListener("blur", () => {
  keysDown.clear();
  sendInput();
});

canvas.addEventListener("pointerdown", () => sendAttack());

function sendAttack() {
  if (socket && socket.readyState === WebSocket.OPEN && gameState && gameState.status === "playing") {
    socket.send(JSON.stringify({ type: "attack" }));
  }
}

function sendInput() {
  if (!socket || socket.readyState !== WebSocket.OPEN || !playerId) return;
  const keys = Array.from(keysDown).sort();
  const signature = keys.join(",");
  if (signature === lastInputSent) return;
  lastInputSent = signature;
  socket.send(JSON.stringify({ type: "input", keys }));
}

setInterval(sendInput, 60);

function drawMap() {
  const width = canvas.width;
  const height = canvas.height;
  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#344c35");
  background.addColorStop(.5, "#273e30");
  background.addColorStop(1, "#394d32");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.fillStyle = "rgba(151, 167, 107, .11)";
  for (let i = 0; i < 44; i += 1) {
    const x = (i * 197 + 31) % width;
    const y = (i * 113 + 47) % height;
    context.beginPath();
    context.ellipse(x, y, 35 + (i % 3) * 8, 17 + (i % 4) * 4, i * .31, 0, Math.PI * 2);
    context.fill();
  }

  context.fillStyle = "#526044";
  context.beginPath();
  context.moveTo(0, 480);
  context.bezierCurveTo(250, 390, 350, 520, 510, 355);
  context.bezierCurveTo(660, 200, 790, 335, 960, 175);
  context.lineTo(960, 265);
  context.bezierCurveTo(790, 410, 680, 300, 540, 430);
  context.bezierCurveTo(360, 590, 240, 460, 0, 565);
  context.closePath();
  context.fill();
  context.strokeStyle = "rgba(197, 194, 126, .14)";
  context.lineWidth = 2;
  context.stroke();

  for (let i = 0; i < 23; i += 1) {
    const x = (i * 173 + 18) % width;
    const y = (i * 127 + 21) % height;
    drawTree(x, y, 0.62 + (i % 3) * .15);
  }

  drawBase(74, 300, "#92c4b8");
  drawBase(886, 300, "#e1b572");
  context.fillStyle = "rgba(225, 233, 204, .36)";
  context.font = "10px DM Sans, sans-serif";
  context.textAlign = "center";
  context.fillText("古林裂境", width / 2, 29);
}

function drawTree(x, y, scale) {
  context.fillStyle = "rgba(9, 17, 12, .23)";
  context.beginPath();
  context.ellipse(x + 4, y + 9, 18 * scale, 9 * scale, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#1c3427";
  context.beginPath();
  context.arc(x, y, 17 * scale, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#34563a";
  context.beginPath();
  context.arc(x - 4 * scale, y - 5 * scale, 11 * scale, 0, Math.PI * 2);
  context.fill();
}

function drawBase(x, y, color) {
  context.save();
  context.translate(x, y);
  context.fillStyle = "rgba(12, 21, 14, .42)";
  context.beginPath();
  context.ellipse(0, 8, 37, 25, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = color;
  context.globalAlpha = .8;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, -31);
  context.lineTo(28, 0);
  context.lineTo(0, 31);
  context.lineTo(-28, 0);
  context.closePath();
  context.stroke();
  context.globalAlpha = 1;
  context.fillStyle = color;
  context.beginPath();
  context.arc(0, 0, 5, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawPlayer(player, isOwnPlayer) {
  const color = isOwnPlayer ? "#9fd3c7" : "#e4bd7d";
  const halo = isOwnPlayer ? "rgba(132, 197, 177, .23)" : "rgba(220, 174, 106, .23)";
  context.fillStyle = "rgba(9, 16, 11, .38)";
  context.beginPath();
  context.ellipse(player.x, player.y + 13, 19, 9, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = halo;
  context.beginPath();
  context.arc(player.x, player.y, 23, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = color;
  context.strokeStyle = "rgba(241, 238, 210, .88)";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(player.x, player.y, 13, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = "#273b2f";
  context.beginPath();
  context.arc(player.x + (isOwnPlayer ? 3 : -3), player.y - 2, 3, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "rgba(10, 17, 12, .65)";
  context.fillRect(player.x - 19, player.y - 27, 38, 4);
  context.fillStyle = color;
  context.fillRect(player.x - 19, player.y - 27, 38 * player.hp / 100, 4);
  context.fillStyle = "#e7eddc";
  context.font = "10px 'Noto Sans TC', sans-serif";
  context.textAlign = "center";
  context.fillText(isOwnPlayer ? "裂境遊俠" : "對手", player.x, player.y - 34);
}

function render() {
  drawMap();
  if (gameState) {
    for (const player of gameState.players) {
      drawPlayer(player, player.id === playerId);
    }
  }
  requestAnimationFrame(render);
}

render();
