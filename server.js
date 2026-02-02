const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

const rooms = new Map();

const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const JOKER_RANK = 13;
const JOKER_COUNT = 2;

const RANK_NAMES = {
  1: 'Regent',
  2: 'Erzbischof',
  3: 'Hofmarschall',
  4: 'Baronin',
  5: 'Äbtissin',
  6: 'Ritter',
  7: 'Näherin',
  8: 'Steinmetz',
  9: 'Köchin',
  10: 'Schafhirtin',
  11: 'Bergmann',
  12: 'Tagelöhner',
  13: 'Narr'
};

const SEAT_TITLES = [
  'Großer Regent',
  'Kleiner Regent',
  'Adel',
  'Adel',
  'Adel',
  'Adel',
  'Kleiner Diener',
  'Großer Diener'
];

const MAX_PLAYERS = 8;
const MIN_PLAYERS = 4;

function createDeck() {
  const deck = [];
  RANKS.forEach((rank) => {
    for (let i = 0; i < rank; i += 1) {
      deck.push({ id: `r${rank}-${i}`, rank });
    }
  });
  for (let i = 0; i < JOKER_COUNT; i += 1) {
    deck.push({ id: `j${i}`, rank: JOKER_RANK, joker: true });
  }
  return deck;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function deal(deck, players) {
  players.forEach((player) => {
    player.hand = [];
    player.passed = false;
    player.finished = false;
  });
  let index = 0;
  while (deck.length) {
    const card = deck.pop();
    players[index % players.length].hand.push(card);
    index += 1;
  }
  players.forEach((player) => sortHand(player.hand));
}

function sortHand(hand) {
  hand.sort((a, b) => a.rank - b.rank);
}

function highestCards(hand, count) {
  const sorted = [...hand]
    .filter((card) => !card.joker)
    .sort((a, b) => a.rank - b.rank);
  const chosen = sorted.slice(0, count);
  return chosen;
}

function getRoomState(room) {
  return {
    id: room.id,
    status: room.status,
    settings: room.settings,
    round: room.round,
    maxRounds: room.settings.rounds,
    players: room.players.map((player, index) => ({
      id: player.id,
      name: player.name,
      bot: player.bot,
      points: player.points,
      seatTitle: seatTitle(index, room.players.length),
      cards: player.hand.length,
      finished: player.finished
    })),
    currentTrick: room.currentTrick,
    turnId: room.turnId,
    chat: room.chat,
    exchange: room.exchange,
    revolution: room.revolution
  };
}

function seatTitle(index, totalPlayers) {
  if (totalPlayers <= 2) {
    return 'Hof';
  }
  if (index === 0) return 'Großer Regent';
  if (index === 1) return 'Kleiner Regent';
  if (index === totalPlayers - 1) return 'Großer Diener';
  if (index === totalPlayers - 2) return 'Kleiner Diener';
  return 'Adel';
}

function roomBroadcast(room) {
  io.to(room.id).emit('roomUpdate', getRoomState(room));
  room.players.forEach((player) => {
    if (!player.bot) {
      io.to(player.id).emit('handUpdate', { roomId: room.id, hand: player.hand });
    }
  });
}

function addChat(room, message) {
  room.chat.push({
    id: `${Date.now()}-${Math.random()}`,
    ...message
  });
  if (room.chat.length > 100) {
    room.chat.shift();
  }
}

function findRoom(id) {
  return rooms.get(id);
}

function ensureRoom(id, settings) {
  const room = findRoom(id);
  if (room) return room;
  const created = {
    id,
    settings,
    players: [],
    status: 'lobby',
    round: 0,
    currentTrick: null,
    turnId: null,
    chat: [],
    exchange: null,
    revolution: null,
    lastMove: null,
    finishOrder: []
  };
  rooms.set(id, created);
  return created;
}

function addPlayer(room, socket, name, bot = false) {
  if (room.players.length >= room.settings.maxPlayers) return null;
  const player = {
    id: socket.id,
    name,
    bot,
    points: 0,
    hand: [],
    passed: false,
    finished: false
  };
  room.players.push(player);
  return player;
}

function addBot(room) {
  if (room.players.length >= room.settings.maxPlayers) return null;
  const botSocket = { id: `bot-${Date.now()}-${Math.random()}` };
  return addPlayer(room, botSocket, `Bot ${room.players.length + 1}`, true);
}

function removePlayer(room, socketId) {
  room.players = room.players.filter((player) => player.id !== socketId);
}

function nextActivePlayer(room, fromIndex) {
  const players = room.players;
  const total = players.length;
  for (let offset = 1; offset <= total; offset += 1) {
    const index = (fromIndex + offset) % total;
    if (!players[index].finished) {
      return players[index];
    }
  }
  return players[fromIndex];
}

function startRound(room) {
  room.round += 1;
  room.status = 'dealing';
  room.currentTrick = null;
  room.turnId = null;
  room.exchange = null;
  room.revolution = null;
  room.finishOrder = [];
  room.players.forEach((player) => {
    player.finished = false;
    player.passed = false;
  });

  const deck = shuffle(createDeck());
  deal(deck, room.players);

  const revolutionPlayer = room.players.find((player) => {
    const jokers = player.hand.filter((card) => card.joker);
    return jokers.length === 2;
  });

  const greatServant = room.players[room.players.length - 1];
  if (greatServant && greatServant.hand.filter((card) => card.joker).length === 2) {
    room.revolution = { type: 'aufstand', playerId: greatServant.id };
    swapSeats(room);
  } else if (revolutionPlayer) {
    room.revolution = { type: 'revolution', playerId: revolutionPlayer.id };
  }

  if (room.revolution && room.revolution.type === 'revolution') {
    room.status = 'playing';
    room.turnId = room.players[0].id;
  } else if (room.revolution && room.revolution.type === 'aufstand') {
    room.status = 'playing';
    room.turnId = room.players[0].id;
  } else {
    room.status = 'exchange';
    room.exchange = {
      pending: new Set(),
      received: {},
      complete: false
    };
    const greatRegent = room.players[0];
    const littleRegent = room.players[1];
    if (greatRegent) room.exchange.pending.add(greatRegent.id);
    if (littleRegent) room.exchange.pending.add(littleRegent.id);
  }
}

function swapSeats(room) {
  const total = room.players.length;
  for (let i = 0; i < Math.floor(total / 2); i += 1) {
    const opposite = total - 1 - i;
    [room.players[i], room.players[opposite]] = [room.players[opposite], room.players[i]];
  }
}

function startPlay(room) {
  room.status = 'playing';
  room.turnId = room.players[0].id;
  room.players.forEach((player) => {
    player.passed = false;
  });
  room.currentTrick = null;
}

function validatePlay(room, player, cardIds) {
  if (!Array.isArray(cardIds) || cardIds.length === 0) return { ok: false, reason: 'Keine Karten gewählt.' };
  const cards = cardIds.map((id) => player.hand.find((card) => card.id === id)).filter(Boolean);
  if (cards.length !== cardIds.length) return { ok: false, reason: 'Ungültige Karte.' };

  const jokers = cards.filter((card) => card.joker);
  const nonJokers = cards.filter((card) => !card.joker);

  const ranks = new Set(nonJokers.map((card) => card.rank));
  if (ranks.size > 1) {
    return { ok: false, reason: 'Nur gleiche Ränge plus Narren erlaubt.' };
  }

  const rank = nonJokers.length ? nonJokers[0].rank : JOKER_RANK;
  const count = cards.length;

  if (room.currentTrick) {
    if (count !== room.currentTrick.count) {
      return { ok: false, reason: 'Stich verlangt gleiche Kartenzahl.' };
    }
    if (rank >= room.currentTrick.rank) {
      return { ok: false, reason: 'Satz nicht hoch genug.' };
    }
  }

  return { ok: true, rank, count, cards };
}

function applyPlay(room, player, play) {
  play.cards.forEach((card) => {
    const index = player.hand.findIndex((handCard) => handCard.id === card.id);
    if (index >= 0) player.hand.splice(index, 1);
  });
  sortHand(player.hand);

  room.currentTrick = {
    rank: play.rank,
    count: play.count,
    by: player.id,
    displayRank: play.rank,
    displayName: RANK_NAMES[play.rank]
  };

  room.players.forEach((p) => {
    p.passed = p.id === player.id ? false : false;
  });

  if (player.hand.length === 0) {
    player.finished = true;
    if (!room.finishOrder.includes(player.id)) {
      room.finishOrder.push(player.id);
    }
  }

  room.turnId = nextActivePlayer(room, room.players.indexOf(player)).id;
}

function allOtherPassed(room) {
  const active = room.players.filter((player) => !player.finished);
  if (active.length <= 1) return true;
  const lastPlayerId = room.currentTrick?.by;
  return active.every((player) => player.id === lastPlayerId || player.passed);
}

function finishTrick(room) {
  const lastPlayerId = room.currentTrick?.by;
  const lastPlayer = room.players.find((player) => player.id === lastPlayerId);
  room.players.forEach((player) => {
    player.passed = false;
  });
  room.currentTrick = null;
  if (lastPlayer && !lastPlayer.finished) {
    room.turnId = lastPlayer.id;
  } else {
    const next = room.players.find((player) => !player.finished);
    if (next) room.turnId = next.id;
  }
}

function checkRoundEnd(room) {
  const remaining = room.players.filter((player) => !player.finished);
  if (remaining.length === 1) {
    const order = [...room.finishOrder];
    if (!order.includes(remaining[0].id)) {
      order.push(remaining[0].id);
    }
    assignPoints(room, order);
    reorderSeats(room, order);
    room.status = room.round >= room.settings.rounds ? 'gameOver' : 'roundEnd';
    room.turnId = null;
    room.currentTrick = null;
    return true;
  }
  return false;
}

function assignPoints(room, order) {
  const total = order.length;
  order.forEach((playerId, index) => {
    const player = room.players.find((p) => p.id === playerId);
    if (player) {
      player.points += Math.max(total - 1 - index, 0);
    }
  });
}

function reorderSeats(room, order) {
  const newSeats = order.map((id) => room.players.find((player) => player.id === id));
  room.players = newSeats;
}

function makeBotMove(room) {
  if (room.status === 'exchange') {
    handleBotExchange(room);
    return;
  }
  const bot = room.players.find((player) => player.id === room.turnId && player.bot);
  if (!bot || room.status !== 'playing') return;

  const current = room.currentTrick;
  const possible = findBotPlay(bot.hand, current);
  if (possible) {
    const play = validatePlay(room, bot, possible.map((card) => card.id));
    if (play.ok) {
      applyPlay(room, bot, play);
      addChat(room, { system: true, text: `${bot.name} spielt ${play.count}× ${RANK_NAMES[play.rank]}` });
      if (!checkRoundEnd(room) && allOtherPassed(room)) {
        finishTrick(room);
      }
    }
  } else {
    bot.passed = true;
    addChat(room, { system: true, text: `${bot.name} passt.` });
    if (allOtherPassed(room)) {
      finishTrick(room);
    } else {
      room.turnId = nextActivePlayer(room, room.players.indexOf(bot)).id;
    }
  }
}

function findBotPlay(hand, current) {
  const jokers = hand.filter((card) => card.joker);
  const grouped = groupByRank(hand.filter((card) => !card.joker));
  const options = [];
  grouped.forEach((cards, rank) => {
    for (let count = 1; count <= cards.length + jokers.length; count += 1) {
      if (count <= cards.length + jokers.length) {
        const take = cards.slice(0, Math.min(cards.length, count));
        const neededJokers = Math.max(count - take.length, 0);
        if (neededJokers <= jokers.length) {
          options.push({ rank, count, cards: [...take, ...jokers.slice(0, neededJokers)] });
        }
      }
    }
  });
  options.sort((a, b) => b.rank - a.rank || a.count - b.count);

  if (!current) {
    return options.length ? options[0].cards : null;
  }

  const valid = options.filter((option) => option.count === current.count && option.rank < current.rank);
  if (valid.length) {
    return valid[0].cards;
  }
  return null;
}

function groupByRank(hand) {
  const map = new Map();
  hand.forEach((card) => {
    const rank = card.joker ? JOKER_RANK : card.rank;
    if (!map.has(rank)) map.set(rank, []);
    map.get(rank).push(card);
  });
  return map;
}

function handleExchange(room, player, cardIds) {
  if (!room.exchange || room.exchange.complete) return { ok: false, reason: 'Kein Austausch aktiv.' };
  if (!room.exchange.pending.has(player.id)) return { ok: false, reason: 'Du bist nicht dran.' };

  const expectedCount = player.id === room.players[0].id ? 2 : 1;
  if (cardIds.length !== expectedCount) return { ok: false, reason: 'Falsche Kartenzahl.' };
  const cards = cardIds.map((id) => player.hand.find((card) => card.id === id)).filter(Boolean);
  if (cards.length !== expectedCount) return { ok: false, reason: 'Ungültige Karte.' };
  if (cards.some((card) => card.joker)) return { ok: false, reason: 'Narren dürfen nicht getauscht werden.' };

  room.exchange.received[player.id] = cards;
  room.exchange.pending.delete(player.id);

  if (room.exchange.pending.size === 0) {
    const greatRegent = room.players[0];
    const littleRegent = room.players[1];
    const greatServant = room.players[room.players.length - 1];
    const littleServant = room.players[room.players.length - 2];

    if (greatRegent && greatServant) {
      transferExchange(greatRegent, greatServant, room.exchange.received[greatRegent.id]);
    }
    if (littleRegent && littleServant) {
      transferExchange(littleRegent, littleServant, room.exchange.received[littleRegent.id]);
    }
    room.exchange.complete = true;
    startPlay(room);
  }
  return { ok: true };
}

function transferExchange(regent, servant, givenCards) {
  givenCards.forEach((card) => {
    const index = regent.hand.findIndex((handCard) => handCard.id === card.id);
    if (index >= 0) regent.hand.splice(index, 1);
    servant.hand.push(card);
  });

  const highest = highestCards(servant.hand, givenCards.length);
  highest.forEach((card) => {
    const index = servant.hand.findIndex((handCard) => handCard.id === card.id);
    if (index >= 0) servant.hand.splice(index, 1);
    regent.hand.push(card);
  });

  sortHand(regent.hand);
  sortHand(servant.hand);
}

function handleBotExchange(room) {
  if (!room.exchange || room.exchange.complete) return;
  const pendingBots = room.players.filter(
    (player) => player.bot && room.exchange.pending.has(player.id)
  );
  pendingBots.forEach((bot) => {
    const expectedCount = bot.id === room.players[0].id ? 2 : 1;
    const choices = bot.hand.filter((card) => !card.joker).slice(-expectedCount);
    if (choices.length === expectedCount) {
      handleExchange(room, bot, choices.map((card) => card.id));
      addChat(room, { system: true, text: `${bot.name} sendet Karten zum Austausch.` });
    }
  });
}

function fillBots(room) {
  while (room.players.length < room.settings.maxPlayers) {
    addBot(room);
  }
}

io.on('connection', (socket) => {
  socket.on('create', ({ roomId, name, maxPlayers, rounds, autoFillBots }) => {
    const settings = {
      maxPlayers: Math.min(Math.max(Number(maxPlayers) || 4, MIN_PLAYERS), MAX_PLAYERS),
      rounds: Math.min(Math.max(Number(rounds) || 10, 1), 30),
      autoFillBots: Boolean(autoFillBots)
    };
    const room = ensureRoom(roomId, settings);
    const player = addPlayer(room, socket, name);
    if (!player) return;
    socket.join(room.id);
    addChat(room, { system: true, text: `${name} hat den Hof betreten.` });
    roomBroadcast(room);
  });

  socket.on('join', ({ roomId, name }) => {
    const room = findRoom(roomId);
    if (!room) return;
    const player = addPlayer(room, socket, name);
    if (!player) return;
    socket.join(room.id);
    addChat(room, { system: true, text: `${name} hat sich angeschlossen.` });
    roomBroadcast(room);
  });

  socket.on('addBot', ({ roomId }) => {
    const room = findRoom(roomId);
    if (!room) return;
    if (room.players.length >= room.settings.maxPlayers) return;
    addBot(room);
    addChat(room, { system: true, text: 'Ein Bot tritt dem Hof bei.' });
    roomBroadcast(room);
  });

  socket.on('start', ({ roomId, autoFillBots }) => {
    const room = findRoom(roomId);
    if (!room) return;
    room.settings.autoFillBots = Boolean(autoFillBots);
    if (room.settings.autoFillBots) {
      fillBots(room);
    }
    if (room.players.length < MIN_PLAYERS) return;
    startRound(room);
    addChat(room, { system: true, text: `Runde ${room.round} beginnt.` });
    roomBroadcast(room);
  });

  socket.on('playCards', ({ roomId, cardIds }) => {
    const room = findRoom(roomId);
    if (!room || room.status !== 'playing') return;
    if (room.turnId !== socket.id) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    const play = validatePlay(room, player, cardIds);
    if (!play.ok) {
      socket.emit('errorMessage', play.reason);
      return;
    }

    applyPlay(room, player, play);
    addChat(room, { system: true, text: `${player.name} spielt ${play.count}× ${RANK_NAMES[play.rank]}` });

    if (!checkRoundEnd(room)) {
      if (allOtherPassed(room)) {
        finishTrick(room);
      }
    }
    roomBroadcast(room);
    makeBotMove(room);
  });

  socket.on('pass', ({ roomId }) => {
    const room = findRoom(roomId);
    if (!room || room.status !== 'playing') return;
    if (room.turnId !== socket.id) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;
    player.passed = true;
    addChat(room, { system: true, text: `${player.name} passt.` });
    if (allOtherPassed(room)) {
      finishTrick(room);
    } else {
      room.turnId = nextActivePlayer(room, room.players.indexOf(player)).id;
    }
    roomBroadcast(room);
    makeBotMove(room);
  });

  socket.on('exchange', ({ roomId, cardIds }) => {
    const room = findRoom(roomId);
    if (!room || room.status !== 'exchange') return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    const result = handleExchange(room, player, cardIds);
    if (!result.ok) {
      socket.emit('errorMessage', result.reason);
      return;
    }

    roomBroadcast(room);
    makeBotMove(room);
  });

  socket.on('chat', ({ roomId, message }) => {
    const room = findRoom(roomId);
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;
    addChat(room, {
      name: player.name,
      text: message
    });
    roomBroadcast(room);
  });

  socket.on('nextRound', ({ roomId }) => {
    const room = findRoom(roomId);
    if (!room || room.status !== 'roundEnd') return;
    startRound(room);
    addChat(room, { system: true, text: `Runde ${room.round} beginnt.` });
    roomBroadcast(room);
  });

  socket.on('disconnect', () => {
    rooms.forEach((room) => {
      const existing = room.players.find((player) => player.id === socket.id);
      if (existing) {
        removePlayer(room, socket.id);
        addChat(room, { system: true, text: `${existing.name} hat den Hof verlassen.` });
        roomBroadcast(room);
      }
    });
  });
});

setInterval(() => {
  rooms.forEach((room) => {
    if (room.status === 'playing') {
      makeBotMove(room);
      roomBroadcast(room);
    }
  });
}, 1200);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
