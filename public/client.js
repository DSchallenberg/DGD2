const socket = io();

const el = {
  lobby: document.getElementById('lobby'),
  game: document.getElementById('game'),
  name: document.getElementById('nameInput'),
  room: document.getElementById('roomInput'),
  players: document.getElementById('playersInput'),
  rounds: document.getElementById('roundsInput'),
  autoBots: document.getElementById('autoBotsInput'),
  create: document.getElementById('createBtn'),
  join: document.getElementById('joinBtn'),
  addBot: document.getElementById('addBotBtn'),
  copyLink: document.getElementById('copyLinkBtn'),
  start: document.getElementById('startBtn'),
  leave: document.getElementById('leaveBtn'),
  roomTitle: document.getElementById('roomTitle'),
  roundInfo: document.getElementById('roundInfo'),
  phaseInfo: document.getElementById('phaseInfo'),
  turnInfo: document.getElementById('turnInfo'),
  scoreList: document.getElementById('scoreList'),
  trickInfo: document.getElementById('trickInfo'),
  exchangeInfo: document.getElementById('exchangeInfo'),
  tableCards: document.getElementById('tableCards'),
  handCards: document.getElementById('handCards'),
  play: document.getElementById('playBtn'),
  pass: document.getElementById('passBtn'),
  exchange: document.getElementById('exchangeBtn'),
  banner: document.getElementById('banner'),
  chatLog: document.getElementById('chatLog'),
  chatInput: document.getElementById('chatInput'),
  chatSend: document.getElementById('chatSend')
};

const cardEmoji = {
  1: '👑', 2: '⛪', 3: '🛡️', 4: '💎', 5: '📜', 6: '⚔️',
  7: '🧵', 8: '🪨', 9: '🍲', 10: '🐑', 11: '⛏️', 12: '🧺', 13: '🃏'
};

const cardName = {
  1: 'Regent', 2: 'Erzbischof', 3: 'Hofmarschall', 4: 'Baronin', 5: 'Äbtissin',
  6: 'Ritter', 7: 'Näherin', 8: 'Steinmetz', 9: 'Köchin', 10: 'Schafhirtin',
  11: 'Bergmann', 12: 'Tagelöhner', 13: 'Narr'
};

let state = null;
let myHand = [];
let selected = new Set();
let mySocketId = null;
let currentRoom = null;

const storedKey = localStorage.getItem('playerKey');
const playerKey = storedKey || crypto.randomUUID();
if (!storedKey) localStorage.setItem('playerKey', playerKey);

function hydrateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('room')) el.room.value = params.get('room');
  if (params.get('name')) el.name.value = params.get('name');
}

function requireInputs() {
  const name = el.name.value.trim();
  const roomId = el.room.value.trim();
  if (!name || !roomId) {
    alert('Bitte Name und Raum angeben.');
    return null;
  }
  return { name, roomId };
}

function emitCreate() {
  const data = requireInputs();
  if (!data) return;
  currentRoom = data.roomId;
  socket.emit('create', {
    ...data,
    maxPlayers: Number(el.players.value),
    rounds: Number(el.rounds.value),
    autoFillBots: el.autoBots.checked,
    playerKey
  });
}

function emitJoin() {
  const data = requireInputs();
  if (!data) return;
  currentRoom = data.roomId;
  socket.emit('join', { ...data, playerKey });
}

function emitStart() {
  if (!currentRoom) currentRoom = el.room.value.trim();
  if (!currentRoom) return;
  socket.emit('start', { roomId: currentRoom, autoFillBots: el.autoBots.checked });
}

function emitAddBot() {
  if (!currentRoom) currentRoom = el.room.value.trim();
  if (!currentRoom) return;
  socket.emit('addBot', { roomId: currentRoom });
}

function emitLeave() {
  if (!currentRoom) return;
  socket.emit('leaveRoom', { roomId: currentRoom, playerKey });
  state = null;
  myHand = [];
  selected.clear();
  el.game.classList.add('hidden');
  el.lobby.classList.remove('hidden');
}

function emitPlay() {
  if (!currentRoom || selected.size === 0) return;
  socket.emit('playCards', { roomId: currentRoom, playerKey, cardIds: [...selected] });
}

function emitPass() {
  if (!currentRoom) return;
  socket.emit('pass', { roomId: currentRoom, playerKey });
}

function emitExchange() {
  if (!currentRoom || selected.size === 0) return;
  socket.emit('exchange', { roomId: currentRoom, playerKey, cardIds: [...selected] });
}

function emitChat() {
  const message = el.chatInput.value.trim();
  if (!message || !currentRoom) return;
  socket.emit('chat', { roomId: currentRoom, playerKey, message });
  el.chatInput.value = '';
}

function copyInviteLink() {
  const room = currentRoom || el.room.value.trim();
  if (!room) return;
  const url = new URL(window.location.href);
  url.searchParams.set('room', room);
  if (el.name.value.trim()) url.searchParams.set('name', el.name.value.trim());
  navigator.clipboard.writeText(url.toString())
    .then(() => alert('Einladungslink kopiert.'))
    .catch(() => prompt('Link kopieren:', url.toString()));
}

function me() {
  if (!state) return null;
  return state.players.find((p) => p.playerKey === playerKey && !p.bot) || null;
}

function canAct() {
  const mine = me();
  if (!mine || !state) return false;
  return state.turnId === mine.id && state.status === 'playing';
}

function renderScore() {
  el.scoreList.innerHTML = '';
  state.players.forEach((p) => {
    const li = document.createElement('li');
    if (state.turnId === p.id) li.style.outline = '2px solid #7c5cff';
    const left = document.createElement('span');
    left.textContent = `${p.name} ${p.bot ? '🤖' : p.connected ? '🟢' : '🔴'} (${p.seatTitle})`;
    const right = document.createElement('span');
    right.textContent = `${p.points}P • ${p.cards}🃏`;
    li.append(left, right);
    el.scoreList.appendChild(li);
  });
}

function renderTrick() {
  if (!state.currentTrick) {
    el.trickInfo.textContent = 'Noch kein Stich.';
    el.tableCards.innerHTML = '';
    return;
  }
  el.trickInfo.textContent = `${state.currentTrick.count}× ${state.currentTrick.displayName}`;
  el.tableCards.innerHTML = '';
  for (let i = 0; i < state.currentTrick.count; i += 1) {
    const c = document.createElement('div');
    c.className = 'play-card';
    c.textContent = cardEmoji[state.currentTrick.rank] || '🃏';
    el.tableCards.appendChild(c);
  }
}

function renderExchange() {
  if (state.status !== 'exchange') {
    el.exchangeInfo.textContent = 'Kein Austausch aktiv.';
    return;
  }
  const mine = me();
  if (!mine) {
    el.exchangeInfo.textContent = 'Austausch läuft…';
    return;
  }
  const pending = state.exchange?.pendingIds || [];
  if (pending.includes(mine.id)) {
    const need = state.players[0]?.id === mine.id ? 2 : 1;
    el.exchangeInfo.textContent = `Du musst ${need} Karte(n) senden.`;
  } else {
    el.exchangeInfo.textContent = 'Warte auf Austauschspieler…';
  }
}

function renderChat() {
  el.chatLog.innerHTML = '';
  state.chat.forEach((m) => {
    const d = document.createElement('div');
    d.className = `chat-msg ${m.system ? 'system' : ''}`;
    d.textContent = m.system ? m.text : `${m.name}: ${m.text}`;
    el.chatLog.appendChild(d);
  });
  el.chatLog.scrollTop = el.chatLog.scrollHeight;
}

function renderBanner() {
  if (state.status === 'roundEnd') {
    el.banner.classList.remove('hidden');
    el.banner.textContent = 'Runde beendet – klicke für nächste Runde.';
    el.banner.onclick = () => socket.emit('nextRound', { roomId: currentRoom });
    return;
  }
  if (state.status === 'gameOver') {
    el.banner.classList.remove('hidden');
    el.banner.textContent = 'Spiel beendet. Endstand links in der Rangliste.';
    el.banner.onclick = null;
    return;
  }
  el.banner.classList.add('hidden');
  el.banner.onclick = null;
}

function renderHand() {
  el.handCards.innerHTML = '';
  const total = myHand.length;
  if (!total) return;
  const spread = Math.min(52, 360 / Math.max(total, 7));
  const center = (total - 1) / 2;

  myHand.forEach((card, idx) => {
    const div = document.createElement('div');
    div.className = 'card';
    if (selected.has(card.id)) div.classList.add('selected');

    const offset = idx - center;
    const rot = offset * 4;
    const x = offset * spread;
    div.style.setProperty('--rot', `${rot}deg`);
    div.style.left = `calc(50% - 44px + ${x}px)`;
    div.style.transform = `rotate(${rot}deg)`;

    div.innerHTML = `
      <div class="emoji">${card.joker ? '🃏' : cardEmoji[card.rank]}</div>
      <div class="rank">${card.joker ? 'Narr' : cardName[card.rank]}</div>
      <div class="tiny">${card.joker ? 'Joker' : `Rang ${card.rank}`}</div>
    `;

    div.addEventListener('click', () => {
      if (selected.has(card.id)) selected.delete(card.id);
      else selected.add(card.id);
      renderHand();
    });

    el.handCards.appendChild(div);
  });
}

function updateButtons() {
  const acting = canAct();
  const inExchange = state?.status === 'exchange';
  const mine = me();
  const myPending = inExchange && mine && (state.exchange?.pendingIds || []).includes(mine.id);

  el.play.disabled = !acting || selected.size === 0;
  el.pass.disabled = !acting;
  el.exchange.disabled = !(myPending && selected.size > 0);
}

function renderState() {
  if (!state) return;
  el.lobby.classList.add('hidden');
  el.game.classList.remove('hidden');
  currentRoom = state.id;

  const mine = me();
  el.roomTitle.textContent = `Raum: ${state.id}`;
  el.roundInfo.textContent = `Runde ${state.round}/${state.maxRounds}`;
  el.phaseInfo.textContent = `Phase: ${state.status}`;
  el.turnInfo.textContent = state.turnId
    ? `Am Zug: ${state.players.find((p) => p.id === state.turnId)?.name || 'Unbekannt'}`
    : 'Warten…';

  if (mine) {
    const recovered = state.players.find((p) => p.playerKey === playerKey && !p.bot);
    if (!recovered) {
      myHand = [];
      selected.clear();
    }
  }

  renderScore();
  renderTrick();
  renderExchange();
  renderBanner();
  renderChat();
  renderHand();
  updateButtons();
}

socket.on('connect', () => {
  mySocketId = socket.id;
  if (el.room.value && el.name.value) {
    // Optional silent rejoin after refresh
  }
});

socket.on('roomUpdate', (payload) => {
  state = payload;
  renderState();
});

socket.on('handUpdate', ({ roomId, hand }) => {
  if (roomId !== currentRoom && roomId !== el.room.value.trim()) return;
  myHand = hand;
  selected = new Set([...selected].filter((id) => hand.some((c) => c.id === id)));
  renderHand();
  updateButtons();
});

socket.on('errorMessage', (msg) => alert(msg));
socket.on('connect_error', () => alert('Verbindung fehlgeschlagen.'));

el.create.addEventListener('click', emitCreate);
el.join.addEventListener('click', emitJoin);
el.start.addEventListener('click', emitStart);
el.addBot.addEventListener('click', emitAddBot);
el.copyLink.addEventListener('click', copyInviteLink);
el.leave.addEventListener('click', emitLeave);
el.play.addEventListener('click', emitPlay);
el.pass.addEventListener('click', emitPass);
el.exchange.addEventListener('click', emitExchange);
el.chatSend.addEventListener('click', emitChat);
el.chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') emitChat(); });

hydrateFromUrl();
