const SUIT_LABELS = { m: "萬", p: "筒", s: "索" };
const HONOR_LABELS = ["東", "南", "西", "北", "白", "發", "中"];
const WIND_LABELS = ["東", "南", "西"];
const TILE_TYPES = 34;
const DEAD_WALL_SIZE = 14;
const STARTING_POINTS = 35000;
const players = [
  { id: 0, name: "你", score: STARTING_POINTS, hand: [], melds: [], discards: [], kita: 0, riichi: false, temporaryFuriten: false, seatWind: 0 },
  { id: 1, name: "小雨", score: STARTING_POINTS, hand: [], melds: [], discards: [], kita: 0, riichi: false, temporaryFuriten: false, seatWind: 1 },
  { id: 2, name: "阿哲", score: STARTING_POINTS, hand: [], melds: [], discards: [], kita: 0, riichi: false, temporaryFuriten: false, seatWind: 2 },
];

const elements = {
  tableMessage: document.querySelector("#tableMessage"),
  hand: document.querySelector("#handPlayer"),
  callPanel: document.querySelector("#callPanel"),
  callButtons: document.querySelector("#callButtons"),
  callPrompt: document.querySelector("#callPrompt"),
  tsumoButton: document.querySelector("#tsumoButton"),
  riichiButton: document.querySelector("#riichiButton"),
  kitaButton: document.querySelector("#kitaButton"),
  roundResult: document.querySelector("#roundResult"),
};

let wall = [];
let wallCursor = 0;
let doraIndicators = [];
let currentDealer = 0;
let eastHand = 1;
let honba = 0;
let lastWinnerId = null;
let roundEnded = false;
let matchEnded = false;
let phase = "player";
let lastDrawnId = null;
let pendingCall = null;
let riichiMode = false;
let lastDiscard = null;
let delayHandle = null;
let nextTileId = 0;

function makeTile(suit, rank, red = false) {
  return { id: nextTileId++, suit, rank, red };
}

function tileIndex(tile) {
  if (tile.suit === "z") return 27 + tile.rank - 1;
  const suitOffset = tile.suit === "m" ? 0 : tile.suit === "p" ? 9 : 18;
  return suitOffset + tile.rank - 1;
}

function tileFromIndex(index) {
  if (index >= 27) return { suit: "z", rank: index - 26, red: false };
  const suit = index < 9 ? "m" : index < 18 ? "p" : "s";
  return { suit, rank: index % 9 + 1, red: false };
}

function tileName(tile) {
  return tile.suit === "z" ? HONOR_LABELS[tile.rank - 1] : `${tile.rank}${SUIT_LABELS[tile.suit]}`;
}

function tileClass(tile) {
  const suitClass = { m: "man", p: "pin", s: "sou" };
  const colorClass = tile.suit === "z" ? "tile-honor" : `tile-${suitClass[tile.suit]}`;
  const honorClass = tile.suit === "z" ? " honor" : "";
  const redClass = tile.red ? " red-five red-mark" : "";
  return `${colorClass}${honorClass}${redClass}`;
}

function createTileFace(tile, small = false) {
  const face = document.createElement("span");
  face.className = `tile ${tileClass(tile)}${small ? " tile-small" : ""}`;
  face.setAttribute("aria-label", tileName(tile));
  if (tile.suit === "z") {
    const honor = document.createElement("span");
    honor.className = "tile-rank";
    honor.textContent = HONOR_LABELS[tile.rank - 1];
    face.append(honor);
  } else {
    const rank = document.createElement("span");
    rank.className = "tile-rank";
    rank.textContent = String(tile.rank);
    const suit = document.createElement("span");
    suit.className = "tile-suit";
    suit.textContent = SUIT_LABELS[tile.suit];
    face.append(rank, suit);
  }
  return face;
}

function createTileButton(tile, index) {
  const button = document.createElement("button");
  const drawn = tile.id === lastDrawnId;
  button.type = "button";
  button.className = `tile ${tileClass(tile)}${drawn ? " drawn-tile" : ""}`;
  button.setAttribute("aria-label", `打出${tileName(tile)}`);
  button.title = `打出 ${tileName(tile)}`;
  if (riichiMode) button.classList.add("riichi-choice");
  button.addEventListener("click", () => discardPlayerTile(tile.id, index));

  if (tile.suit === "z") {
    const honor = document.createElement("span");
    honor.className = "tile-rank";
    honor.textContent = HONOR_LABELS[tile.rank - 1];
    button.append(honor);
  } else {
    const rank = document.createElement("span");
    rank.className = "tile-rank";
    rank.textContent = String(tile.rank);
    const suit = document.createElement("span");
    suit.className = "tile-suit";
    suit.textContent = SUIT_LABELS[tile.suit];
    button.append(rank, suit);
  }
  return button;
}

function createWall() {
  const tiles = [];
  for (const [suit, ranks] of [["m", [1, 9]], ["p", [1, 2, 3, 4, 5, 6, 7, 8, 9]], ["s", [1, 2, 3, 4, 5, 6, 7, 8, 9]]]) {
    for (const rank of ranks) {
      for (let copy = 0; copy < 4; copy += 1) {
        tiles.push(makeTile(suit, rank, rank === 5 && suit !== "m" && copy === 0));
      }
    }
  }
  for (let rank = 1; rank <= 7; rank += 1) {
    for (let copy = 0; copy < 4; copy += 1) tiles.push(makeTile("z", rank));
  }
  for (let index = tiles.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [tiles[index], tiles[swapIndex]] = [tiles[swapIndex], tiles[index]];
  }
  return tiles;
}

function sortHand(hand) {
  hand.sort((a, b) => tileIndex(a) - tileIndex(b) || Number(a.red) - Number(b.red) || a.id - b.id);
}

function countTiles(hand) {
  const counts = Array(TILE_TYPES).fill(0);
  for (const tile of hand) counts[tileIndex(tile)] += 1;
  return counts;
}

function liveWallCount() {
  return Math.max(0, wall.length - DEAD_WALL_SIZE - wallCursor);
}

function drawTile(seat) {
  if (liveWallCount() <= 0) return null;
  const tile = wall[wallCursor++];
  seat.hand.push(tile);
  sortHand(seat.hand);
  seat.temporaryFuriten = false;
  if (seat.id === 0) lastDrawnId = tile.id;
  return tile;
}

function getDoraIndex(index) {
  if (index < 27) {
    const suitOffset = Math.floor(index / 9) * 9;
    const rank = index % 9 + 1;
    if (suitOffset === 0 && rank === 1) return 8;
    if (suitOffset === 0 && rank === 9) return 0;
    return suitOffset + rank % 9;
  }
  const honorRank = index - 26;
  const nextRank = honorRank <= 4 ? honorRank % 4 + 1 : (honorRank - 5 + 1) % 3 + 5;
  return 27 + nextRank - 1;
}

function getDoraCount(hand, kitaCount = 0) {
  const indicatorIndices = doraIndicators.map(tileIndex);
  const doraIndices = indicatorIndices.map(getDoraIndex);
  return hand.reduce((total, tile) => {
    const index = tileIndex(tile);
    return total + Number(tile.red) + doraIndices.filter((dora) => dora === index).length;
  }, kitaCount);
}

function findMeldSets(counts, needed, melds = []) {
  let first = counts.findIndex((count) => count > 0);
  if (first === -1) return needed === 0 ? [melds.slice()] : [];
  if (needed <= 0) return [];

  const results = [];
  if (counts[first] >= 3) {
    counts[first] -= 3;
    results.push(...findMeldSets(counts, needed - 1, [...melds, { type: "pon", index: first }]));
    counts[first] += 3;
  }
  if (first < 27 && first % 9 <= 6 && counts[first + 1] > 0 && counts[first + 2] > 0) {
    counts[first] -= 1;
    counts[first + 1] -= 1;
    counts[first + 2] -= 1;
    results.push(...findMeldSets(counts, needed - 1, [...melds, { type: "chi", index: first }]));
    counts[first] += 1;
    counts[first + 1] += 1;
    counts[first + 2] += 1;
  }
  return results;
}

function getStandardDecompositions(hand, openMeldCount) {
  const counts = countTiles(hand);
  const needed = 4 - openMeldCount;
  const decompositions = [];
  for (let pair = 0; pair < counts.length; pair += 1) {
    if (counts[pair] < 2) continue;
    counts[pair] -= 2;
    const sets = findMeldSets(counts, needed);
    for (const melds of sets) decompositions.push({ pair, melds });
    counts[pair] += 2;
  }
  return decompositions;
}

function isKokushi(hand) {
  const terminals = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
  const counts = countTiles(hand);
  return terminals.every((index) => counts[index] > 0)
    && terminals.some((index) => counts[index] > 1)
    && hand.length === 14;
}

function isSevenPairs(hand) {
  if (hand.length !== 14) return false;
  return countTiles(hand).every((count) => count === 0 || count === 2);
}

function isCompleteShape(hand, openMeldCount) {
  if (openMeldCount === 0 && (isKokushi(hand) || isSevenPairs(hand))) return true;
  return getStandardDecompositions(hand, openMeldCount).length > 0;
}

function getWaitIndices(hand, seat) {
  const counts = countTiles(hand);
  const waits = [];
  for (let index = 0; index < TILE_TYPES; index += 1) {
    if (counts[index] >= 4) continue;
    const candidate = [...hand, tileFromIndex(index)];
    if (isCompleteShape(candidate, seat.melds.length)) waits.push(index);
  }
  return waits;
}

function isFuriten(seat) {
  if (seat.temporaryFuriten || seat.permanentFuriten) return true;
  const waits = getWaitIndices(seat.hand, seat);
  return seat.discards.some((discard) => waits.includes(tileIndex(discard)));
}

function isValueHonor(index, seat) {
  if (index < 27) return false;
  const honorRank = index - 26;
  const seatWindRank = seat.seatWind + 1;
  return honorRank >= 5 || honorRank === seatWindRank || honorRank === 1;
}

function getDecompositionYaku(decomposition, seat, hand, winningTile, closed) {
  const melds = [...seat.melds.map((meld) => ({ type: meld.type, index: tileIndex(meld.tiles[0]) })), ...decomposition.melds];
  const allTiles = [...hand, ...seat.melds.flatMap((meld) => meld.tiles)];
  const yaku = [];
  if (melds.length === 4 && melds.every((meld) => meld.type === "pon")) yaku.push({ name: "對對和", han: 2 });
  let yakuhaiHan = 0;
  for (const meld of melds) {
    if (meld.type === "pon" && meld.index >= 27 && isValueHonor(meld.index, seat)) {
      const honorRank = meld.index - 26;
      yakuhaiHan += honorRank >= 5 ? 1 : honorRank === seat.seatWind + 1 ? 1 : 0;
      if (honorRank === 1) yakuhaiHan += 1;
    }
  }
  if (yakuhaiHan) yaku.push({ name: "役牌", han: yakuhaiHan });

  if (closed && melds.length === 4 && melds.every((meld) => meld.type === "chi")) {
    const pairIsValueHonor = isValueHonor(decomposition.pair, seat);
    let twoSidedWait = false;
    if (winningTile && winningTile.suit !== "z") {
      for (const meld of decomposition.melds) {
        if (meld.type !== "chi") continue;
        const winIndex = tileIndex(winningTile);
        if (winIndex < meld.index || winIndex > meld.index + 2) continue;
        const offset = winIndex - meld.index;
        const startRank = meld.index % 9 + 1;
        if (offset === 1) continue;
        if (offset === 2 && startRank === 1) continue;
        if (offset === 0 && startRank === 7) continue;
        twoSidedWait = true;
      }
    }
    if (!pairIsValueHonor && twoSidedWait) yaku.push({ name: "平和", han: 1 });
  }

  const suits = new Set(allTiles.filter((tile) => tile.suit !== "z").map((tile) => tile.suit));
  const hasHonors = allTiles.some((tile) => tile.suit === "z");
  if (suits.size === 1) {
    yaku.push({ name: hasHonors ? "混一色" : "清一色", han: hasHonors ? (closed ? 3 : 2) : (closed ? 6 : 5) });
  }
  return yaku;
}

function getWinInfo(hand, seat, tsumo, winningTile = null) {
  const closed = seat.melds.length === 0;
  const allTiles = [...hand, ...seat.melds.flatMap((meld) => meld.tiles)];
  const dora = getDoraCount(allTiles, seat.kita);
  let candidates = [];

  if (closed && isKokushi(hand)) {
    candidates.push([{ name: "國士無雙", han: 13, yakuman: true }]);
  } else if (closed && isSevenPairs(hand)) {
    const yaku = [{ name: "七對子", han: 2 }];
    if (seat.riichi) yaku.push({ name: "立直", han: 1 });
    if (tsumo) yaku.push({ name: "門前清自摸和", han: 1 });
    candidates.push(yaku);
  }

  for (const decomposition of getStandardDecompositions(hand, seat.melds.length)) {
    const yaku = [];
    if (seat.riichi && closed) yaku.push({ name: "立直", han: 1 });
    if (tsumo && closed) yaku.push({ name: "門前清自摸和", han: 1 });
    if (allTiles.every((tile) => tile.suit !== "z" && tile.rank >= 2 && tile.rank <= 8)) {
      yaku.push({ name: "斷么九", han: 1 });
    }
    yaku.push(...getDecompositionYaku(decomposition, seat, hand, winningTile, closed));
    candidates.push(yaku);
  }

  const valid = candidates
    .map((yaku) => {
      const yakuHan = yaku.reduce((total, item) => total + item.han, 0);
      if (yakuHan === 0) return null;
      const totalHan = yaku.some((item) => item.yakuman) ? 13 : yakuHan + dora;
      return { yaku, han: totalHan, dora, fu: yaku.some((item) => item.name === "七對子") ? 25 : 30 };
    })
    .filter(Boolean)
    .sort((a, b) => b.han - a.han);
  return valid[0] || null;
}

function canDeclareRiichi(seat) {
  if (seat.riichi || seat.melds.length || seat.score < 1000 || seat.hand.length < 14) return [];
  const options = [];
  for (let index = 0; index < seat.hand.length; index += 1) {
    const remaining = seat.hand.filter((_, tileIndexInHand) => tileIndexInHand !== index);
    if (getWaitIndices(remaining, seat).length) options.push(seat.hand[index]);
  }
  return options;
}

function createWallAndDeal() {
  wall = createWall();
  wallCursor = 0;
  doraIndicators = wall.slice(wall.length - DEAD_WALL_SIZE, wall.length - DEAD_WALL_SIZE + 5);
  for (const seat of players) {
    seat.hand = [];
    seat.melds = [];
    seat.discards = [];
    seat.kita = 0;
    seat.riichi = false;
    seat.temporaryFuriten = false;
    seat.permanentFuriten = false;
  }
  for (let tileNumber = 0; tileNumber < 13; tileNumber += 1) {
    for (let offset = 0; offset < players.length; offset += 1) {
      const seat = players[(currentDealer + offset) % players.length];
      seat.hand.push(wall[wallCursor++]);
    }
  }
  for (const seat of players) sortHand(seat.hand);
  lastDrawnId = null;
  pendingCall = null;
  lastDiscard = null;
  lastWinnerId = null;
  riichiMode = false;
  roundEnded = false;
  matchEnded = false;
  phase = "playing";
}

function startHand() {
  createWallAndDeal();
  renderAll();
  setTableMessage(`${players[currentDealer].name} 是莊家，開始摸牌。`);
  advanceTurn(currentDealer);
}

function setTableMessage(message) {
  elements.tableMessage.textContent = message;
}

function renderTileRow(container, tiles, small = false) {
  container.replaceChildren(...tiles.map((tile) => createTileFace(tile, small)));
}

function renderHand() {
  const seat = players[0];
  const buttons = seat.hand.map((tile, index) => createTileButton(tile, index));
  elements.hand.replaceChildren(...buttons);
  const playerRiver = document.querySelector("#discardsPlayer");
  renderTileRow(playerRiver, seat.discards, true);
  playerRiver.querySelectorAll(".tile-small").forEach((tileElement, index) => {
    tileElement.classList.toggle("last-discard", lastDiscard?.seat === seat.id && index === seat.discards.length - 1);
  });
  renderMelds(document.querySelector("#meldPlayer"), seat);
  document.querySelector("#scorePlayer").textContent = String(seat.score);
  document.querySelector("#riichiPlayer").classList.toggle("is-hidden", !seat.riichi);
  document.querySelector("#windPlayer").textContent = WIND_LABELS[seat.seatWind];
  document.querySelector("#kitaCount").textContent = `拔北 ${seat.kita}`;
}

function renderMelds(container, seat) {
  container.replaceChildren();
  for (const meld of seat.melds) {
    const group = document.createElement("span");
    group.className = "meld-group";
    for (const tile of meld.tiles) group.append(createTileFace(tile, true));
    container.append(group);
  }
}

function renderOpponent(seat, ids) {
  const [handId, meldId, discardsId, scoreId, riichiId] = ids;
  const hiddenHand = document.querySelector(`#${handId}`);
  const backs = Array.from({ length: seat.hand.length }, () => {
    const back = document.createElement("span");
    back.className = "tile-back";
    return back;
  });
  hiddenHand.replaceChildren(...backs);
  renderMelds(document.querySelector(`#${meldId}`), seat);
  const discardContainer = document.querySelector(`#${discardsId}`);
  renderTileRow(discardContainer, seat.discards, true);
  discardContainer.querySelectorAll(".tile-small").forEach((tileElement, index) => {
    tileElement.classList.toggle("last-discard", lastDiscard?.seat === seat.id && index === seat.discards.length - 1);
  });
  document.querySelector(`#${scoreId}`).textContent = String(seat.score);
  document.querySelector(`#${riichiId}`).classList.toggle("is-hidden", !seat.riichi);
}

function updateWindsAndScores() {
  for (const seat of players) seat.seatWind = (seat.id - currentDealer + players.length) % players.length;
  document.querySelector("#windPlayer").textContent = WIND_LABELS[players[0].seatWind];
  document.querySelector("#windSouth").textContent = WIND_LABELS[players[1].seatWind];
  document.querySelector("#windWest").textContent = WIND_LABELS[players[2].seatWind];
  document.querySelector("#windSummaryPlayer").textContent = WIND_LABELS[players[0].seatWind];
  document.querySelector("#windSummarySouth").textContent = WIND_LABELS[players[1].seatWind];
  document.querySelector("#windSummaryWest").textContent = WIND_LABELS[players[2].seatWind];
  document.querySelector("#scoreSummaryPlayer").textContent = String(players[0].score);
  document.querySelector("#scoreSummarySouth").textContent = String(players[1].score);
  document.querySelector("#scoreSummaryWest").textContent = String(players[2].score);
  document.querySelector("#handNumber").textContent = `東${["一", "二", "三", "四"][eastHand - 1]}局`;
  document.querySelector("#roundWind").textContent = "東";
  document.querySelector("#roundNumber").textContent = `${["一", "二", "三", "四"][eastHand - 1]}局`;
  document.querySelector("#wallCount").textContent = String(liveWallCount());
}

function renderDora() {
  const doraElement = document.querySelector("#doraTiles");
  doraElement.replaceChildren(createTileFace(doraIndicators[0], true));
}

function renderControls() {
  const seat = players[0];
  const playerTurn = phase === "player";
  const currentWin = playerTurn ? getWinInfo(seat.hand, seat, true, seat.hand.find((tile) => tile.id === lastDrawnId)) : null;
  const riichiOptions = playerTurn ? canDeclareRiichi(seat) : [];
  const canKita = playerTurn && !seat.riichi && lastDrawnId !== null
    && seat.hand.some((tile) => tile.suit === "z" && tile.rank === 4);

  elements.tsumoButton.classList.toggle("is-hidden", !currentWin);
  elements.riichiButton.classList.toggle("is-hidden", !riichiOptions.length || seat.riichi || riichiMode);
  elements.kitaButton.classList.toggle("is-hidden", !canKita);
  elements.callPanel.classList.toggle("is-hidden", phase !== "claim");
  document.querySelector("#turnTitle").textContent = playerTurn
    ? (riichiMode ? "選一張牌宣告立直" : "選一張牌打出")
    : phase === "claim" ? "對手打出了一張牌" : phase === "ended" ? "本局已結束" : "對手思考中…";
  document.querySelector("#turnDescription").textContent = playerTurn
    ? seat.riichi ? "已立直，只能打出剛摸進來的牌；摸到北牌時仍可拔北。" : "點擊手牌即可打牌。門前聽牌時可宣告立直。"
    : phase === "claim" ? "可榮和或碰牌，也可以略過，繼續下一位對手的回合。" : "AI 正在整理手牌。";
}

function renderAll() {
  renderHand();
  renderOpponent(players[1], ["handSouth", "meldSouth", "discardsSouth", "scoreSouth", "riichiSouth"]);
  renderOpponent(players[2], ["handWest", "meldWest", "discardsWest", "scoreWest", "riichiWest"]);
  updateWindsAndScores();
  renderDora();
  renderControls();
}

function getCallOptions(tile, fromSeat) {
  const player = players[0];
  const ronInfo = !isFuriten(player) ? getWinInfo([...player.hand, tile], player, false, tile) : null;
  const matchingCount = player.hand.filter((handTile) => tileIndex(handTile) === tileIndex(tile)).length;
  return { ron: ronInfo, pon: !player.riichi && matchingCount >= 2 };
}

function offerCall(tile, fromSeat, nextSeat) {
  const options = getCallOptions(tile, fromSeat);
  if (!options.ron && !options.pon) return false;
  pendingCall = { tile, fromSeat, nextSeat, options };
  phase = "claim";
  elements.callButtons.replaceChildren();
  elements.callPrompt.textContent = `${players[fromSeat].name} 打出 ${tileName(tile)}`;
  if (options.ron) {
    addCallButton("榮和", "ron", () => finishRound(0, fromSeat, "ron", options.ron), true);
  }
  if (options.pon) {
    addCallButton("碰", "pon", () => claimPon(tile, fromSeat));
  }
  addCallButton("跳過", "pass", () => passCall(options.ron, nextSeat));
  renderAll();
  setTableMessage(options.ron ? "你可以榮和這張牌。" : "你可以碰牌，或選擇跳過。");
  return true;
}

function addCallButton(label, kind, callback, important = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `call-button${important ? " ron-button" : ""}`;
  button.dataset.call = kind;
  button.textContent = label;
  button.addEventListener("click", callback);
  elements.callButtons.append(button);
}

function passCall(ronWasAvailable, nextSeat) {
  if (ronWasAvailable) {
    if (players[0].riichi) players[0].permanentFuriten = true;
    else players[0].temporaryFuriten = true;
  }
  pendingCall = null;
  phase = "playing";
  renderAll();
  advanceTurn(nextSeat);
}

function claimPon(tile, fromSeat) {
  const player = players[0];
  const index = tileIndex(tile);
  const claimed = [tile];
  for (let copy = 0; copy < 2; copy += 1) {
    const handIndex = player.hand.findIndex((handTile) => tileIndex(handTile) === index);
    if (handIndex < 0) return;
    claimed.push(player.hand.splice(handIndex, 1)[0]);
  }
  player.melds.push({ type: "pon", tiles: claimed, open: true, fromSeat });
  players[fromSeat].discards.pop();
  lastDiscard = null;
  lastDrawnId = null;
  pendingCall = null;
  riichiMode = false;
  phase = "player";
  renderAll();
  setTableMessage(`你碰了 ${tileName(tile)}，請打出一張牌。`);
}

function discardPlayerTile(tileId, handIndex) {
  if (phase !== "player" || roundEnded) return;
  const seat = players[0];
  const tile = seat.hand.find((handTile) => handTile.id === tileId);
  if (!tile) return;
  if (seat.riichi && tileId !== lastDrawnId) {
    setTableMessage("已立直後只能打出剛摸進來的牌。");
    return;
  }
  if (riichiMode && !canDeclareRiichi(seat).some((option) => option.id === tileId)) {
    setTableMessage("打出這張牌後還沒有聽牌，請選擇另一張。");
    return;
  }
  if (riichiMode) {
    seat.riichi = true;
    seat.score -= 1000;
    riichiMode = false;
  }

  const actualIndex = seat.hand.findIndex((handTile) => handTile.id === tileId);
  const [discarded] = seat.hand.splice(actualIndex, 1);
  seat.discards.push(discarded);
  lastDrawnId = null;
  lastDiscard = { seat: seat.id, tile: discarded };
  phase = "playing";
  renderAll();
  setTableMessage(seat.riichi ? `立直！打出 ${tileName(discarded)}。` : `你打出 ${tileName(discarded)}。`);
  resolveHumanDiscard(discarded);
}

async function resolveHumanDiscard(discarded) {
  for (const seat of players.slice(1)) {
    const ronInfo = !isFuriten(seat) ? getWinInfo([...seat.hand, discarded], seat, false, discarded) : null;
    if (ronInfo) {
      finishRound(seat.id, 0, "ron", ronInfo);
      return;
    }
  }
  await advanceTurn((0 + 1) % players.length);
}

function findDiscardIndex(hand) {
  const counts = countTiles(hand);
  let bestIndex = 0;
  let lowestValue = Infinity;
  for (let index = 0; index < hand.length; index += 1) {
    const tile = hand[index];
    const type = tileIndex(tile);
    const count = counts[type];
    let value = count > 1 ? 1.45 + count * .15 : 0;
    if (type < 27) {
      const rank = tile.rank;
      const start = type - (rank - 1);
      for (const offset of [-2, -1, 1, 2]) {
        const neighborRank = rank + offset;
        if (neighborRank < 1 || neighborRank > 9) continue;
        const neighborType = start + neighborRank - 1;
        value += counts[neighborType] * (Math.abs(offset) === 1 ? 1.1 : .45);
      }
    } else if (count > 1) {
      value += 1;
    }
    if (tile.red) value += 1.4;
    if (doraIndicators.some((indicator) => getDoraIndex(tileIndex(indicator)) === type)) value += 1;
    if ((tile.suit === "z" || tile.rank === 1 || tile.rank === 9) && count === 1) value -= .45;
    if (value < lowestValue) {
      lowestValue = value;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function findAiRiichiDiscard(seat) {
  if (seat.riichi || seat.melds.length || seat.score < 1000) return null;
  for (let index = 0; index < seat.hand.length; index += 1) {
    const tile = seat.hand[index];
    const remaining = seat.hand.filter((_, handIndex) => handIndex !== index);
    if (getWaitIndices(remaining, seat).length) return tile;
  }
  return null;
}

function tryAiKita(seat) {
  if (seat.riichi) return false;
  const northIndex = seat.hand.findIndex((tile) => tile.suit === "z" && tile.rank === 4);
  if (northIndex < 0 || liveWallCount() <= 1) return false;
  if (seat.hand.filter((tile) => tile.suit === "z" && tile.rank === 4).length > 1) return false;
  seat.hand.splice(northIndex, 1);
  seat.kita += 1;
  return drawTile(seat);
}

async function advanceTurn(seatId) {
  let nextSeatId = seatId;
  while (!roundEnded && phase !== "claim") {
    const seat = players[nextSeatId];
    if (!seat || liveWallCount() <= 0) {
      finishDraw();
      return;
    }
    if (nextSeatId === 0) {
      drawTile(seat);
      phase = "player";
      renderAll();
      const win = getWinInfo(seat.hand, seat, true, seat.hand.find((tile) => tile.id === lastDrawnId));
      setTableMessage(win ? "自摸！你可以直接和牌。" : "你的回合：摸牌後，選一張牌打出。");
      return;
    }

    phase = "playing";
    setTableMessage(`${seat.name} 正在摸牌與整理手牌…`);
    renderAll();
    await new Promise((resolve) => {
      delayHandle = setTimeout(resolve, 420);
    });
    if (roundEnded) return;

    const drawn = drawTile(seat);
    if (!drawn) {
      finishDraw();
      return;
    }
    let win = getWinInfo(seat.hand, seat, true, drawn);
    if (win) {
      finishRound(seat.id, null, "tsumo", win);
      return;
    }
    let riichiDiscard = null;
    if (!seat.riichi && Math.random() < .72) {
      riichiDiscard = findAiRiichiDiscard(seat);
      if (riichiDiscard) {
        seat.riichi = true;
        seat.score -= 1000;
      }
    }
    const kitaDraw = tryAiKita(seat);
    if (kitaDraw) {
      win = getWinInfo(seat.hand, seat, true, kitaDraw);
      if (win) {
        finishRound(seat.id, null, "tsumo", win);
        return;
      }
    }
    const discardIndex = riichiDiscard
      ? seat.hand.findIndex((tile) => tile.id === riichiDiscard.id)
      : seat.riichi
      ? seat.hand.findIndex((tile) => tile.id === drawn.id)
      : findDiscardIndex(seat.hand);
    const [discarded] = seat.hand.splice(Math.max(0, discardIndex), 1);
    seat.discards.push(discarded);
    lastDiscard = { seat: seat.id, tile: discarded };
    renderAll();
    setTableMessage(`${seat.name}${seat.riichi ? " 立直後打出" : " 打出"} ${tileName(discarded)}。`);

    const callAvailable = offerCall(discarded, seat.id, (seat.id + 1) % players.length);
    if (callAvailable) return;
    nextSeatId = (seat.id + 1) % players.length;
  }
}

function calculateBasePoints(info) {
  if (info.han >= 13) return 32000;
  const base = info.fu * 2 ** (info.han + 2);
  if (info.han >= 11) return 24000;
  if (info.han >= 8) return 16000;
  if (info.han >= 6) return 12000;
  if (info.han >= 5 || base >= 2000) return 8000;
  return base;
}

function roundHundred(points) {
  return Math.ceil(points / 100) * 100;
}

function finishRound(winnerId, loserId, method, info) {
  if (roundEnded) return;
  roundEnded = true;
  lastWinnerId = winnerId;
  phase = "ended";
  pendingCall = null;
  const base = calculateBasePoints(info);
  const honbaBonus = honba * 100;
  if (method === "ron") {
    const payment = roundHundred(base * (winnerId === currentDealer ? 6 : 4) + honba * 300);
    players[winnerId].score += payment;
    players[loserId].score -= payment;
  } else {
    for (const payer of players) {
      if (payer.id === winnerId) continue;
      let payment = roundHundred(base * (winnerId === currentDealer || payer.id === currentDealer ? 2 : 1) + honbaBonus);
      if (payment > payer.score + 50000) payment = Math.max(0, payer.score + 50000);
      payer.score -= payment;
      players[winnerId].score += payment;
    }
  }
  const winner = players[winnerId];
  const methodLabel = method === "tsumo" ? "自摸" : "榮和";
  const yakuText = info.yaku.map((yaku) => yaku.name).join("、");
  const doraText = info.dora ? `、寶牌 ${info.dora} 番` : "";
  const resultTitle = winnerId === 0 ? `${methodLabel}！恭喜和牌` : `${winner.name}${methodLabel}`;
  document.querySelector("#resultTitle").textContent = resultTitle;
  document.querySelector("#resultDetails").textContent = `${yakuText}${doraText} · ${info.han} 番 · ${info.fu} 符`;
  document.querySelector("#roundResult").classList.remove("is-hidden");
  document.querySelector("#nextHandButton").textContent = winnerId === currentDealer ? "連莊，開始下一局" : "下一局";
  if (matchEnded) document.querySelector("#nextHandButton").textContent = "重新開始東風戰";
  setTableMessage(`${winner.name} 以${methodLabel}結束本局。`);
  renderAll();
}

function finishDraw() {
  if (roundEnded) return;
  roundEnded = true;
  lastWinnerId = null;
  phase = "ended";
  matchEnded = eastHand >= 4;
  document.querySelector("#resultTitle").textContent = "流局";
  document.querySelector("#resultDetails").textContent = "牌山已空，本局無人和牌。";
  document.querySelector("#roundResult").classList.remove("is-hidden");
  document.querySelector("#nextHandButton").textContent = matchEnded ? "重新開始東風戰" : "下一局";
  setTableMessage("牌山已空，本局流局。");
  renderAll();
}

function startNextHand() {
  if (!roundEnded) return;
  const dealerWon = lastWinnerId === currentDealer;
  if (matchEnded) {
    for (const seat of players) seat.score = STARTING_POINTS;
    currentDealer = 0;
    eastHand = 1;
    honba = 0;
    matchEnded = false;
  } else if (dealerWon) {
    honba += 1;
  } else {
    currentDealer = (currentDealer + 1) % players.length;
    eastHand += 1;
    honba = 0;
    if (eastHand > 4) matchEnded = true;
  }
  document.querySelector("#roundResult").classList.add("is-hidden");
  if (matchEnded) {
    document.querySelector("#resultTitle").textContent = "東風戰結束";
    document.querySelector("#resultDetails").textContent = "四局結束，點擊下方按鈕開啟新一場東風戰。";
    document.querySelector("#roundResult").classList.remove("is-hidden");
    document.querySelector("#nextHandButton").textContent = "重新開始東風戰";
    roundEnded = true;
    phase = "ended";
    return;
  }
  startHand();
}

function initialGame() {
  currentDealer = 0;
  eastHand = 1;
  honba = 0;
  matchEnded = false;
  lastWinnerId = null;
  startHand();
}

document.querySelector("#tsumoButton").addEventListener("click", () => {
  const seat = players[0];
  const info = getWinInfo(seat.hand, seat, true, seat.hand.find((tile) => tile.id === lastDrawnId));
  if (info) finishRound(0, null, "tsumo", info);
});

document.querySelector("#riichiButton").addEventListener("click", () => {
  if (!canDeclareRiichi(players[0]).length) return;
  riichiMode = true;
  setTableMessage("立直宣告中：請選擇打出後仍然聽牌的牌。");
  renderAll();
});

document.querySelector("#kitaButton").addEventListener("click", () => {
  const seat = players[0];
  if (phase !== "player" || seat.riichi || liveWallCount() <= 0) return;
  if (lastDrawnId === null) return;
  const northIndex = seat.hand.findIndex((tile) => tile.suit === "z" && tile.rank === 4);
  if (northIndex < 0) return;
  seat.hand.splice(northIndex, 1);
  seat.kita += 1;
  drawTile(seat);
  renderAll();
  setTableMessage("拔北完成，北牌計為一番寶牌；請打出一張牌。");
});

document.querySelector("#nextHandButton").addEventListener("click", startNextHand);
document.querySelector("#restartButton").addEventListener("click", () => {
  clearTimeout(delayHandle);
  for (const seat of players) seat.score = STARTING_POINTS;
  document.querySelector("#roundResult").classList.add("is-hidden");
  initialGame();
});

initialGame();
