/**
 * Browser client. Bundled by Bun through the @FrontendController HTML import,
 * so it can share constants and protocol types with the server.
 */
import { BALL, FIELD, PADDLE } from '../src/game/constants';
import type {
  GameSnapshot,
  LobbyMessage,
  PeerView,
  Role,
  RoomView,
  ServerMessage,
  Side,
} from '../src/game/protocol';
import { pauseCommand, pauseRemainingSeconds } from './pause';

// ── tiny DOM helpers ────────────────────────────────────────────────
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string): void {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

/** `host` = '' means "this server"; otherwise the origin of a peer instance. */
const apiUrl = (host: string, path: string) => `${host || location.origin}${path}`;
const wsUrl = (host: string, path: string) => apiUrl(host, path).replace(/^http/, 'ws');

async function api<T>(host: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(host, path), {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
  return body as T;
}

// ── state ───────────────────────────────────────────────────────────
interface InstanceInfo { id: string; name: string; shareUrls: string[]; publicUrl: string | null }
let info: InstanceInfo | null = null;
let lobbySocket: WebSocket | null = null;

const game = {
  socket: null as WebSocket | null,
  host: '',
  code: '',
  role: 'spectator' as Role,
  room: null as RoomView | null,
  snapshot: null as GameSnapshot | null,
  receivedAt: 0,
  pauseReceivedAt: null as number | null,
  pauseSecond: null as number | null,
  displayPaddles: { left: (FIELD.height - PADDLE.height) / 2, right: (FIELD.height - PADDLE.height) / 2 },
  dir: 0 as -1 | 0 | 1,
  pingTimer: 0 as unknown as ReturnType<typeof setInterval>,
  leaving: false,
};

const nameInput = $<HTMLInputElement>('name-input');
nameInput.value = localStorage.getItem('pong:name') ?? '';
nameInput.addEventListener('change', () => localStorage.setItem('pong:name', nameInput.value.trim()));
const playerName = () => nameInput.value.trim() || 'Oyuncu';

// ── lobby ───────────────────────────────────────────────────────────
async function loadInfo(): Promise<void> {
  info = await api<InstanceInfo>('', '/api/info');
  $('instance-line').textContent = `sunucu: ${info.name}`;
  $('share-urls').innerHTML = info.shareUrls.length
    ? info.shareUrls.map((u) => `<li>${esc(u)}</li>`).join('')
    : '<li>(ağ adresi bulunamadı)</li>';
}

function connectLobby(): void {
  lobbySocket = new WebSocket(wsUrl('', '/ws/lobby'));
  lobbySocket.onmessage = (ev) => {
    const msg = JSON.parse(ev.data) as LobbyMessage;
    if (msg.t === 'snapshot') {
      renderRooms(msg.rooms);
      renderPeers(msg.peers);
      renderOnline(msg.online);
    } else if (msg.t === 'rooms') renderRooms(msg.rooms);
    else if (msg.t === 'peers') renderPeers(msg.peers);
    else if (msg.t === 'online') renderOnline(msg.online);
  };
  lobbySocket.onclose = () => setTimeout(connectLobby, 2000);
}

const renderOnline = (n: number) => ($('online-pill').textContent = `● ${n} oyunda`);

function roomItem(room: RoomView, host: string): string {
  const players = [room.players.left?.name, room.players.right?.name].filter(Boolean);
  const full = players.length === 2;
  const busy = room.status === 'playing' || room.status === 'countdown' || room.status === 'paused';
  return `<li>
    <div>
      <b>${esc(room.name)}</b> <span class="mono meta">${esc(room.code)}</span><br/>
      <span class="meta">${players.length ? esc(players.join(' vs ')) : 'boş'} · ${room.targetScore} sayı</span>
      ${busy ? '<span class="badge playing">oynanıyor</span>' : ''}
    </div>
    <button class="small" data-join="${esc(room.code)}" data-host="${esc(host)}">${full ? 'İzle' : 'Katıl'}</button>
  </li>`;
}

function renderRooms(rooms: RoomView[]): void {
  $('room-list').innerHTML = rooms.length
    ? rooms.map((r) => roomItem(r, '')).join('')
    : '<li class="empty">Henüz oda yok — bir tane aç!</li>';
}

function renderPeers(peers: PeerView[]): void {
  $('peer-list').innerHTML = peers.length
    ? peers
        .map(
          (p) => `<li>
          <div><b>${esc(p.name)}</b> <span class="badge ${p.source === 'lan' ? 'lan' : ''}">${p.source === 'lan' ? 'LAN' : 'manuel'}</span><br/>
          <span class="meta mono">${esc(p.url)}</span> · <span class="meta">${p.openRooms} açık oda</span></div>
          <button class="small" data-peer="${esc(p.url)}">Odalar</button>
        </li>`,
        )
        .join('')
    : '<li class="empty">Aynı ağda başka bir oyuncu bulunamadı.</li>';
}

/** Shows the rooms of a peer instance — fetched directly from the peer (CORS is open). */
async function showPeerRooms(peerUrl: string): Promise<void> {
  const target = $('peer-rooms');
  target.innerHTML = '<p class="muted">yükleniyor…</p>';
  try {
    const { rooms } = await api<{ rooms: RoomView[] }>(peerUrl, '/api/rooms');
    target.innerHTML = `
      <h2>${esc(peerUrl)} <small>peer odaları</small></h2>
      <ul class="list">${rooms.length ? rooms.map((r) => roomItem(r, peerUrl)).join('') : '<li class="empty">Bu eşte açık oda yok.</li>'}</ul>
      <div class="row" style="margin-top:8px">
        <button class="small primary" data-peer-create="${esc(peerUrl)}">Bu eşte oda aç ve katıl</button>
        <a class="small muted" href="${esc(peerUrl)}" target="_blank" rel="noopener">eşin sayfasını aç ↗</a>
      </div>`;
  } catch (e) {
    target.innerHTML = `<p class="muted">Eşe ulaşılamadı: ${esc((e as Error).message)}</p>`;
  }
}

async function loadLeaderboard(): Promise<void> {
  const { players } = await api<{ players: { name: string; wins: number; losses: number }[] }>('', '/api/leaderboard?limit=10');
  $('leaderboard').innerHTML = players.length
    ? players.map((p, i) => `<li><span>${i + 1}. <b>${esc(p.name)}</b></span><span class="meta">${p.wins}G · ${p.losses}M</span></li>`).join('')
    : '<li class="empty">Henüz maç oynanmadı.</li>';
}

// lobby actions
$('quick-btn').onclick = async () => {
  try {
    const { room } = await api<{ room: RoomView }>('', '/api/rooms/quick-match', { method: 'POST' });
    joinRoom('', room.code);
  } catch (e) { toast((e as Error).message); }
};

async function createRoomOn(host: string): Promise<void> {
  try {
    const { room } = await api<{ room: RoomView }>(host, '/api/rooms', {
      method: 'POST',
      body: JSON.stringify({
        name: `${playerName()} odası`,
        isPublic: $<HTMLInputElement>('public-check').checked,
        targetScore: Number($<HTMLSelectElement>('target-select').value),
      }),
    });
    joinRoom(host, room.code);
  } catch (e) { toast((e as Error).message); }
}
$('create-btn').onclick = () => createRoomOn('');

$('join-form').onsubmit = (ev) => {
  ev.preventDefault();
  const code = $<HTMLInputElement>('code-input').value.trim().toUpperCase();
  if (code) joinRoom('', code);
};

$('peer-form').onsubmit = async (ev) => {
  ev.preventDefault();
  const address = $<HTMLInputElement>('peer-input').value.trim();
  if (!address) return;
  try {
    // Our own server probes the address (no CORS / mixed content problems) and remembers the peer.
    const { peer } = await api<{ peer: PeerView }>('', '/api/peers', { method: 'POST', body: JSON.stringify({ address }) });
    toast(`${peer.name} eklendi`);
    await showPeerRooms(peer.url);
  } catch (e) { toast((e as Error).message); }
};

document.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-join],[data-peer],[data-peer-create]');
  if (!el) return;
  if (el.dataset.join) joinRoom(el.dataset.host ?? '', el.dataset.join);
  else if (el.dataset.peer) showPeerRooms(el.dataset.peer);
  else if (el.dataset.peerCreate) createRoomOn(el.dataset.peerCreate);
});

// ── game ────────────────────────────────────────────────────────────
function showView(view: 'lobby' | 'game'): void {
  $('lobby').classList.toggle('hidden', view !== 'lobby');
  $('game').classList.toggle('hidden', view !== 'game');
}

function joinRoom(host: string, code: string): void {
  leaveRoom(false);
  game.host = host.replace(/\/$/, '');
  game.code = code.toUpperCase();
  game.snapshot = null;
  game.room = null;
  game.leaving = false;
  $('chat-log').innerHTML = '';
  setOverlay('');

  const url = `${wsUrl(game.host, '/ws/game')}?room=${encodeURIComponent(game.code)}&name=${encodeURIComponent(playerName())}`;
  const socket = new WebSocket(url);
  game.socket = socket;
  socket.onmessage = (ev) => onGameMessage(JSON.parse(ev.data) as ServerMessage);
  socket.onclose = () => {
    if (game.socket !== socket) return;
    clearInterval(game.pingTimer);
    if (!game.leaving) toast('Bağlantı kapandı (oda bulunamadı ya da sunucu kapandı).');
    game.socket = null;
    clearPauseDisplay();
    setOverlay('');
    showView('lobby');
    history.replaceState(null, '', location.pathname);
  };

  const params = new URLSearchParams({ room: game.code });
  if (game.host) params.set('host', game.host);
  history.replaceState(null, '', `?${params}`);
  showView('game');
  $('room-code').textContent = game.code;
  $<HTMLInputElement>('invite-input').value = inviteLink();
}

function leaveRoom(goLobby = true): void {
  if (game.socket) {
    game.leaving = true;
    game.socket.close();
    game.socket = null;
  }
  clearInterval(game.pingTimer);
  clearPauseDisplay();
  setOverlay('');
  if (goLobby) {
    showView('lobby');
    history.replaceState(null, '', location.pathname);
    loadLeaderboard().catch(() => {});
  }
}

/** A link the opponent can open. Uses a LAN/public address when we run on localhost. */
function inviteLink(): string {
  let base = game.host || location.origin;
  if (!game.host && /^(localhost|127\.|\[::1\])/.test(location.hostname) && info?.shareUrls[0]) base = info.shareUrls[0];
  return `${base}/?room=${game.code}`;
}

function send(msg: object): void {
  if (game.socket?.readyState === WebSocket.OPEN) game.socket.send(JSON.stringify(msg));
}

function togglePause(): boolean {
  if (!game.room || $('game').classList.contains('hidden')) return false;
  const command = pauseCommand(game.room, game.role);
  if (!command) return false;
  send(command);
  return true;
}

function onGameMessage(msg: ServerMessage): void {
  switch (msg.t) {
    case 'welcome':
      game.role = msg.role;
      $('role-text').textContent =
        msg.role === 'spectator' ? '👀 izleyicisin' : `sen ${msg.role === 'left' ? 'soldasın (mavi)' : 'sağdasın (pembe)'} · sunucu: ${msg.instance}`;
      $('ready-btn').classList.toggle('hidden', msg.role === 'spectator');
      game.pingTimer = setInterval(() => send({ t: 'ping', ts: performance.now() }), 2000);
      renderRoom(msg.room);
      break;
    case 'room':
      renderRoom(msg.room);
      break;
    case 'countdown':
      clearPauseDisplay();
      setOverlay(String(msg.n));
      break;
    case 'state':
      if (game.snapshot === null || msg.s.tick >= game.snapshot.tick) {
        game.snapshot = msg.s;
        game.receivedAt = performance.now();
      }
      if (game.room?.status === 'playing') setOverlay('');
      renderScore(msg.s.score);
      break;
    case 'scored':
      renderScore(msg.score);
      break;
    case 'end': {
      clearPauseDisplay();
      const mine = game.role === msg.winner;
      const label = game.role === 'spectator' ? `${msg.winnerName} kazandı` : mine ? 'Kazandın! 🏆' : 'Kaybettin';
      setOverlay(`${esc(label)}<small>${msg.score.left} – ${msg.score.right}${msg.reason === 'forfeit' ? ' · rakip ayrıldı' : ''}</small>`);
      break;
    }
    case 'chat': {
      const li = document.createElement('li');
      li.innerHTML = `<b>${esc(msg.from)}:</b> ${esc(msg.text)}`;
      $('chat-log').append(li);
      $('chat-log').scrollTop = 1e9;
      break;
    }
    case 'pong':
      $('ping-text').textContent = `ping ${Math.round(performance.now() - msg.ts)} ms`;
      break;
    case 'error':
      toast(msg.message);
      break;
  }
}

function renderRoom(room: RoomView): void {
  const previousStatus = game.room?.status;
  // A new match (first game or rematch) restarts the server's tick counter at 0.
  // Drop the old snapshot, otherwise every new state looks "older" and is ignored
  // → the ball and paddles freeze at the end position of the previous match.
  if (room.status === 'countdown' && previousStatus !== 'countdown' && previousStatus !== 'paused') {
    game.snapshot = null;
    game.displayPaddles = { left: (FIELD.height - PADDLE.height) / 2, right: (FIELD.height - PADDLE.height) / 2 };
  }
  game.room = room;
  $('left-name').textContent = room.players.left?.name ?? 'boş';
  $('right-name').textContent = room.players.right?.name ?? 'boş';
  const side = game.role === 'left' || game.role === 'right' ? game.role : null;
  const me = side ? room.players[side] : null;
  const readyBtn = $<HTMLButtonElement>('ready-btn');
  readyBtn.disabled = !me || me.ready || room.status === 'playing' || room.status === 'countdown' || room.status === 'paused';
  readyBtn.textContent = room.status === 'finished' ? 'Rövanş' : me?.ready ? 'Hazır ✓' : 'Hazırım';

  const pauseBtn = $<HTMLButtonElement>('pause-btn');
  const command = pauseCommand(room, game.role);
  const pauseVisible = side !== null && (room.status === 'playing' || room.status === 'paused');
  pauseBtn.classList.toggle('hidden', !pauseVisible);
  pauseBtn.disabled = command === null;
  if (room.status === 'paused') pauseBtn.textContent = 'Devam et';
  else if (room.status === 'playing' && side) pauseBtn.textContent = `Duraklat (${room.pausesRemaining[side]})`;

  const both = room.players.left && room.players.right;
  const text: Record<RoomView['status'], string> = {
    waiting: both ? 'İki oyuncu da “Hazırım” desin' : 'Rakip bekleniyor — davet linkini paylaş',
    countdown: 'Başlıyor…',
    playing: `İlk ${room.targetScore} sayıya ulaşan kazanır`,
    paused: 'Duraklatıldı',
    finished: both ? 'Maç bitti — rövanş?' : 'Maç bitti',
  };
  $('status-text').textContent = text[room.status];
  if (room.status === 'paused' && room.pause) {
    if (previousStatus !== 'paused') {
      held.clear();
      game.dir = 0;
    }
    game.pauseReceivedAt = performance.now();
    game.pauseSecond = null;
    updatePauseOverlay(game.pauseReceivedAt);
  } else {
    clearPauseDisplay();
    if (previousStatus === 'paused' && room.status === 'countdown') setOverlay('');
  }
  if (room.status === 'waiting' && !game.snapshot) setOverlay(both ? '' : '<small>Rakip bekleniyor…</small>');
}

function renderScore(score: { left: number; right: number }): void {
  $('left-score').textContent = String(score.left);
  $('right-score').textContent = String(score.right);
}

function clearPauseDisplay(): void {
  game.pauseReceivedAt = null;
  game.pauseSecond = null;
}

function updatePauseOverlay(now: number): void {
  const pause = game.room?.status === 'paused' ? game.room.pause : null;
  const receivedAt = game.pauseReceivedAt;
  if (!pause || receivedAt === null) return;
  const second = pauseRemainingSeconds(pause.remainingMs, receivedAt, now);
  if (second === game.pauseSecond) return;
  game.pauseSecond = second;
  setOverlay(`Duraklatıldı<small>${second} saniye kaldı</small>`);
}

function setOverlay(html: string): void {
  const el = $('overlay');
  el.innerHTML = `<div>${html}</div>`;
  el.classList.toggle('hidden', !html);
}

$('ready-btn').onclick = () => send({ t: game.room?.status === 'finished' ? 'rematch' : 'ready' });
$('pause-btn').onclick = () => { togglePause(); };
$('leave-btn').onclick = () => leaveRoom(true);
$('copy-btn').onclick = async () => {
  const link = inviteLink();
  try {
    await navigator.clipboard.writeText(link);
    toast('Davet linki kopyalandı');
  } catch {
    $<HTMLInputElement>('invite-input').select();
  }
};
$('chat-form').onsubmit = (ev) => {
  ev.preventDefault();
  const input = $<HTMLInputElement>('chat-input');
  const text = input.value.trim();
  if (text) send({ t: 'chat', text });
  input.value = '';
  input.blur(); // hand the keyboard back to the paddle
};

// ── input ───────────────────────────────────────────────────────────
const held = new Set<-1 | 1>();
function updateDir(): void {
  const dir = (held.has(-1) ? -1 : 0) + (held.has(1) ? 1 : 0);
  if (dir !== game.dir) {
    game.dir = dir as -1 | 0 | 1;
    send({ t: 'input', dir: game.dir });
  }
}
/** True only while the user types into a visible, editable field (e.g. the chat box). */
function isTyping(): boolean {
  const el = document.activeElement as HTMLInputElement | null;
  return !!el && el.tagName === 'INPUT' && !el.readOnly && el.offsetParent !== null;
}
const keyDir: Record<string, -1 | 1> ={ ArrowUp: -1, KeyW: -1, ArrowDown: 1, KeyS: 1 };
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') {
    if (e.repeat || isTyping()) return;
    if (togglePause()) e.preventDefault();
    return;
  }
  if (!keyDir[e.code] || isTyping() || $('game').classList.contains('hidden')) return;
  e.preventDefault();
  held.add(keyDir[e.code]!);
  updateDir();
});
window.addEventListener('keyup', (e) => {
  if (!keyDir[e.code]) return;
  held.delete(keyDir[e.code]!);
  updateDir();
});
window.addEventListener('blur', () => { held.clear(); updateDir(); });
document.querySelectorAll<HTMLButtonElement>('.touch-controls button').forEach((btn) => {
  const dir = Number(btn.dataset.dir) as -1 | 1;
  btn.addEventListener('pointerdown', () => { held.add(dir); updateDir(); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, () => { held.delete(dir); updateDir(); });
});

// ── rendering ───────────────────────────────────────────────────────
const canvas = $<HTMLCanvasElement>('field');
const ctx = canvas.getContext('2d')!;
let lastFrame = performance.now();

function frame(now: number): void {
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  draw(now, dt);
  requestAnimationFrame(frame);
}

function draw(now: number, dt: number): void {
  updatePauseOverlay(now);
  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, FIELD.width, FIELD.height);

  ctx.strokeStyle = '#1f2630';
  ctx.setLineDash([10, 14]);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(FIELD.width / 2, 0);
  ctx.lineTo(FIELD.width / 2, FIELD.height);
  ctx.stroke();
  ctx.setLineDash([]);

  const s = game.snapshot;
  const status = game.room?.status;
  const frozen = status === 'paused' || status === 'countdown';
  for (const side of ['left', 'right'] as const) {
    if (s && frozen) {
      game.displayPaddles[side] = s.paddles[side];
    } else {
      let target = s ? s.paddles[side] : game.displayPaddles[side];
      // Client-side prediction for my own paddle: move instantly, then converge to the server.
      if (side === game.role && status === 'playing') {
        game.displayPaddles[side] += game.dir * PADDLE.speed * dt;
        target = target + (game.displayPaddles[side] - target) * 0.6;
      }
      game.displayPaddles[side] += (target - game.displayPaddles[side]) * Math.min(1, dt * 20);
      game.displayPaddles[side] = Math.max(0, Math.min(FIELD.height - PADDLE.height, game.displayPaddles[side]));
    }
    drawPaddle(side, game.displayPaddles[side]);
  }

  if (s && (status === 'playing' || frozen)) {
    let x = s.ball.x;
    let y = s.ball.y;
    if (status === 'playing') {
      // Extrapolate the ball from the last snapshot (server sends 30 Hz, we draw at 60+).
      const since = Math.min((now - game.receivedAt) / 1000, 0.08);
      x += s.ball.vx * since;
      y += s.ball.vy * since;
      y = Math.max(0, Math.min(FIELD.height - BALL.size, y));
      x = Math.max(-BALL.size, Math.min(FIELD.width, x));
    }
    ctx.fillStyle = '#f5a524';
    ctx.shadowColor = '#f5a524';
    ctx.shadowBlur = 16;
    ctx.fillRect(x, y, BALL.size, BALL.size);
    ctx.shadowBlur = 0;
  }
}

function drawPaddle(side: Side, y: number): void {
  const x = side === 'left' ? PADDLE.margin : FIELD.width - PADDLE.margin - PADDLE.width;
  ctx.fillStyle = side === 'left' ? '#4cc9f0' : '#f72585';
  ctx.shadowColor = ctx.fillStyle;
  ctx.shadowBlur = side === game.role ? 18 : 6;
  ctx.fillRect(x, y, PADDLE.width, PADDLE.height);
  ctx.shadowBlur = 0;
}

// ── boot ────────────────────────────────────────────────────────────
// The favicon is served by @StaticServe (/assets/*), not bundled — so it is added at runtime.
document.head.append(Object.assign(document.createElement('link'), { rel: 'icon', type: 'image/svg+xml', href: '/assets/favicon.svg' }));
requestAnimationFrame(frame);
loadInfo().catch(() => ($('instance-line').textContent = 'sunucuya ulaşılamadı'));
loadLeaderboard().catch(() => {});
connectLobby();

const params = new URLSearchParams(location.search);
const roomParam = params.get('room');
if (roomParam) {
  const hostParam = params.get('host') ?? '';
  joinRoom(hostParam && /^https?:\/\//.test(hostParam) ? hostParam : hostParam ? `http://${hostParam}` : '', roomParam);
}
