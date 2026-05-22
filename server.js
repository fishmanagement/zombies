import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(join(__dirname, 'public')));

// ─── GAME CONFIG ───
const TICK_RATE = 20; // 20 ticks/sec
const MAP_W = 2400, MAP_H = 1800;
const PLAYER_SPEED = 3.5;
const PLAYER_RADIUS = 14;
const ZOMBIE_RADIUS = 12;
const BULLET_SPEED = 12;
const BARRICADE_HP = 100;

const WEAPONS = {
  pistol:   { name: 'M1911',     damage: 30,  fireRate: 300, reload: 1500, magSize: 8,  maxAmmo: 96,  spread: 0.04, bulletCount: 1, price: 0,    range: 500 },
  shotgun:  { name: 'Olympia',   damage: 40,  fireRate: 800, reload: 2500, magSize: 2,  maxAmmo: 54,  spread: 0.15, bulletCount: 6, price: 500,  range: 300 },
  smg:      { name: 'MP40',      damage: 25,  fireRate: 120, reload: 2000, magSize: 32, maxAmmo: 192, spread: 0.08, bulletCount: 1, price: 1000, range: 400 },
  ar:       { name: 'STG-44',    damage: 35,  fireRate: 150, reload: 2500, magSize: 30, maxAmmo: 210, spread: 0.05, bulletCount: 1, price: 1200, range: 600 },
  lmg:      { name: 'MG42',      damage: 30,  fireRate: 80,  reload: 4000, magSize: 75, maxAmmo: 300, spread: 0.10, bulletCount: 1, price: 1750, range: 500 },
  ray:      { name: 'Ray Gun',   damage: 150, fireRate: 400, reload: 3000, magSize: 20, maxAmmo: 160, spread: 0.02, bulletCount: 1, price: 950,  range: 700 },
};

const PERKS = {
  juggernog:  { name: 'Juggernog',   price: 2500, color: '#ff4444' },
  speedcola:  { name: 'Speed Cola',  price: 3000, color: '#44ff44' },
  doubletap:  { name: 'Double Tap',  price: 2000, color: '#ffff44' },
  quickrevive:{ name: 'Quick Revive',price: 1500, color: '#4444ff' },
};

// ─── MAP DEFINITION ───
// Rooms, walls, doors, spawn points, wall-buys, perks, mystery box
const WALLS = [
  // Outer walls
  {x:0,y:0,w:MAP_W,h:20},         // top
  {x:0,y:MAP_H-20,w:MAP_W,h:20},  // bottom
  {x:0,y:0,w:20,h:MAP_H},         // left
  {x:MAP_W-20,y:0,w:20,h:MAP_H},  // right
  // Room 1 (spawn) - center area
  {x:400,y:0,w:20,h:350},          // left wall top
  {x:400,y:450,w:20,h:350},        // left wall bottom (door gap 350-450)
  {x:400,y:800,w:20,h:200},
  {x:400,y:1100,w:20,h:350},       // left wall lower top (door gap 1000-1100)
  {x:400,y:1450,w:20,h:350},
  {x:1000,y:0,w:20,h:600},         // right wall top
  {x:1000,y:750,w:20,h:200},       // right wall mid (door gap 600-750)
  {x:1000,y:950,w:20,h:850},       // right wall bottom
  // Room 2 - left area
  {x:20,y:800,w:380,h:20},         // divider
  // Room 3 - right area
  {x:1020,y:600,w:400,h:20},
  {x:1400,y:0,w:20,h:600},
  {x:1400,y:620,w:20,h:500},
  {x:1020,y:1100,w:400,h:20},
  // Room 4 - far right (power room)
  {x:1420,y:300,w:580,h:20},
  {x:1420,y:900,w:400,h:20},
  {x:1820,y:320,w:20,h:580},       // inner wall (door gap at top)
  {x:1840,y:600,w:160,h:20},
];

const DOORS = [
  { id: 'd1', x: 400, y: 350, w: 20, h: 100, price: 750, open: false, label: 'Left Wing' },
  { id: 'd2', x: 400, y: 1000, w: 20, h: 100, price: 750, open: false, label: 'Basement' },
  { id: 'd3', x: 1000, y: 600, w: 20, h: 150, price: 1000, open: false, label: 'East Wing' },
  { id: 'd4', x: 1400, y: 600, w: 20, h: 20, price: 1250, open: false, label: 'Power Room' },
];

const BARRICADES = [
  { id: 'b1', x: 20, y: 200, w: 20, h: 80, hp: BARRICADE_HP, maxHp: BARRICADE_HP, side: 'left' },
  { id: 'b2', x: 20, y: 600, w: 20, h: 80, hp: BARRICADE_HP, maxHp: BARRICADE_HP, side: 'left' },
  { id: 'b3', x: 20, y: 1400, w: 20, h: 80, hp: BARRICADE_HP, maxHp: BARRICADE_HP, side: 'left' },
  { id: 'b4', x: MAP_W-40, y: 400, w: 20, h: 80, hp: BARRICADE_HP, maxHp: BARRICADE_HP, side: 'right' },
  { id: 'b5', x: MAP_W-40, y: 1200, w: 20, h: 80, hp: BARRICADE_HP, maxHp: BARRICADE_HP, side: 'right' },
  { id: 'b6', x: 700, y: MAP_H-40, w: 80, h: 20, hp: BARRICADE_HP, maxHp: BARRICADE_HP, side: 'bottom' },
];

const WALLBUYS = [
  { weapon: 'shotgun', x: 420, y: 200, room: 0 },
  { weapon: 'smg', x: 200, y: 850, room: 1 },
  { weapon: 'ar', x: 1100, y: 300, room: 2 },
  { weapon: 'lmg', x: 1500, y: 700, room: 3 },
];

const PERK_LOCATIONS = [
  { perk: 'quickrevive', x: 700, y: 300, room: 0 },
  { perk: 'juggernog', x: 150, y: 1200, room: 1 },
  { perk: 'speedcola', x: 1200, y: 800, room: 2 },
  { perk: 'doubletap', x: 1600, y: 500, room: 3 },
];

const MYSTERY_BOX = { x: 1700, y: 700, w: 60, h: 40, price: 950, room: 3 };
const POWER_SWITCH = { x: 1900, y: 450, room: 3, active: false };
const PLAYER_SPAWNS = [
  { x: 700, y: 400 }, { x: 700, y: 600 }, { x: 600, y: 500 }, { x: 800, y: 500 }
];

const ZOMBIE_SPAWNS = [
  // From barricades
  { x: 10, y: 240 }, { x: 10, y: 640 }, { x: 10, y: 1440 },
  { x: MAP_W-10, y: 440 }, { x: MAP_W-10, y: 1240 },
  { x: 740, y: MAP_H-10 },
];

// ─── ROOMS ───
const rooms = new Map();

function createRoom(code) {
  return {
    code,
    players: new Map(),
    zombies: [],
    bullets: [],
    round: 0,
    zombiesRemaining: 0,
    zombiesSpawned: 0,
    zombiesToSpawn: 0,
    spawnTimer: 0,
    state: 'lobby', // lobby, playing, gameover
    doors: DOORS.map(d => ({ ...d })),
    barricades: BARRICADES.map(b => ({ ...b })),
    powerOn: false,
    tickInterval: null,
    lastTick: Date.now(),
  };
}

function createPlayer(id, name) {
  const spawn = PLAYER_SPAWNS[Math.floor(Math.random() * PLAYER_SPAWNS.length)];
  return {
    id, name,
    x: spawn.x, y: spawn.y,
    angle: 0, moving: false,
    vx: 0, vy: 0,
    hp: 100, maxHp: 100,
    points: 500,
    weapon: 'pistol',
    weapons: ['pistol'],
    ammo: { pistol: WEAPONS.pistol.magSize },
    reserve: { pistol: WEAPONS.pistol.maxAmmo },
    reloading: false, reloadEnd: 0,
    lastShot: 0,
    kills: 0, headshots: 0, revives: 0, downs: 0,
    perks: [],
    downed: false, downTimer: 0,
    dead: false,
    inputs: { up: false, down: false, left: false, right: false, shoot: false, reload: false },
    lastBarricadeRepair: 0,
  };
}

function createZombie(room, round) {
  const spawn = ZOMBIE_SPAWNS[Math.floor(Math.random() * ZOMBIE_SPAWNS.length)];
  const hpBase = 100 + round * 50;
  const speedBase = 1.2 + Math.min(round * 0.1, 2.0);
  return {
    id: Math.random().toString(36).substr(2, 9),
    x: spawn.x, y: spawn.y,
    hp: hpBase + Math.random() * 30,
    maxHp: hpBase + 30,
    speed: speedBase + Math.random() * 0.3,
    targetId: null,
    attackCooldown: 0,
    damage: 20 + Math.floor(round / 3) * 5,
    path: [], pathTimer: 0,
    stuck: 0,
  };
}

// ─── COLLISION ───
function rectCollide(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function circleRect(cx, cy, cr, rx, ry, rw, rh) {
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX, dy = cy - closestY;
  return dx * dx + dy * dy < cr * cr;
}

function getWalls(room) {
  const walls = [...WALLS];
  for (const d of room.doors) {
    if (!d.open) walls.push(d);
  }
  return walls;
}

function canMove(x, y, radius, room) {
  const walls = getWalls(room);
  for (const w of walls) {
    if (circleRect(x, y, radius, w.x, w.y, w.w, w.h)) return false;
  }
  return x - radius >= 0 && x + radius <= MAP_W && y - radius >= 0 && y + radius <= MAP_H;
}

// ─── GAME LOOP ───
function startRound(room) {
  room.round++;
  room.zombiesToSpawn = Math.floor(6 + room.round * 2 + room.players.size * 2);
  room.zombiesSpawned = 0;
  room.zombiesRemaining = room.zombiesToSpawn;
  room.spawnTimer = 0;
  broadcast(room, { type: 'round', round: room.round });
}

function gameTick(room) {
  const now = Date.now();
  const dt = Math.min(now - room.lastTick, 100);
  room.lastTick = now;
  if (room.state !== 'playing') return;

  // Check if all players dead
  const alivePlayers = [...room.players.values()].filter(p => !p.dead);
  if (alivePlayers.length === 0) {
    room.state = 'gameover';
    broadcast(room, { type: 'gameover', round: room.round, players: getPlayerStats(room) });
    clearInterval(room.tickInterval);
    return;
  }

  // Spawn zombies
  room.spawnTimer -= dt;
  if (room.zombiesSpawned < room.zombiesToSpawn && room.spawnTimer <= 0 && room.zombies.length < 24) {
    room.zombies.push(createZombie(room, room.round));
    room.zombiesSpawned++;
    room.spawnTimer = Math.max(500, 2000 - room.round * 100);
  }

  // Update players
  for (const p of room.players.values()) {
    if (p.dead) continue;

    // Downed state
    if (p.downed) {
      p.downTimer -= dt;
      if (p.downTimer <= 0) {
        p.dead = true;
        p.downs++;
        continue;
      }
      // Check if another player is close enough to revive
      for (const other of room.players.values()) {
        if (other.id === p.id || other.dead || other.downed) continue;
        const dx = other.x - p.x, dy = other.y - p.y;
        if (Math.sqrt(dx*dx + dy*dy) < 50) {
          // Auto-revive if close for 3 seconds (simplified)
          p.downTimer += dt * 2; // Slow the bleedout when someone's near
          if (p.downTimer > 30000) { // Fully revived
            p.downed = false;
            p.hp = 50;
            other.points += 100;
            other.revives++;
            broadcast(room, { type: 'revive', reviver: other.id, revived: p.id });
          }
        }
      }
      continue;
    }

    // Movement
    let speed = PLAYER_SPEED;
    if (p.perks.includes('speedcola')) speed *= 1.1;
    let mx = 0, my = 0;
    if (p.inputs.up) my -= 1;
    if (p.inputs.down) my += 1;
    if (p.inputs.left) mx -= 1;
    if (p.inputs.right) mx += 1;
    if (mx || my) {
      const len = Math.sqrt(mx*mx + my*my);
      mx = mx/len * speed; my = my/len * speed;
      const nx = p.x + mx, ny = p.y + my;
      if (canMove(nx, p.y, PLAYER_RADIUS, room)) p.x = nx;
      if (canMove(p.x, ny, PLAYER_RADIUS, room)) p.y = ny;
      p.moving = true;
    } else {
      p.moving = false;
    }

    // Reload
    if (p.reloading && now >= p.reloadEnd) {
      const w = WEAPONS[p.weapon];
      const needed = w.magSize - p.ammo[p.weapon];
      const available = Math.min(needed, p.reserve[p.weapon]);
      p.ammo[p.weapon] += available;
      p.reserve[p.weapon] -= available;
      p.reloading = false;
    }

    if (p.inputs.reload && !p.reloading && p.ammo[p.weapon] < WEAPONS[p.weapon].magSize && p.reserve[p.weapon] > 0) {
      p.reloading = true;
      let reloadTime = WEAPONS[p.weapon].reload;
      if (p.perks.includes('speedcola')) reloadTime *= 0.5;
      p.reloadEnd = now + reloadTime;
    }

    // Shooting
    if (p.inputs.shoot && !p.reloading && !p.downed) {
      const w = WEAPONS[p.weapon];
      let fireRate = w.fireRate;
      if (p.perks.includes('doubletap')) fireRate *= 0.7;
      if (now - p.lastShot >= fireRate && p.ammo[p.weapon] > 0) {
        p.lastShot = now;
        p.ammo[p.weapon]--;
        for (let i = 0; i < w.bulletCount; i++) {
          const spread = (Math.random() - 0.5) * w.spread;
          const angle = p.angle + spread;
          room.bullets.push({
            x: p.x, y: p.y,
            vx: Math.cos(angle) * BULLET_SPEED,
            vy: Math.sin(angle) * BULLET_SPEED,
            damage: w.damage,
            range: w.range,
            traveled: 0,
            owner: p.id,
            weapon: p.weapon,
          });
        }
        broadcast(room, { type: 'shot', id: p.id, weapon: p.weapon });
        if (p.ammo[p.weapon] === 0 && p.reserve[p.weapon] > 0) {
          p.reloading = true;
          let reloadTime = w.reload;
          if (p.perks.includes('speedcola')) reloadTime *= 0.5;
          p.reloadEnd = now + reloadTime;
        }
      }
    }
  }

  // Update bullets
  for (let i = room.bullets.length - 1; i >= 0; i--) {
    const b = room.bullets[i];
    b.x += b.vx; b.y += b.vy;
    b.traveled += BULLET_SPEED;
    let remove = false;
    if (b.traveled > b.range || b.x < 0 || b.x > MAP_W || b.y < 0 || b.y > MAP_H) {
      remove = true;
    }
    // Wall collision
    for (const w of getWalls(room)) {
      if (b.x >= w.x && b.x <= w.x + w.w && b.y >= w.y && b.y <= w.y + w.h) {
        remove = true; break;
      }
    }
    // Zombie collision
    if (!remove) {
      for (let j = room.zombies.length - 1; j >= 0; j--) {
        const z = room.zombies[j];
        const dx = b.x - z.x, dy = b.y - z.y;
        if (dx*dx + dy*dy < ZOMBIE_RADIUS * ZOMBIE_RADIUS) {
          z.hp -= b.damage;
          remove = true;
          const owner = room.players.get(b.owner);
          if (owner) {
            owner.points += 10;
            if (z.hp <= 0) {
              owner.points += 50;
              owner.kills++;
              room.zombiesRemaining--;
              room.zombies.splice(j, 1);
              broadcast(room, { type: 'zombieDeath', x: z.x, y: z.y });
            }
          }
          break;
        }
      }
    }
    if (remove) room.bullets.splice(i, 1);
  }

  // Update zombies
  for (const z of room.zombies) {
    // Find nearest alive player
    let nearest = null, nearDist = Infinity;
    for (const p of room.players.values()) {
      if (p.dead) continue;
      const dx = p.x - z.x, dy = p.y - z.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < nearDist) { nearDist = dist; nearest = p; }
    }
    if (!nearest) continue;

    // Check for barricade in path
    let targetBarricade = null;
    for (const b of room.barricades) {
      if (b.hp <= 0) continue;
      const dx = (b.x + b.w/2) - z.x, dy = (b.y + b.h/2) - z.y;
      if (Math.sqrt(dx*dx + dy*dy) < 60) {
        targetBarricade = b;
        break;
      }
    }

    if (targetBarricade && targetBarricade.hp > 0) {
      // Attack barricade
      z.attackCooldown -= dt;
      if (z.attackCooldown <= 0) {
        targetBarricade.hp -= 10;
        z.attackCooldown = 1000;
        if (targetBarricade.hp <= 0) {
          broadcast(room, { type: 'barricadeBreak', id: targetBarricade.id });
        }
      }
    } else {
      // Move toward player
      const dx = nearest.x - z.x, dy = nearest.y - z.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist > 20) {
        const mx = (dx / dist) * z.speed;
        const my = (dy / dist) * z.speed;
        const nx = z.x + mx, ny = z.y + my;
        // Simple wall avoidance
        if (canMove(nx, z.y, ZOMBIE_RADIUS, room)) z.x = nx;
        else z.stuck++;
        if (canMove(z.x, ny, ZOMBIE_RADIUS, room)) z.y = ny;
        else z.stuck++;
        // If stuck, try to go around
        if (z.stuck > 30) {
          z.x += (Math.random() - 0.5) * 10;
          z.y += (Math.random() - 0.5) * 10;
          z.stuck = 0;
        }
      }
      // Attack player
      if (dist < 30 && !nearest.downed) {
        z.attackCooldown -= dt;
        if (z.attackCooldown <= 0) {
          nearest.hp -= z.damage;
          z.attackCooldown = 1000;
          if (nearest.hp <= 0) {
            nearest.downed = true;
            nearest.downTimer = 30000; // 30 sec to revive
            nearest.downs++;
            broadcast(room, { type: 'playerDown', id: nearest.id });
          }
          broadcast(room, { type: 'playerHit', id: nearest.id, hp: nearest.hp });
        }
      }
    }
  }

  // Check round complete
  if (room.zombiesRemaining <= 0 && room.zombiesSpawned >= room.zombiesToSpawn) {
    setTimeout(() => {
      if (room.state === 'playing') startRound(room);
    }, 3000);
    room.zombiesRemaining = -1; // Prevent re-trigger
  }

  // Send state
  broadcastState(room);
}

// ─── NETWORKING ───
function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  for (const [id, p] of room.players) {
    if (p.ws && p.ws.readyState === 1) p.ws.send(data);
  }
}

function broadcastState(room) {
  const players = [];
  for (const p of room.players.values()) {
    players.push({
      id: p.id, name: p.name, x: p.x, y: p.y, angle: p.angle, moving: p.moving,
      hp: p.hp, maxHp: p.maxHp, points: p.points, weapon: p.weapon,
      ammo: p.ammo[p.weapon], reserve: p.reserve[p.weapon],
      reloading: p.reloading, kills: p.kills, perks: p.perks,
      downed: p.downed, dead: p.dead, weapons: p.weapons,
    });
  }
  const zombies = room.zombies.map(z => ({ id: z.id, x: z.x, y: z.y, hp: z.hp, maxHp: z.maxHp }));
  const barricades = room.barricades.map(b => ({ id: b.id, hp: b.hp, maxHp: b.maxHp }));
  const state = {
    type: 'state',
    players, zombies, barricades,
    round: room.round,
    zombiesRemaining: Math.max(0, room.zombiesRemaining),
    powerOn: room.powerOn,
    doors: room.doors.map(d => ({ id: d.id, open: d.open })),
  };
  broadcast(room, state);
}

function getPlayerStats(room) {
  return [...room.players.values()].map(p => ({
    name: p.name, kills: p.kills, headshots: p.headshots,
    revives: p.revives, downs: p.downs, points: p.points,
  }));
}

// ─── WEBSOCKET ───
wss.on('connection', (ws) => {
  let playerId = Math.random().toString(36).substr(2, 9);
  let currentRoom = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'create': {
        const code = Math.random().toString(36).substr(2, 6).toUpperCase();
        const room = createRoom(code);
        rooms.set(code, room);
        const player = createPlayer(playerId, msg.name || 'Player');
        player.ws = ws;
        player.isHost = true;
        room.players.set(playerId, player);
        currentRoom = room;
        ws.send(JSON.stringify({ type: 'joined', code, playerId, isHost: true, map: getMapData(room) }));
        broadcastLobby(room);
        break;
      }
      case 'join': {
        const room = rooms.get(msg.code?.toUpperCase());
        if (!room) { ws.send(JSON.stringify({ type: 'error', msg: 'Room not found' })); break; }
        if (room.state !== 'lobby') { ws.send(JSON.stringify({ type: 'error', msg: 'Game already started' })); break; }
        if (room.players.size >= 4) { ws.send(JSON.stringify({ type: 'error', msg: 'Room full' })); break; }
        const player = createPlayer(playerId, msg.name || 'Player');
        player.ws = ws;
        player.isHost = false;
        room.players.set(playerId, player);
        currentRoom = room;
        ws.send(JSON.stringify({ type: 'joined', code: room.code, playerId, isHost: false, map: getMapData(room) }));
        broadcastLobby(room);
        break;
      }
      case 'start': {
        if (!currentRoom) break;
        const p = currentRoom.players.get(playerId);
        if (!p?.isHost) break;
        currentRoom.state = 'playing';
        broadcast(currentRoom, { type: 'gameStart' });
        startRound(currentRoom);
        currentRoom.lastTick = Date.now();
        currentRoom.tickInterval = setInterval(() => gameTick(currentRoom), 1000 / TICK_RATE);
        break;
      }
      case 'input': {
        if (!currentRoom) break;
        const p = currentRoom.players.get(playerId);
        if (!p) break;
        if (msg.inputs) p.inputs = msg.inputs;
        if (msg.angle !== undefined) p.angle = msg.angle;
        break;
      }
      case 'interact': {
        if (!currentRoom) break;
        const p = currentRoom.players.get(playerId);
        if (!p || p.dead || p.downed) break;
        // Buy door
        for (const d of currentRoom.doors) {
          if (d.open) continue;
          const dx = (d.x + d.w/2) - p.x, dy = (d.y + d.h/2) - p.y;
          if (Math.sqrt(dx*dx + dy*dy) < 80 && p.points >= d.price) {
            p.points -= d.price;
            d.open = true;
            broadcast(currentRoom, { type: 'doorOpen', id: d.id });
          }
        }
        // Buy wall weapon
        for (const wb of WALLBUYS) {
          const dx = wb.x - p.x, dy = wb.y - p.y;
          if (Math.sqrt(dx*dx + dy*dy) < 60) {
            const w = WEAPONS[wb.weapon];
            if (p.points >= w.price) {
              if (!p.weapons.includes(wb.weapon)) {
                if (p.weapons.length >= 2) {
                  // Replace current weapon
                  const idx = p.weapons.indexOf(p.weapon);
                  p.weapons[idx] = wb.weapon;
                } else {
                  p.weapons.push(wb.weapon);
                }
              }
              p.weapon = wb.weapon;
              p.ammo[wb.weapon] = w.magSize;
              p.reserve[wb.weapon] = w.maxAmmo;
              p.points -= w.price;
              p.reloading = false;
              broadcast(currentRoom, { type: 'weaponBuy', id: p.id, weapon: wb.weapon });
            }
          }
        }
        // Buy perk
        if (currentRoom.powerOn) {
          for (const pl of PERK_LOCATIONS) {
            const dx = pl.x - p.x, dy = pl.y - p.y;
            if (Math.sqrt(dx*dx + dy*dy) < 60) {
              const perk = PERKS[pl.perk];
              if (p.points >= perk.price && !p.perks.includes(pl.perk)) {
                p.points -= perk.price;
                p.perks.push(pl.perk);
                if (pl.perk === 'juggernog') { p.maxHp = 250; p.hp = Math.min(p.hp + 150, 250); }
                broadcast(currentRoom, { type: 'perkBuy', id: p.id, perk: pl.perk });
              }
            }
          }
        }
        // Mystery box
        {
          const dx = (MYSTERY_BOX.x + 30) - p.x, dy = (MYSTERY_BOX.y + 20) - p.y;
          if (Math.sqrt(dx*dx + dy*dy) < 60 && p.points >= MYSTERY_BOX.price) {
            const allWeapons = Object.keys(WEAPONS);
            const randomWeapon = allWeapons[Math.floor(Math.random() * allWeapons.length)];
            p.points -= MYSTERY_BOX.price;
            if (!p.weapons.includes(randomWeapon)) {
              if (p.weapons.length >= 2) {
                const idx = p.weapons.indexOf(p.weapon);
                p.weapons[idx] = randomWeapon;
              } else {
                p.weapons.push(randomWeapon);
              }
            }
            p.weapon = randomWeapon;
            const w = WEAPONS[randomWeapon];
            p.ammo[randomWeapon] = w.magSize;
            p.reserve[randomWeapon] = w.maxAmmo;
            p.reloading = false;
            broadcast(currentRoom, { type: 'mysteryBox', id: p.id, weapon: randomWeapon });
          }
        }
        // Power switch
        if (!currentRoom.powerOn) {
          const dx = POWER_SWITCH.x - p.x, dy = POWER_SWITCH.y - p.y;
          if (Math.sqrt(dx*dx + dy*dy) < 60) {
            currentRoom.powerOn = true;
            broadcast(currentRoom, { type: 'powerOn' });
          }
        }
        // Repair barricade
        for (const b of currentRoom.barricades) {
          if (b.hp >= b.maxHp) continue;
          const bx = b.x + b.w/2, by = b.y + b.h/2;
          const dx = bx - p.x, dy = by - p.y;
          if (Math.sqrt(dx*dx + dy*dy) < 60 && Date.now() - p.lastBarricadeRepair > 500) {
            b.hp = Math.min(b.hp + 20, b.maxHp);
            p.points += 10;
            p.lastBarricadeRepair = Date.now();
            broadcast(currentRoom, { type: 'barricadeRepair', id: b.id, hp: b.hp });
          }
        }
        break;
      }
      case 'switch': {
        if (!currentRoom) break;
        const p = currentRoom.players.get(playerId);
        if (!p || p.dead || p.downed) break;
        const curIdx = p.weapons.indexOf(p.weapon);
        const nextIdx = (curIdx + 1) % p.weapons.length;
        p.weapon = p.weapons[nextIdx];
        p.reloading = false;
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      currentRoom.players.delete(playerId);
      if (currentRoom.players.size === 0) {
        clearInterval(currentRoom.tickInterval);
        rooms.delete(currentRoom.code);
      } else {
        broadcastLobby(currentRoom);
      }
    }
  });
});

function broadcastLobby(room) {
  const players = [...room.players.values()].map(p => ({ id: p.id, name: p.name, isHost: p.isHost }));
  broadcast(room, { type: 'lobby', players, code: room.code });
}

function getMapData(room) {
  return {
    width: MAP_W, height: MAP_H,
    walls: WALLS,
    doors: room.doors,
    barricades: room.barricades.map(b => ({ ...b })),
    wallbuys: WALLBUYS.map(wb => ({ ...wb, ...WEAPONS[wb.weapon] })),
    perkLocations: PERK_LOCATIONS.map(pl => ({ ...pl, ...PERKS[pl.perk] })),
    mysteryBox: MYSTERY_BOX,
    powerSwitch: POWER_SWITCH,
    weapons: WEAPONS,
    perks: PERKS,
  };
}

const PORT = process.env.PORT || 3333;
server.listen(PORT, () => console.log(`Zombies server on :${PORT}`));
