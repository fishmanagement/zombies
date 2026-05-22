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
const TICK_RATE = 20;
const TICK_MS = 1000 / TICK_RATE;
const MAP_W = 2000, MAP_H = 1400;
const PLAYER_SPEED = 4;
const PLAYER_RADIUS = 14;
const ZOMBIE_RADIUS = 11;
const BULLET_SPEED = 14;
const BARRICADE_HP = 80;

const WEAPONS = {
  pistol:   { name: 'M1911',     damage: 30,  fireRate: 280, reload: 1500, magSize: 8,  maxAmmo: 96,  spread: 0.03, bulletCount: 1, price: 0,    range: 500 },
  shotgun:  { name: 'Olympia',   damage: 45,  fireRate: 700, reload: 2200, magSize: 2,  maxAmmo: 54,  spread: 0.18, bulletCount: 6, price: 500,  range: 250 },
  smg:      { name: 'MP40',      damage: 22,  fireRate: 100, reload: 1800, magSize: 32, maxAmmo: 192, spread: 0.09, bulletCount: 1, price: 1000, range: 380 },
  ar:       { name: 'STG-44',    damage: 35,  fireRate: 140, reload: 2200, magSize: 30, maxAmmo: 210, spread: 0.04, bulletCount: 1, price: 1200, range: 550 },
  lmg:      { name: 'MG42',      damage: 28,  fireRate: 70,  reload: 3500, magSize: 75, maxAmmo: 300, spread: 0.11, bulletCount: 1, price: 1750, range: 450 },
  ray:      { name: 'Ray Gun',   damage: 150, fireRate: 350, reload: 2800, magSize: 20, maxAmmo: 160, spread: 0.02, bulletCount: 1, price: 950,  range: 600 },
};

const PERKS = {
  juggernog:  { name: 'Juggernog',   price: 2500, color: '#ff4444' },
  speedcola:  { name: 'Speed Cola',  price: 3000, color: '#44ff44' },
  doubletap:  { name: 'Double Tap',  price: 2000, color: '#ffff44' },
  quickrevive:{ name: 'Quick Revive',price: 1500, color: '#4444ff' },
};

// ─── SIMPLIFIED MAP ───
// Smaller, more open map so zombies can actually reach players
const WALLS = [
  // Outer boundary
  { x: 0, y: 0, w: MAP_W, h: 16 },
  { x: 0, y: MAP_H - 16, w: MAP_W, h: 16 },
  { x: 0, y: 0, w: 16, h: MAP_H },
  { x: MAP_W - 16, y: 0, w: 16, h: MAP_H },

  // Room 1 (spawn) dividers — left side wall with door gap
  { x: 500, y: 0, w: 16, h: 300 },
  { x: 500, y: 420, w: 16, h: 280 },    // gap 300-420 = door d1
  { x: 500, y: 820, w: 16, h: 280 },
  { x: 500, y: 1220, w: 16, h: 180 },   // gap 1100-1220 = door d2

  // Room 1 right wall with door gap
  { x: 1000, y: 0, w: 16, h: 500 },
  { x: 1000, y: 620, w: 16, h: 780 },   // gap 500-620 = door d3

  // Room 3 (power room) wall
  { x: 1400, y: 200, w: 16, h: 400 },
  { x: 1400, y: 720, w: 16, h: 480 },   // gap 600-720 = door d4
];

const DOORS = [
  { id: 'd1', x: 500, y: 300, w: 16, h: 120, price: 750, open: false, label: 'Left Wing' },
  { id: 'd2', x: 500, y: 1100, w: 16, h: 120, price: 750, open: false, label: 'Storage' },
  { id: 'd3', x: 1000, y: 500, w: 16, h: 120, price: 1000, open: false, label: 'East Wing' },
  { id: 'd4', x: 1400, y: 600, w: 16, h: 120, price: 1250, open: false, label: 'Power Room' },
];

// Barricades are entry points — zombies spawn behind them and must break through
const BARRICADES = [
  { id: 'b1', x: 16, y: 150, w: 16, h: 70, hp: BARRICADE_HP, maxHp: BARRICADE_HP },
  { id: 'b2', x: 16, y: 600, w: 16, h: 70, hp: BARRICADE_HP, maxHp: BARRICADE_HP },
  { id: 'b3', x: 16, y: 1100, w: 16, h: 70, hp: BARRICADE_HP, maxHp: BARRICADE_HP },
  { id: 'b4', x: MAP_W - 32, y: 300, w: 16, h: 70, hp: BARRICADE_HP, maxHp: BARRICADE_HP },
  { id: 'b5', x: MAP_W - 32, y: 900, w: 16, h: 70, hp: BARRICADE_HP, maxHp: BARRICADE_HP },
  { id: 'b6', x: 700, y: MAP_H - 32, w: 70, h: 16, hp: BARRICADE_HP, maxHp: BARRICADE_HP },
];

// Zombie spawn points — just outside the map at barricade locations
const ZOMBIE_SPAWNS = [
  { x: 5, y: 185, barricade: 'b1' },
  { x: 5, y: 635, barricade: 'b2' },
  { x: 5, y: 1135, barricade: 'b3' },
  { x: MAP_W - 5, y: 335, barricade: 'b4' },
  { x: MAP_W - 5, y: 935, barricade: 'b5' },
  { x: 735, y: MAP_H - 5, barricade: 'b6' },
];

const WALLBUYS = [
  { weapon: 'shotgun', x: 550, y: 200, room: 0 },
  { weapon: 'smg', x: 250, y: 850, room: 1 },
  { weapon: 'ar', x: 1100, y: 350, room: 2 },
  { weapon: 'lmg', x: 1500, y: 800, room: 3 },
];

const PERK_LOCATIONS = [
  { perk: 'quickrevive', x: 750, y: 250, room: 0 },
  { perk: 'juggernog', x: 250, y: 1200, room: 1 },
  { perk: 'speedcola', x: 1200, y: 900, room: 2 },
  { perk: 'doubletap', x: 1600, y: 500, room: 3 },
];

const MYSTERY_BOX = { x: 1550, y: 350, w: 60, h: 40, price: 950 };
const POWER_SWITCH = { x: 1800, y: 400 };
const PLAYER_SPAWNS = [
  { x: 750, y: 500 }, { x: 750, y: 700 }, { x: 650, y: 600 }, { x: 850, y: 600 }
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
    roundPause: 0,
    state: 'lobby',
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
  const spawnInfo = ZOMBIE_SPAWNS[Math.floor(Math.random() * ZOMBIE_SPAWNS.length)];
  const hpBase = 80 + round * 40;
  const speedBase = 1.0 + Math.min(round * 0.15, 2.5);
  return {
    id: Math.random().toString(36).substr(2, 9),
    x: spawnInfo.x + (Math.random() - 0.5) * 10,
    y: spawnInfo.y + (Math.random() - 0.5) * 10,
    hp: hpBase + Math.random() * 20,
    maxHp: hpBase + 20,
    speed: speedBase + Math.random() * 0.4,
    targetBarricade: spawnInfo.barricade,
    phase: 'approach_barricade', // approach_barricade -> break_barricade -> hunt
    attackTimer: 0,
    damage: 20 + Math.floor(round / 2) * 5,
    stuckTimer: 0,
    wanderAngle: Math.random() * Math.PI * 2,
    wanderTimer: 0,
  };
}

// ─── COLLISION ───
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
  // Intact barricades act as walls
  for (const b of room.barricades) {
    if (b.hp > 0) {
      const bd = BARRICADES.find(bb => bb.id === b.id);
      if (bd) walls.push(bd);
    }
  }
  return walls;
}

function getWallsForZombie(room, zombie) {
  // Zombies ignore their target barricade (they attack it instead)
  const walls = [...WALLS];
  for (const d of room.doors) {
    if (!d.open) walls.push(d);
  }
  for (const b of room.barricades) {
    if (b.hp > 0 && b.id !== zombie.targetBarricade) {
      const bd = BARRICADES.find(bb => bb.id === b.id);
      if (bd) walls.push(bd);
    }
  }
  return walls;
}

function canMove(x, y, radius, walls) {
  for (const w of walls) {
    if (circleRect(x, y, radius, w.x, w.y, w.w, w.h)) return false;
  }
  return x - radius >= 0 && x + radius <= MAP_W && y - radius >= 0 && y + radius <= MAP_H;
}

function dist(x1, y1, x2, y2) {
  const dx = x1 - x2, dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

function moveToward(entity, tx, ty, speed, walls, radius) {
  const dx = tx - entity.x, dy = ty - entity.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 2) return false;
  const mx = (dx / d) * speed, my = (dy / d) * speed;
  const nx = entity.x + mx, ny = entity.y + my;
  let moved = false;
  if (canMove(nx, entity.y, radius, walls)) { entity.x = nx; moved = true; }
  if (canMove(entity.x, ny, radius, walls)) { entity.y = ny; moved = true; }
  return moved;
}

// ─── GAME LOOP ───
function startRound(room) {
  room.round++;
  room.zombiesToSpawn = Math.floor(4 + room.round * 3 + room.players.size * 2);
  room.zombiesSpawned = 0;
  room.zombiesRemaining = room.zombiesToSpawn;
  room.spawnTimer = 0;
  room.roundPause = 0;
  // Heal players between rounds
  for (const p of room.players.values()) {
    if (!p.dead && !p.downed) p.hp = p.maxHp;
  }
  broadcast(room, { type: 'round', round: room.round });
}

function gameTick(room) {
  const now = Date.now();
  const dt = Math.min(now - room.lastTick, 100);
  room.lastTick = now;
  if (room.state !== 'playing') return;

  // Check all dead
  const alivePlayers = [...room.players.values()].filter(p => !p.dead);
  if (alivePlayers.length === 0) {
    room.state = 'gameover';
    broadcast(room, { type: 'gameover', round: room.round, players: getPlayerStats(room) });
    clearInterval(room.tickInterval);
    return;
  }

  // Round pause between rounds
  if (room.roundPause > 0) {
    room.roundPause -= dt;
    if (room.roundPause <= 0) startRound(room);
    broadcastState(room);
    return;
  }

  // Spawn zombies
  room.spawnTimer -= dt;
  if (room.zombiesSpawned < room.zombiesToSpawn && room.spawnTimer <= 0 && room.zombies.length < 20) {
    room.zombies.push(createZombie(room, room.round));
    room.zombiesSpawned++;
    room.spawnTimer = Math.max(400, 1800 - room.round * 80);
  }

  // === PLAYERS ===
  for (const p of room.players.values()) {
    if (p.dead) continue;

    if (p.downed) {
      p.downTimer -= dt;
      if (p.downTimer <= 0) { p.dead = true; continue; }
      for (const other of room.players.values()) {
        if (other.id === p.id || other.dead || other.downed) continue;
        if (dist(other.x, other.y, p.x, p.y) < 50) {
          p.downTimer += dt * 3;
          if (p.downTimer > 30000) {
            p.downed = false;
            p.hp = p.maxHp * 0.5;
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
    if (p.perks.includes('speedcola')) speed *= 1.15;
    let mx = 0, my = 0;
    if (p.inputs.up) my -= 1;
    if (p.inputs.down) my += 1;
    if (p.inputs.left) mx -= 1;
    if (p.inputs.right) mx += 1;
    const playerWalls = getWalls(room);
    if (mx || my) {
      const len = Math.sqrt(mx * mx + my * my);
      mx = mx / len * speed; my = my / len * speed;
      if (canMove(p.x + mx, p.y, PLAYER_RADIUS, playerWalls)) p.x += mx;
      if (canMove(p.x, p.y + my, PLAYER_RADIUS, playerWalls)) p.y += my;
      p.moving = true;
    } else {
      p.moving = false;
    }

    // Reload
    if (p.reloading && now >= p.reloadEnd) {
      const w = WEAPONS[p.weapon];
      const needed = w.magSize - (p.ammo[p.weapon] || 0);
      const available = Math.min(needed, p.reserve[p.weapon] || 0);
      p.ammo[p.weapon] = (p.ammo[p.weapon] || 0) + available;
      p.reserve[p.weapon] = (p.reserve[p.weapon] || 0) - available;
      p.reloading = false;
    }
    if (p.inputs.reload && !p.reloading) {
      const w = WEAPONS[p.weapon];
      if (w && (p.ammo[p.weapon] || 0) < w.magSize && (p.reserve[p.weapon] || 0) > 0) {
        p.reloading = true;
        let reloadTime = w.reload;
        if (p.perks.includes('speedcola')) reloadTime *= 0.5;
        p.reloadEnd = now + reloadTime;
      }
    }

    // Shooting
    if (p.inputs.shoot && !p.reloading && !p.downed) {
      const w = WEAPONS[p.weapon];
      if (!w) continue;
      let fireRate = w.fireRate;
      if (p.perks.includes('doubletap')) fireRate *= 0.65;
      if (now - p.lastShot >= fireRate && (p.ammo[p.weapon] || 0) > 0) {
        p.lastShot = now;
        p.ammo[p.weapon]--;
        for (let i = 0; i < w.bulletCount; i++) {
          const spread = (Math.random() - 0.5) * w.spread;
          const angle = p.angle + spread;
          room.bullets.push({
            x: p.x + Math.cos(p.angle) * 18,
            y: p.y + Math.sin(p.angle) * 18,
            vx: Math.cos(angle) * BULLET_SPEED,
            vy: Math.sin(angle) * BULLET_SPEED,
            damage: w.damage,
            range: w.range,
            traveled: 0,
            owner: p.id,
          });
        }
        broadcast(room, { type: 'shot', id: p.id, weapon: p.weapon });
        if (p.ammo[p.weapon] <= 0 && (p.reserve[p.weapon] || 0) > 0) {
          p.reloading = true;
          let rt = w.reload;
          if (p.perks.includes('speedcola')) rt *= 0.5;
          p.reloadEnd = now + rt;
        }
      }
    }
  }

  // === BULLETS ===
  const bulletWalls = getWalls(room);
  for (let i = room.bullets.length - 1; i >= 0; i--) {
    const b = room.bullets[i];
    b.x += b.vx; b.y += b.vy;
    b.traveled += BULLET_SPEED;
    let remove = b.traveled > b.range || b.x < 0 || b.x > MAP_W || b.y < 0 || b.y > MAP_H;
    if (!remove) {
      for (const w of bulletWalls) {
        if (b.x >= w.x && b.x <= w.x + w.w && b.y >= w.y && b.y <= w.y + w.h) {
          remove = true; break;
        }
      }
    }
    if (!remove) {
      for (let j = room.zombies.length - 1; j >= 0; j--) {
        const z = room.zombies[j];
        if (dist(b.x, b.y, z.x, z.y) < ZOMBIE_RADIUS + 4) {
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

  // === ZOMBIES ===
  for (const z of room.zombies) {
    z.attackTimer = Math.max(0, z.attackTimer - dt);

    // Find nearest alive non-downed player
    let nearest = null, nearDist = Infinity;
    for (const p of room.players.values()) {
      if (p.dead) continue;
      const d = dist(p.x, p.y, z.x, z.y);
      if (d < nearDist) { nearDist = d; nearest = p; }
    }
    if (!nearest) continue;

    const zombieWalls = getWallsForZombie(room, z);

    // Phase logic
    if (z.phase === 'approach_barricade') {
      const barricade = room.barricades.find(b => b.id === z.targetBarricade);
      const bd = BARRICADES.find(b => b.id === z.targetBarricade);
      if (!barricade || !bd || barricade.hp <= 0) {
        z.phase = 'hunt';
      } else {
        const bCenterX = bd.x + bd.w / 2;
        const bCenterY = bd.y + bd.h / 2;
        const bDist = dist(z.x, z.y, bCenterX, bCenterY);
        if (bDist < 30) {
          z.phase = 'break_barricade';
        } else {
          // Move toward barricade (ignore it as wall)
          moveToward(z, bCenterX, bCenterY, z.speed, zombieWalls, ZOMBIE_RADIUS);
        }
      }
    }

    if (z.phase === 'break_barricade') {
      const barricade = room.barricades.find(b => b.id === z.targetBarricade);
      if (!barricade || barricade.hp <= 0) {
        z.phase = 'hunt';
      } else {
        // Attack the barricade
        if (z.attackTimer <= 0) {
          barricade.hp = Math.max(0, barricade.hp - 15);
          z.attackTimer = 800;
          if (barricade.hp <= 0) {
            z.phase = 'hunt';
            broadcast(room, { type: 'barricadeBreak', id: barricade.id });
          }
        }
      }
    }

    if (z.phase === 'hunt') {
      // Move toward nearest player
      const moved = moveToward(z, nearest.x, nearest.y, z.speed, zombieWalls, ZOMBIE_RADIUS);

      if (!moved) {
        z.stuckTimer += dt;
        if (z.stuckTimer > 500) {
          // Wall slide: try perpendicular directions
          z.wanderTimer += dt;
          const perpAngle = Math.atan2(nearest.y - z.y, nearest.x - z.x) + (z.wanderTimer % 2000 < 1000 ? Math.PI / 2 : -Math.PI / 2);
          const slideX = z.x + Math.cos(perpAngle) * z.speed * 1.5;
          const slideY = z.y + Math.sin(perpAngle) * z.speed * 1.5;
          if (canMove(slideX, z.y, ZOMBIE_RADIUS, zombieWalls)) z.x = slideX;
          if (canMove(z.x, slideY, ZOMBIE_RADIUS, zombieWalls)) z.y = slideY;
          if (z.stuckTimer > 3000) z.stuckTimer = 0; // Reset
        }
      } else {
        z.stuckTimer = 0;
      }

      // Attack player if close
      if (nearDist < 28 && z.attackTimer <= 0) {
        nearest.hp -= z.damage;
        z.attackTimer = 900;
        broadcast(room, { type: 'playerHit', id: nearest.id, hp: nearest.hp });
        if (nearest.hp <= 0 && !nearest.downed) {
          nearest.downed = true;
          nearest.downTimer = 30000;
          broadcast(room, { type: 'playerDown', id: nearest.id });
        }
      }
    }
  }

  // Check round complete
  if (room.zombiesRemaining <= 0 && room.zombiesSpawned >= room.zombiesToSpawn && room.roundPause <= 0) {
    room.roundPause = 4000; // 4 sec between rounds
  }

  broadcastState(room);
}

// ─── NETWORKING ───
function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  for (const [, p] of room.players) {
    if (p.ws && p.ws.readyState === 1) p.ws.send(data);
  }
}

function broadcastState(room) {
  const players = [];
  for (const p of room.players.values()) {
    players.push({
      id: p.id, name: p.name, x: p.x, y: p.y, angle: p.angle, moving: p.moving,
      hp: p.hp, maxHp: p.maxHp, points: p.points, weapon: p.weapon,
      ammo: p.ammo[p.weapon] || 0, reserve: p.reserve[p.weapon] || 0,
      reloading: p.reloading, kills: p.kills, perks: p.perks,
      downed: p.downed, dead: p.dead, weapons: p.weapons,
    });
  }
  const zombies = room.zombies.map(z => ({ id: z.id, x: z.x, y: z.y, hp: z.hp, maxHp: z.maxHp, phase: z.phase }));
  const barricades = room.barricades.map(b => ({ id: b.id, hp: b.hp, maxHp: b.maxHp }));
  broadcast(room, {
    type: 'state', players, zombies, barricades,
    round: room.round,
    zombiesRemaining: Math.max(0, room.zombiesRemaining),
    powerOn: room.powerOn,
    doors: room.doors.map(d => ({ id: d.id, open: d.open })),
  });
}

function getPlayerStats(room) {
  return [...room.players.values()].map(p => ({
    name: p.name, kills: p.kills, revives: p.revives, downs: p.downs, points: p.points,
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
        if (room.state !== 'lobby') { ws.send(JSON.stringify({ type: 'error', msg: 'Game in progress' })); break; }
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
        currentRoom.tickInterval = setInterval(() => gameTick(currentRoom), TICK_MS);
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
          const cx = d.x + d.w / 2, cy = d.y + d.h / 2;
          if (dist(p.x, p.y, cx, cy) < 80 && p.points >= d.price) {
            p.points -= d.price;
            d.open = true;
            broadcast(currentRoom, { type: 'doorOpen', id: d.id });
          }
        }
        // Wall buy
        for (const wb of WALLBUYS) {
          if (dist(p.x, p.y, wb.x, wb.y) < 60) {
            const w = WEAPONS[wb.weapon];
            if (p.points >= w.price) {
              if (!p.weapons.includes(wb.weapon)) {
                if (p.weapons.length >= 2) {
                  p.weapons[p.weapons.indexOf(p.weapon)] = wb.weapon;
                } else {
                  p.weapons.push(wb.weapon);
                }
              }
              p.weapon = wb.weapon;
              p.ammo[wb.weapon] = w.magSize;
              p.reserve[wb.weapon] = w.maxAmmo;
              p.points -= w.price;
              p.reloading = false;
            }
          }
        }
        // Perks
        if (currentRoom.powerOn) {
          for (const pl of PERK_LOCATIONS) {
            if (dist(p.x, p.y, pl.x, pl.y) < 60) {
              const perk = PERKS[pl.perk];
              if (p.points >= perk.price && !p.perks.includes(pl.perk)) {
                p.points -= perk.price;
                p.perks.push(pl.perk);
                if (pl.perk === 'juggernog') { p.maxHp = 250; p.hp = Math.min(p.hp + 150, 250); }
              }
            }
          }
        }
        // Mystery box
        {
          const mbx = MYSTERY_BOX.x + 30, mby = MYSTERY_BOX.y + 20;
          if (dist(p.x, p.y, mbx, mby) < 60 && p.points >= MYSTERY_BOX.price) {
            const allW = Object.keys(WEAPONS);
            const rw = allW[Math.floor(Math.random() * allW.length)];
            p.points -= MYSTERY_BOX.price;
            if (!p.weapons.includes(rw)) {
              if (p.weapons.length >= 2) p.weapons[p.weapons.indexOf(p.weapon)] = rw;
              else p.weapons.push(rw);
            }
            p.weapon = rw;
            p.ammo[rw] = WEAPONS[rw].magSize;
            p.reserve[rw] = WEAPONS[rw].maxAmmo;
            p.reloading = false;
            broadcast(currentRoom, { type: 'mysteryBox', id: p.id, weapon: rw });
          }
        }
        // Power switch
        if (!currentRoom.powerOn && dist(p.x, p.y, POWER_SWITCH.x, POWER_SWITCH.y) < 60) {
          currentRoom.powerOn = true;
          broadcast(currentRoom, { type: 'powerOn' });
        }
        // Repair barricade
        for (const b of currentRoom.barricades) {
          const bd = BARRICADES.find(bb => bb.id === b.id);
          if (!bd || b.hp >= b.maxHp) continue;
          if (dist(p.x, p.y, bd.x + bd.w / 2, bd.y + bd.h / 2) < 60 && Date.now() - p.lastBarricadeRepair > 400) {
            b.hp = Math.min(b.hp + 25, b.maxHp);
            p.points += 10;
            p.lastBarricadeRepair = Date.now();
          }
        }
        break;
      }
      case 'switch': {
        if (!currentRoom) break;
        const p = currentRoom.players.get(playerId);
        if (!p || p.dead || p.downed) break;
        const idx = p.weapons.indexOf(p.weapon);
        p.weapon = p.weapons[(idx + 1) % p.weapons.length];
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
    barricades: BARRICADES,
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
