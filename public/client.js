const socket = io();

const lobbySection = document.getElementById('lobby');
const gameSection = document.getElementById('game');

const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');
const playersInput = document.getElementById('playersInput');
const roundsInput = document.getElementById('roundsInput');
const autoBotsInput = document.getElementById('autoBotsInput');

const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const botBtn = document.getElementById('botBtn');
const startBtn = document.getElementById('startBtn');
const copyLinkBtn = document.getElementById('copyLinkBtn');

const roomTitle = document.getElementById('roomTitle');
const roundInfo = document.getElementById('roundInfo');
const turnInfo = document.getElementById('turnInfo');
const phaseInfo = document.getElementById('phaseInfo');
const scoreList = document.getElementById('scoreList');
const trickInfo = document.getElementById('trickInfo');
const exchangeInfo = document.getElementById('exchangeInfo');
const handCards = document.getElementById('handCards');
const playBtn = document.getElementById('playBtn');
const passBtn = document.getElementById('passBtn');
const exchangeBtn = document.getElementById('exchangeBtn');
const banner = document.getElementById('banner');

const chatLog = document.getElementById('chatLog');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');

let currentRoom = null;
let myId = null;
let myHand = [];
let selected = new Set();
let currentState = null;

function requireNameRoom() {
  const name = nameInput.value.trim();
  const room = roomInput.value.trim();
  if (!name || !room) {
    alert('Bitte Name und Raum angeben.');
    return null;
  }
  return { name, room };
}

createBtn.addEventListener('click', () => {
  const values = requireNameRoom();
  if (!values) return;
  socket.emit('create', {
    roomId: values.room,
    name: values.name,
    maxPlayers: Number(playersInput.value),
    rounds: Number(roundsInput.value),
    autoFillBots: autoBotsInput.checked
  });
});

joinBtn.addEventListener('click', () => {
  const values = requireNameRoom();
  if (!values) return;
  socket.emit('join', {
    roomId: values.room,
    name: values.name
  });
});

botBtn.addEventListener('click', () => {
  const room = roomInput.value.trim();
  if (!room) return;
  socket.emit('addBot', { roomId: room });
});

startBtn.addEventListener('click', () => {
  if (!currentRoom) return;
  socket.emit('start', { roomId: currentRoom, autoFillBots: autoBotsInput.checked });
});

copyLinkBtn.addEventListener('click', async () => {
  const room = currentRoom || roomInput.value.trim();
  if (!room) return;
  const url = buildInviteLink(room);
  try {
    await navigator.clipboard.writeText(url);
    alert('Einladungslink kopiert.');
  } catch (error) {
    prompt('Kopiere den Link:', url);
  }
});

playBtn.addEventListener('click', () => {
  if (!currentRoom || selected.size === 0) return;
  socket.emit('playCards', {
    roomId: currentRoom,
    cardIds: Array.from(selected)
  });
});

passBtn.addEventListener('click', () => {
  if (!currentRoom) return;
  socket.emit('pass', { roomId: currentRoom });
});

exchangeBtn.addEventListener('click', () => {
  if (!currentRoom || selected.size === 0) return;
  socket.emit('exchange', {
    roomId: currentRoom,
    cardIds: Array.from(selected)
  });
});

chatSend.addEventListener('click', () => {
  const message = chatInput.value.trim();
  if (!message || !currentRoom) return;
  socket.emit('chat', { roomId: currentRoom, message });
  chatInput.value = '';
});

chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    chatSend.click();
  }
});

socket.on('connect', () => {
  myId = socket.id;
});

socket.on('errorMessage', (message) => {
  alert(message);
});

function updateUI(state) {
  lobbySection.classList.add('hidden');
  gameSection.classList.remove('hidden');
  roomTitle.textContent = `Raum: ${state.id}`;
  roundInfo.textContent = `Runde ${state.round} / ${state.maxRounds}`;
  phaseInfo.textContent = `Phase: ${labelPhase(state.status)}`;
  turnInfo.textContent = state.turnId ? `Am Zug: ${nameForId(state.turnId, state.players)}` : 'Warten…';
  renderScore(state);
  renderTrick(state);
  renderExchange(state);
  renderChat(state.chat);
  renderBanner(state);

  const me = state.players.find((player) => player.id === myId);
  if (me && me.hand) {
    myHand = me.hand;
  }

  if (state.hands && state.hands[myId]) {
    myHand = state.hands[myId];
  }
}

function renderScore(state) {
  scoreList.innerHTML = '';
  state.players.forEach((player) => {
    const li = document.createElement('li');
    const left = document.createElement('span');
    left.textContent = `${player.name} (${player.seatTitle})`;
    const right = document.createElement('span');
    right.textContent = `${player.points} P • ${player.cards} Karten`;
    li.append(left, right);
    if (player.id === state.turnId) {
      li.style.border = '2px solid var(--accent)';
    }
    scoreList.appendChild(li);
  });
}

function renderTrick(state) {
  if (!state.currentTrick) {
    trickInfo.textContent = 'Noch kein Stich.';
    return;
  }
  trickInfo.textContent = `${state.currentTrick.count}× ${state.currentTrick.displayName} (von ${nameForId(state.currentTrick.by, state.players)})`;
}

function renderExchange(state) {
  if (state.status !== 'exchange') {
    exchangeInfo.textContent = 'Kein Austausch aktiv.';
    return;
  }
  exchangeInfo.textContent = 'Regenten wählen ihre Karten für den Austausch.';
}

function renderChat(messages) {
  chatLog.innerHTML = '';
  messages.forEach((msg) => {
    const div = document.createElement('div');
    div.className = `chat-message ${msg.system ? 'system' : ''}`;
    div.textContent = msg.system ? msg.text : `${msg.name}: ${msg.text}`;
    chatLog.appendChild(div);
  });
  chatLog.scrollTop = chatLog.scrollHeight;
}

function renderBanner(state) {
  if (state.status === 'roundEnd') {
    banner.classList.remove('hidden');
    banner.textContent = 'Runde beendet. Jetzt neue Runde starten.';
    banner.onclick = () => socket.emit('nextRound', { roomId: currentRoom });
    return;
  }
  if (state.status === 'gameOver') {
    banner.classList.remove('hidden');
    banner.textContent = 'Spiel beendet. Danke für das Mitspielen!';
    return;
  }
  banner.classList.add('hidden');
  banner.onclick = null;
}

function nameForId(id, players) {
  const player = players.find((p) => p.id === id);
  return player ? player.name : 'Unbekannt';
}

function labelPhase(status) {
  switch (status) {
    case 'lobby':
      return 'Lobby';
    case 'exchange':
      return 'Austausch';
    case 'playing':
      return 'Stichphase';
    case 'roundEnd':
      return 'Rundenende';
    case 'gameOver':
      return 'Abrechnung';
    default:
      return status;
  }
}

function renderHand(hand) {
  handCards.innerHTML = '';
  selected.clear();
  hand.forEach((card) => {
    const div = document.createElement('div');
    div.className = 'card';
    div.textContent = card.joker ? 'Narr' : `${card.rank}`;
    const subtitle = document.createElement('div');
    subtitle.className = 'muted';
    subtitle.textContent = card.joker ? 'Joker' : card.rank;
    div.appendChild(subtitle);
    div.addEventListener('click', () => {
      if (selected.has(card.id)) {
        selected.delete(card.id);
        div.classList.remove('selected');
      } else {
        selected.add(card.id);
        div.classList.add('selected');
      }
    });
    handCards.appendChild(div);
  });
}

socket.on('handUpdate', (payload) => {
  if (payload.roomId !== currentRoom) return;
  myHand = payload.hand;
  renderHand(myHand);
});

socket.on('roomUpdate', (state) => {
  currentState = state;
  currentRoom = state.id;
  updateUI(state);
  if (myHand) {
    renderHand(myHand);
  }
});

socket.on('connect_error', () => {
  alert('Verbindung fehlgeschlagen.');
});

function buildInviteLink(room) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', room);
  if (nameInput.value.trim()) {
    url.searchParams.set('name', nameInput.value.trim());
  }
  return url.toString();
}

function hydrateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');
  const name = params.get('name');
  if (room) {
    roomInput.value = room;
  }
  if (name) {
    nameInput.value = name;
  }
}

hydrateFromUrl();
