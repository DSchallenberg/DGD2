const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 8;
const JOKER_RANK = 13;

const rankNames = {
  1: '👑 Regent',
  2: '⛪ Erzbischof',
  3: '🛡️ Hofmarschall',
  4: '💎 Baronin',
  5: '📜 Äbtissin',
  6: '⚔️ Ritter',
  7: '🧵 Näherin',
  8: '🪨 Steinmetz',
  9: '🍲 Köchin',
  10: '🐑 Schafhirtin',
  11: '⛏️ Bergmann',
  12: '🧺 Tagelöhner',
  13: '🃏 Narr'
};

const rooms = new Map();

function createDeck() {
  const deck = [];
  for (let rank = 1; rank <= 12; rank += 1) {
    for (let i = 0; i < rank; i += 1) deck.push({ id: `r${rank}-${i}`, rank, joker: false });
  }
  deck.push({ id: 'j-0', rank: JOKER_RANK, joker: true });
  deck.push({ id: 'j-1', rank: JOKER_RANK, joker: true });
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sortHand(hand) {
  hand.sort((x, y) => x.rank - y.rank || Number(x.joker) - Number(y.joker));
}

function getSeatTitle(idx, total) {
  if (idx === 0) return 'Großer Regent';
  if (idx === 1) return 'Kleiner Regent';
  if (idx === total - 2) return 'Kleiner Diener';
  if (idx === total - 1) return 'Großer Diener';
  return 'Adel';
}

function createRoom(roomId, settings) {
  const room = {
    id: roomId,
    settings,
    players: [],
    round: 0,
    status: 'lobby',
    chat: [],
    turnId: null,
    currentTrick: null,
    finishOrder: [],
    exchange: null,
    revolution: null
  };
  rooms.set(roomId, room);
  return room;
}

function findRoom(roomId) {
  return rooms.get(roomId);
}

function addChat(room, payload) {
  room.chat.push({ id: `${Date.now()}-${Math.random()}`, ...payload });
  if (room.chat.length > 120) room.chat.shift();
}

function roomPublicState(room) {
  return {
    id: room.id,
    status: room.status,
    round: room.round,
    maxRounds: room.settings.rounds,
    settings: room.settings,
    turnId: room.turnId,
    currentTrick: room.currentTrick,
    exchange: room.exchange
      ? { pendingIds: [...room.exchange.pendingIds], complete: room.exchange.complete }
      : null,
    revolution: room.revolution,
    players: room.players.map((p, idx) => ({
      id: p.id,
      playerKey: p.playerKey,
      name: p.name,
      bot: p.bot,
      connected: p.connected,
      points: p.points,
      cards: p.hand.length,
      finished: p.finished,
      seatTitle: getSeatTitle(idx, room.players.length)
    })),
    chat: room.chat
  };
}

function sendRoom(room) {
  io.to(room.id).emit('roomUpdate', roomPublicState(room));
  room.players.forEach((p) => {
    if (!p.bot && p.socketId) {
      io.to(p.socketId).emit('handUpdate', { roomId: room.id, hand: p.hand });
    }
  });
}

function addPlayer(room, { name, playerKey, socketId, bot = false, hand = [], points = 0 }) {
  if (room.players.length >= room.settings.maxPlayers) return null;
  const player = {
    id: bot ? `bot-${Date.now()}-${Math.random()}` : socketId,
    socketId: bot ? null : socketId,
    playerKey,
    name,
    bot,
    connected: !bot,
    points,
    hand,
    passed: false,
    finished: false,
    takeoverKey: null
  };
  room.players.push(player);
  return player;
}

function replaceWithBot(room, player) {
  const idx = room.players.findIndex((p) => p.id === player.id);
  if (idx < 0) return;
  const bot = {
    id: `bot-${Date.now()}-${Math.random()}`,
    socketId: null,
    playerKey: null,
    name: `🤖 ${player.name}`,
    bot: true,
    connected: true,
    points: player.points,
    hand: player.hand,
    passed: player.passed,
    finished: player.finished,
    takeoverKey: player.playerKey
  };
  room.players[idx] = bot;
}

function reclaimFromBot(room, socket, name, playerKey) {
  const idx = room.players.findIndex((p) => p.bot && p.takeoverKey === playerKey);
  if (idx < 0) return null;
  const bot = room.players[idx];
  const human = {
    id: socket.id,
    socketId: socket.id,
    playerKey,
    name: name || bot.name.replace(/^🤖\s*/, ''),
    bot: false,
    connected: true,
    points: bot.points,
    hand: bot.hand,
    passed: bot.passed,
    finished: bot.finished,
    takeoverKey: null
  };
  room.players[idx] = human;
  return human;
}

function findHumanByKey(room, playerKey) {
  return room.players.find((p) => !p.bot && p.playerKey === playerKey);
}

function dealRound(room) {
  const deck = shuffle(createDeck());
  room.players.forEach((p) => {
    p.hand = [];
    p.passed = false;
    p.finished = false;
  });
  let i = 0;
  while (deck.length) {
    room.players[i % room.players.length].hand.push(deck.pop());
    i += 1;
  }
  room.players.forEach((p) => sortHand(p.hand));
}

function swapSeatsOnAufstand(room) {
  for (let i = 0; i < Math.floor(room.players.length / 2); i += 1) {
    const j = room.players.length - 1 - i;
    [room.players[i], room.players[j]] = [room.players[j], room.players[i]];
  }
}

function beginRound(room) {
  room.round += 1;
  room.status = 'dealing';
  room.currentTrick = null;
  room.turnId = null;
  room.finishOrder = [];
  room.revolution = null;
  room.exchange = null;

  dealRound(room);

  const jokersHolder = room.players.find((p) => p.hand.filter((c) => c.joker).length === 2);
  const greatServant = room.players[room.players.length - 1];
  if (greatServant && greatServant.hand.filter((c) => c.joker).length === 2) {
    room.revolution = { type: 'aufstand', by: greatServant.id };
    swapSeatsOnAufstand(room);
    room.status = 'playing';
    room.turnId = room.players[0].id;
    return;
  }
  if (jokersHolder) {
    room.revolution = { type: 'revolution', by: jokersHolder.id };
    room.status = 'playing';
    room.turnId = room.players[0].id;
    return;
  }

  room.status = 'exchange';
  const pendingIds = new Set();
  if (room.players[0]) pendingIds.add(room.players[0].id);
  if (room.players[1]) pendingIds.add(room.players[1].id);
  room.exchange = { pendingIds, complete: false, picks: {} };
}

function toPlayCombo(cards) {
  const jokers = cards.filter((c) => c.joker);
  const non = cards.filter((c) => !c.joker);
  const nonRanks = [...new Set(non.map((c) => c.rank))];
  if (nonRanks.length > 1) return null;
  const rank = non.length ? non[0].rank : JOKER_RANK;
  return { rank, count: cards.length, jokers: jokers.length };
}

function validatePlay(room, player, ids) {
  if (!Array.isArray(ids) || ids.length < 1) return { ok: false, reason: 'Keine Karten ausgewählt.' };
  const cards = ids.map((id) => player.hand.find((c) => c.id === id)).filter(Boolean);
  if (cards.length !== ids.length) return { ok: false, reason: 'Ungültige Karten.' };
  const combo = toPlayCombo(cards);
  if (!combo) return { ok: false, reason: 'Nur gleiche Ränge plus Narren erlaubt.' };
  if (room.currentTrick) {
    if (combo.count !== room.currentTrick.count) return { ok: false, reason: 'Falsche Satzgröße.' };
    if (combo.rank >= room.currentTrick.rank) return { ok: false, reason: 'Satz muss stärker sein.' };
  }
  return { ok: true, combo, cards };
}

function removeCards(player, cards) {
  cards.forEach((c) => {
    const i = player.hand.findIndex((x) => x.id === c.id);
    if (i >= 0) player.hand.splice(i, 1);
  });
  sortHand(player.hand);
}

function activePlayers(room) {
  return room.players.filter((p) => !p.finished);
}

function nextActive(room, fromId) {
  const idx = room.players.findIndex((p) => p.id === fromId);
  if (idx < 0) return null;
  for (let step = 1; step <= room.players.length; step += 1) {
    const p = room.players[(idx + step) % room.players.length];
    if (!p.finished) return p;
  }
  return null;
}

function maybeEndTrick(room) {
  if (!room.currentTrick) return;
  const actives = activePlayers(room);
  if (actives.length <= 1) return;
  const lead = room.currentTrick.by;
  const done = actives.every((p) => p.id === lead || p.passed);
  if (!done) return;
  const leadPlayer = room.players.find((p) => p.id === lead);
  room.players.forEach((p) => { p.passed = false; });
  room.currentTrick = null;
  if (leadPlayer && !leadPlayer.finished) {
    room.turnId = leadPlayer.id;
  } else {
    const n = actives.find((p) => !p.finished);
    room.turnId = n ? n.id : null;
  }
}

function roundOver(room) {
  const remain = activePlayers(room);
  if (remain.length > 1) return false;
  if (remain.length === 1 && !room.finishOrder.includes(remain[0].id)) room.finishOrder.push(remain[0].id);

  room.finishOrder.forEach((pid, idx) => {
    const p = room.players.find((x) => x.id === pid);
    if (p) p.points += Math.max(room.players.length - 1 - idx, 0);
  });

  const reordered = room.finishOrder.map((pid) => room.players.find((p) => p.id === pid)).filter(Boolean);
  if (reordered.length === room.players.length) room.players = reordered;

  room.status = room.round >= room.settings.rounds ? 'gameOver' : 'roundEnd';
  room.turnId = null;
  room.currentTrick = null;
  return true;
}

function topNonJokers(hand, count) {
  return [...hand].filter((c) => !c.joker).sort((a, b) => a.rank - b.rank).slice(0, count);
}

function doExchange(room, player, ids) {
  if (!room.exchange || room.exchange.complete) return { ok: false, reason: 'Kein Austausch aktiv.' };
  if (!room.exchange.pendingIds.has(player.id)) return { ok: false, reason: 'Du bist nicht Austauschspieler.' };
  const need = room.players[0] && player.id === room.players[0].id ? 2 : 1;
  if (ids.length !== need) return { ok: false, reason: `Bitte ${need} Karten wählen.` };
  const cards = ids.map((id) => player.hand.find((c) => c.id === id)).filter(Boolean);
  if (cards.length !== need) return { ok: false, reason: 'Ungültige Karten.' };
  if (cards.some((c) => c.joker)) return { ok: false, reason: 'Narren dürfen nicht getauscht werden.' };

  room.exchange.picks[player.id] = cards;
  room.exchange.pendingIds.delete(player.id);

  if (room.exchange.pendingIds.size === 0) {
    const greatRegent = room.players[0];
    const littleRegent = room.players[1];
    const littleServant = room.players[room.players.length - 2];
    const greatServant = room.players[room.players.length - 1];

    const transfer = (regent, servant, given) => {
      given.forEach((g) => {
        regent.hand = regent.hand.filter((h) => h.id !== g.id);
        servant.hand.push(g);
      });
      const back = topNonJokers(servant.hand, given.length);
      back.forEach((b) => {
        servant.hand = servant.hand.filter((h) => h.id !== b.id);
        regent.hand.push(b);
      });
      sortHand(regent.hand);
      sortHand(servant.hand);
    };

    if (greatRegent && greatServant) transfer(greatRegent, greatServant, room.exchange.picks[greatRegent.id]);
    if (littleRegent && littleServant) transfer(littleRegent, littleServant, room.exchange.picks[littleRegent.id]);

    room.exchange.complete = true;
    room.status = 'playing';
    room.turnId = room.players[0].id;
  }

  return { ok: true };
}

function groupNonJoker(hand) {
  const map = new Map();
  hand.filter((c) => !c.joker).forEach((c) => {
    if (!map.has(c.rank)) map.set(c.rank, []);
    map.get(c.rank).push(c);
  });
  return map;
}

function chooseBotPlay(hand, trick) {
  const jokers = hand.filter((c) => c.joker);
  const grouped = groupNonJoker(hand);
  const options = [];
  grouped.forEach((cards, rank) => {
    const max = cards.length + jokers.length;
    for (let count = 1; count <= max; count += 1) {
      const natural = cards.slice(0, Math.min(cards.length, count));
      const needJ = Math.max(0, count - natural.length);
      if (needJ <= jokers.length) options.push({ rank, count, cards: [...natural, ...jokers.slice(0, needJ)] });
    }
  });

  options.sort((a, b) => {
    if (!trick) {
      if (a.count !== b.count) return a.count - b.count;
      return b.rank - a.rank;
    }
    return b.rank - a.rank;
  });

  if (!trick) return options[0]?.cards ?? null;
  return options.find((o) => o.count === trick.count && o.rank < trick.rank)?.cards ?? null;
}

function runBot(room) {
  if (room.status === 'exchange') {
    if (!room.exchange || room.exchange.complete) return;
    room.players.forEach((p) => {
      if (!p.bot) return;
      if (!room.exchange.pendingIds.has(p.id)) return;
      const need = room.players[0] && p.id === room.players[0].id ? 2 : 1;
      const pick = [...p.hand].filter((c) => !c.joker).sort((a, b) => b.rank - a.rank).slice(0, need);
      if (pick.length === need) doExchange(room, p, pick.map((x) => x.id));
    });
    return;
  }

  if (room.status !== 'playing') return;
  const bot = room.players.find((p) => p.id === room.turnId && p.bot);
  if (!bot) return;

  const playCards = chooseBotPlay(bot.hand, room.currentTrick);
  if (!playCards) {
    bot.passed = true;
    addChat(room, { system: true, text: `${bot.name} passt.` });
    maybeEndTrick(room);
    if (room.currentTrick) room.turnId = nextActive(room, bot.id)?.id ?? null;
    return;
  }

  const valid = validatePlay(room, bot, playCards.map((c) => c.id));
  if (!valid.ok) {
    bot.passed = true;
    room.turnId = nextActive(room, bot.id)?.id ?? null;
    return;
  }

  removeCards(bot, valid.cards);
  room.currentTrick = {
    rank: valid.combo.rank,
    count: valid.combo.count,
    by: bot.id,
    displayName: rankNames[valid.combo.rank]
  };
  room.players.forEach((p) => { p.passed = false; });
  addChat(room, { system: true, text: `${bot.name} spielt ${valid.combo.count}× ${rankNames[valid.combo.rank]}.` });

  if (bot.hand.length === 0 && !bot.finished) {
    bot.finished = true;
    room.finishOrder.push(bot.id);
  }

  if (!roundOver(room)) {
    room.turnId = nextActive(room, bot.id)?.id ?? null;
    maybeEndTrick(room);
  }
}

function ensureMinPlayersWithBots(room) {
  while (room.players.length < room.settings.maxPlayers) {
    addPlayer(room, { name: `🤖 Bot ${room.players.length + 1}`, playerKey: null, socketId: null, bot: true });
  }
}

function registerOrReconnect({ socket, room, roomId, name, playerKey }) {
  const existingHuman = findHumanByKey(room, playerKey);
  if (existingHuman) {
    existingHuman.socketId = socket.id;
    existingHuman.id = socket.id;
    existingHuman.name = name || existingHuman.name;
    existingHuman.connected = true;
    socket.join(roomId);
    addChat(room, { system: true, text: `${existingHuman.name} ist zurück.` });
    return { ok: true, player: existingHuman };
  }

  const reclaimed = reclaimFromBot(room, socket, name, playerKey);
  if (reclaimed) {
    socket.join(roomId);
    addChat(room, { system: true, text: `${reclaimed.name} übernimmt wieder den Sitz.` });
    return { ok: true, player: reclaimed };
  }

  if (room.players.length >= room.settings.maxPlayers) return { ok: false, reason: 'Raum voll.' };
  const p = addPlayer(room, { name, playerKey, socketId: socket.id, bot: false });
  if (!p) return { ok: false, reason: 'Konnte nicht beitreten.' };
  socket.join(roomId);
  addChat(room, { system: true, text: `${name} ist beigetreten.` });
  return { ok: true, player: p };
}

io.on('connection', (socket) => {
  socket.on('create', ({ roomId, name, maxPlayers, rounds, autoFillBots, playerKey }) => {
    if (!roomId || !name || !playerKey) return socket.emit('errorMessage', 'Name, Raum und Key erforderlich.');
    const settings = {
      maxPlayers: Math.min(Math.max(Number(maxPlayers) || 4, MIN_PLAYERS), MAX_PLAYERS),
      rounds: Math.min(Math.max(Number(rounds) || 10, 1), 30),
      autoFillBots: Boolean(autoFillBots)
    };
    const room = findRoom(roomId) || createRoom(roomId, settings);
    const res = registerOrReconnect({ socket, room, roomId, name, playerKey });
    if (!res.ok) return socket.emit('errorMessage', res.reason);
    sendRoom(room);
  });

  socket.on('join', ({ roomId, name, playerKey }) => {
    const room = findRoom(roomId);
    if (!room) return socket.emit('errorMessage', 'Raum nicht gefunden.');
    const res = registerOrReconnect({ socket, room, roomId, name, playerKey });
    if (!res.ok) return socket.emit('errorMessage', res.reason);
    sendRoom(room);
  });

  socket.on('leaveRoom', ({ roomId, playerKey }) => {
    const room = findRoom(roomId);
    if (!room) return;
    const p = room.players.find((x) => !x.bot && x.playerKey === playerKey);
    if (!p) return;

    socket.leave(roomId);

    if (room.status === 'lobby') {
      room.players = room.players.filter((x) => x !== p);
      addChat(room, { system: true, text: `${p.name} hat den Raum verlassen.` });
    } else {
      replaceWithBot(room, p);
      addChat(room, { system: true, text: `${p.name} hat verlassen. Bot übernimmt den Sitz.` });
    }
    sendRoom(room);
  });

  socket.on('addBot', ({ roomId }) => {
    const room = findRoom(roomId);
    if (!room) return socket.emit('errorMessage', 'Raum nicht gefunden.');
    if (room.players.length >= room.settings.maxPlayers) return socket.emit('errorMessage', 'Raum ist voll.');
    addPlayer(room, { name: `🤖 Bot ${room.players.length + 1}`, playerKey: null, socketId: null, bot: true });
    addChat(room, { system: true, text: 'Ein Bot wurde hinzugefügt.' });
    sendRoom(room);
  });

  socket.on('start', ({ roomId, autoFillBots }) => {
    const room = findRoom(roomId);
    if (!room) return socket.emit('errorMessage', 'Raum nicht gefunden.');
    room.settings.autoFillBots = Boolean(autoFillBots);
    if (room.settings.autoFillBots) ensureMinPlayersWithBots(room);
    if (room.players.length < MIN_PLAYERS) return socket.emit('errorMessage', `Mindestens ${MIN_PLAYERS} Spieler nötig.`);
    beginRound(room);
    addChat(room, { system: true, text: `Runde ${room.round} startet.` });
    sendRoom(room);
  });

  socket.on('exchange', ({ roomId, playerKey, cardIds }) => {
    const room = findRoom(roomId);
    if (!room) return;
    const p = room.players.find((x) => !x.bot && x.playerKey === playerKey);
    if (!p) return;
    const result = doExchange(room, p, cardIds || []);
    if (!result.ok) return socket.emit('errorMessage', result.reason);
    sendRoom(room);
  });

  socket.on('playCards', ({ roomId, playerKey, cardIds }) => {
    const room = findRoom(roomId);
    if (!room || room.status !== 'playing') return;
    const p = room.players.find((x) => !x.bot && x.playerKey === playerKey);
    if (!p) return;
    if (room.turnId !== p.id) return socket.emit('errorMessage', 'Du bist nicht am Zug.');

    const valid = validatePlay(room, p, cardIds || []);
    if (!valid.ok) return socket.emit('errorMessage', valid.reason);

    removeCards(p, valid.cards);
    room.currentTrick = {
      rank: valid.combo.rank,
      count: valid.combo.count,
      by: p.id,
      displayName: rankNames[valid.combo.rank]
    };
    room.players.forEach((x) => { x.passed = false; });
    addChat(room, { system: true, text: `${p.name} spielt ${valid.combo.count}× ${rankNames[valid.combo.rank]}.` });

    if (p.hand.length === 0 && !p.finished) {
      p.finished = true;
      room.finishOrder.push(p.id);
    }

    if (!roundOver(room)) {
      room.turnId = nextActive(room, p.id)?.id ?? null;
      maybeEndTrick(room);
    }

    sendRoom(room);
  });

  socket.on('pass', ({ roomId, playerKey }) => {
    const room = findRoom(roomId);
    if (!room || room.status !== 'playing') return;
    const p = room.players.find((x) => !x.bot && x.playerKey === playerKey);
    if (!p) return;
    if (room.turnId !== p.id) return socket.emit('errorMessage', 'Du bist nicht am Zug.');

    p.passed = true;
    addChat(room, { system: true, text: `${p.name} passt.` });
    maybeEndTrick(room);
    if (room.currentTrick) room.turnId = nextActive(room, p.id)?.id ?? null;

    sendRoom(room);
  });

  socket.on('chat', ({ roomId, playerKey, message }) => {
    const room = findRoom(roomId);
    if (!room || !message?.trim()) return;
    const p = room.players.find((x) => !x.bot && x.playerKey === playerKey);
    if (!p) return;
    addChat(room, { name: p.name, text: message.trim() });
    sendRoom(room);
  });

  socket.on('nextRound', ({ roomId }) => {
    const room = findRoom(roomId);
    if (!room || room.status !== 'roundEnd') return;
    beginRound(room);
    addChat(room, { system: true, text: `Runde ${room.round} startet.` });
    sendRoom(room);
  });

  socket.on('disconnect', () => {
    rooms.forEach((room) => {
      const p = room.players.find((x) => !x.bot && x.socketId === socket.id);
      if (!p) return;
      if (room.status === 'lobby') {
        room.players = room.players.filter((x) => x !== p);
        addChat(room, { system: true, text: `${p.name} hat die Lobby verlassen.` });
      } else {
        replaceWithBot(room, p);
        addChat(room, { system: true, text: `${p.name} ist getrennt. Bot übernimmt.` });
      }
      sendRoom(room);
    });
  });
});

setInterval(() => {
  rooms.forEach((room) => {
    if (room.status === 'playing' || room.status === 'exchange') {
      runBot(room);
      sendRoom(room);
    }
  });
}, 800);

server.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
