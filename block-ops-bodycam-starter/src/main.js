import * as THREE from "three";
import "./style.css";

const el = {
  game: document.getElementById("game"),
  menu: document.getElementById("menu"),
  pauseMenu: document.getElementById("pauseMenu"),
  playBtn: document.getElementById("playBtn"),
  resumeBtn: document.getElementById("resumeBtn"),
  backMenuBtn: document.getElementById("backMenuBtn"),
  loadoutSelect: document.getElementById("loadoutSelect"),
  goreSelect: document.getElementById("goreSelect"),
  pauseGoreSelect: document.getElementById("pauseGoreSelect"),
  helmetCamStart: document.getElementById("helmetCamStart"),
  hud: document.getElementById("hud"),
  weaponName: document.getElementById("weaponName"),
  modeText: document.getElementById("modeText"),
  enemyText: document.getElementById("enemyText"),
  healthBar: document.getElementById("healthBar"),
  injuryText: document.getElementById("injuryText"),
  ammoText: document.getElementById("ammoText"),
  statusText: document.getElementById("statusText"),
  crosshair: document.getElementById("crosshair"),
  redDot: document.getElementById("redDot"),
  message: document.getElementById("message"),
  deathScreen: document.getElementById("deathScreen"),
};

const WEAPONS = {
  pistol: { name: "Service Pistol", mag: 15, reserve: 60, fireDelay: 0.16, damage: 32, recoil: 0.8, pellets: 1, spread: 0.009, reload: 1.3, laserChance: 0.45, opticChance: 0.2 },
  rifle: { name: "M4 Rifle", mag: 30, reserve: 120, fireDelay: 0.085, damage: 28, recoil: 1.0, pellets: 1, spread: 0.006, reload: 1.8, laserChance: 0.55, opticChance: 0.85 },
  smg: { name: "Compact SMG", mag: 32, reserve: 128, fireDelay: 0.065, damage: 21, recoil: 0.9, pellets: 1, spread: 0.011, reload: 1.55, laserChance: 0.7, opticChance: 0.65 },
  shotgun: { name: "Pump Shotgun", mag: 8, reserve: 40, fireDelay: 0.65, damage: 17, recoil: 1.65, pellets: 8, spread: 0.055, reload: 2.15, laserChance: 0.25, opticChance: 0.15 },
  sniper: { name: "Marksman Rifle", mag: 10, reserve: 40, fireDelay: 0.55, damage: 82, recoil: 1.85, pellets: 1, spread: 0.002, reload: 2.05, laserChance: 0.25, opticChance: 1.0 },
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9bd4ff);
scene.fog = new THREE.Fog(0x9bd4ff, 48, 135);

const camera = new THREE.PerspectiveCamera(84, innerWidth / innerHeight, 0.03, 260);
camera.rotation.order = "YXZ";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
el.game.appendChild(renderer.domElement);
scene.add(camera);

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const wallRay = new THREE.Raycaster();
const keys = new Set();

const hemi = new THREE.HemisphereLight(0xffffff, 0x244d28, 1.25);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 2.05);
sun.position.set(38, 70, 28);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -80;
sun.shadow.camera.right = 80;
sun.shadow.camera.top = 80;
sun.shadow.camera.bottom = -80;
scene.add(sun);

const state = {
  running: false,
  paused: false,
  dead: false,
  pointerLocked: false,
  helmetCam: true,
  aiming: false,
  gore: "high",
  yaw: 0,
  pitch: 0,
  velocity: new THREE.Vector3(),
  health: 100,
  armInjury: 0,
  legInjury: 0,
  weaponKey: "rifle",
  weapon: null,
  ammo: 30,
  reserve: 120,
  reloading: false,
  reloadTimer: 0,
  shootTimer: 0,
  recoil: 0,
  swayX: 0,
  swayY: 0,
  aimAmount: 0,
  highReady: 0,
  messageTimer: 0,
  lastNoise: new THREE.Vector3(),
  noiseTimer: 0,
};

const solidBoxes = [];
const worldMeshes = [];
const glassMeshes = [];
const lightMeshes = [];
const doors = [];
const enemies = [];
const enemyMeshes = [];
const particles = [];
const bulletLines = [];
const droppedItems = [];

let playerBody;
let bodyParts = {};
let fpWeapon;
let fpParts = {};
let helmetOverlay;
let laserLine;
let laserDot;
let muzzleFlash;
let audioCtx;

function mat(color, roughness = 0.78, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function basic(color, transparent = false, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, transparent, opacity, depthWrite: !transparent });
}

function box(w, h, d, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cyl(r1, r2, h, material, seg = 18) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function addWorld(mesh) {
  worldMeshes.push(mesh);
  scene.add(mesh);
  return mesh;
}

function addSolid(x, z, w, d) {
  solidBoxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
}

function pointBlocked(x, z) {
  for (const b of solidBoxes) {
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
  }
  for (const d of doors) {
    if (!d.loose && Math.abs(d.angle) < 0.25) {
      const b = d.block;
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
    }
  }
  return false;
}

function collidesAt(x, z, radius = 0.55) {
  if (x < -47 + radius || x > 47 - radius || z < -47 + radius || z > 47 - radius) return true;
  for (const b of solidBoxes) {
    if (x + radius > b.minX && x - radius < b.maxX && z + radius > b.minZ && z - radius < b.maxZ) return true;
  }
  for (const d of doors) {
    if (!d.loose && Math.abs(d.angle) < 0.25) {
      const b = d.block;
      if (x + radius > b.minX && x - radius < b.maxX && z + radius > b.minZ && z - radius < b.maxZ) return true;
    }
  }
  return false;
}

function lineBlocked(a, b) {
  const steps = 24;
  for (let i = 2; i < steps - 2; i++) {
    const t = i / steps;
    const x = lerp(a.x, b.x, t);
    const z = lerp(a.z, b.z, t);
    if (pointBlocked(x, z)) return true;
  }
  return false;
}

function makeWorld() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(105, 105), mat(0x38433c, 0.96));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  addWorld(floor);

  const grass = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), mat(0x2f9d3a, 1));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.03;
  grass.receiveShadow = true;
  scene.add(grass);

  const wallMat = mat(0xd8d2bf, 0.9);
  const tileMat = mat(0xbec7cc, 0.95);
  const brickMat = mat(0x997a63, 0.88);

  function wall(x, z, w, h, d, material = wallMat) {
    const m = box(w, h, d, material);
    m.position.set(x, h / 2, z);
    addWorld(m);
    addSolid(x, z, w, d);
    return m;
  }

  // Outer closed school-like training facility.
  wall(0, -48, 96, 4.2, 2, brickMat);
  wall(0, 48, 96, 4.2, 2, brickMat);
  wall(-48, 0, 2, 4.2, 96, brickMat);
  wall(48, 0, 2, 4.2, 96, brickMat);

  // Hallways and classrooms.
  wall(0, -18, 76, 3.2, 1.2);
  wall(0, 18, 76, 3.2, 1.2);
  wall(-22, 0, 1.2, 3.2, 34);
  wall(22, 0, 1.2, 3.2, 34);
  wall(-38, -2, 1.2, 3.2, 34);
  wall(38, 2, 1.2, 3.2, 34);
  wall(0, 0, 30, 3.2, 1.2);
  wall(-6, 33, 60, 3.2, 1.2);
  wall(6, -33, 60, 3.2, 1.2);

  // Lockers / desks / cover.
  for (let i = 0; i < 24; i++) {
    const desk = box(2.5, 1.15, 1.3, mat(i % 2 ? 0x6f5537 : 0x4e5c64, 0.85));
    desk.position.set(-39 + Math.random() * 78, 0.58, -39 + Math.random() * 78);
    desk.rotation.y = Math.random() * Math.PI;
    addWorld(desk);
    addSolid(desk.position.x, desk.position.z, 2.9, 1.7);
  }

  for (let i = 0; i < 16; i++) {
    const locker = box(0.7, 2.6, 1.0, tileMat);
    locker.position.set(i < 8 ? -46.3 : 46.3, 1.3, -34 + (i % 8) * 8.5);
    addWorld(locker);
    addSolid(locker.position.x, locker.position.z, 1.0, 1.25);
  }

  // Doors with shootable handles.
  makeDoor(-12, -18.75, 3.8, "z");
  makeDoor(12, 18.75, 3.8, "z");
  makeDoor(-22.75, 10, 3.8, "x");
  makeDoor(22.75, -10, 3.8, "x");

  // Glass windows that break but do not open the building.
  makeGlass(-10, -47.04, 10, 2.0, "z");
  makeGlass(13, 47.04, 10, 2.0, "z");
  makeGlass(-47.04, -12, 10, 2.0, "x");
  makeGlass(47.04, 14, 10, 2.0, "x");

  // Shootable lights.
  for (let x of [-32, 0, 32]) {
    for (let z of [-32, 0, 32]) makeLight(x, z);
  }

  makePlayerBody();
  makeFirstPersonWeapon();
  makeHelmetOverlay();
}

function makeDoor(x, z, width, axis) {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  const panel = box(axis === "z" ? width : 0.18, 2.55, axis === "z" ? 0.18 : width, mat(0x5a4430, 0.82));
  panel.position.y = 1.28;
  const handle = box(0.16, 0.12, 0.16, mat(0xd5b35b, 0.4, 0.2));
  handle.position.set(axis === "z" ? width * 0.34 : 0, 1.22, axis === "x" ? width * 0.34 : 0);
  panel.userData.kind = "door";
  handle.userData.kind = "doorHandle";
  root.add(panel, handle);
  scene.add(root);
  worldMeshes.push(panel, handle);
  const block = axis === "z"
    ? { minX: x - width / 2, maxX: x + width / 2, minZ: z - 0.14, maxZ: z + 0.14 }
    : { minX: x - 0.14, maxX: x + 0.14, minZ: z - width / 2, maxZ: z + width / 2 };
  const door = { root, panel, handle, axis, loose: false, angle: 0, targetAngle: 0, block };
  panel.userData.door = door;
  handle.userData.door = door;
  doors.push(door);
}

function makeGlass(x, z, w, h, axis) {
  const glass = box(axis === "z" ? w : 0.08, h, axis === "z" ? 0.08 : w, new THREE.MeshStandardMaterial({
    color: 0x9fd8ff,
    roughness: 0.06,
    metalness: 0,
    transparent: true,
    opacity: 0.38,
  }));
  glass.position.set(x, 1.9, z);
  glass.userData.kind = "glass";
  glass.userData.broken = false;
  addWorld(glass);
  glassMeshes.push(glass);
}

function makeLight(x, z) {
  const bulb = box(1.3, 0.16, 0.75, mat(0xffffd0, 0.25));
  bulb.position.set(x, 3.06, z);
  bulb.userData.kind = "light";
  addWorld(bulb);
  const light = new THREE.PointLight(0xfff0c2, 0.9, 18);
  light.position.set(x, 2.85, z);
  scene.add(light);
  bulb.userData.light = light;
  lightMeshes.push(bulb);
}

function makePlayerBody() {
  playerBody = new THREE.Group();
  const navy = mat(0x14233d, 0.82);
  const vest = mat(0x111820, 0.74);
  const black = mat(0x030303, 0.88);
  const helmet = mat(0x273227, 0.72, 0.08);
  const glass = new THREE.MeshStandardMaterial({ color: 0x101820, roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.7 });

  bodyParts.torso = box(0.76, 0.78, 0.36, navy);
  bodyParts.torso.position.set(0, 1.0, 0.05);
  bodyParts.vest = box(0.84, 0.62, 0.43, vest);
  bodyParts.vest.position.set(0, 1.04, -0.02);
  bodyParts.head = box(0.48, 0.5, 0.48, black);
  bodyParts.head.position.set(0, 1.76, 0);
  bodyParts.goggles = box(0.43, 0.16, 0.06, glass);
  bodyParts.goggles.position.set(0, 1.84, -0.285);
  bodyParts.helmet = box(0.62, 0.24, 0.58, helmet);
  bodyParts.helmet.position.set(0, 2.02, 0);
  bodyParts.lArm = box(0.23, 0.78, 0.23, navy);
  bodyParts.lArm.position.set(-0.55, 1.16, -0.05);
  bodyParts.rArm = box(0.23, 0.78, 0.23, navy);
  bodyParts.rArm.position.set(0.55, 1.16, -0.05);
  bodyParts.lLeg = box(0.27, 0.72, 0.27, mat(0x182333, 0.82));
  bodyParts.lLeg.position.set(-0.2, 0.3, 0);
  bodyParts.rLeg = box(0.27, 0.72, 0.27, mat(0x182333, 0.82));
  bodyParts.rLeg.position.set(0.2, 0.3, 0);
  bodyParts.bodyGun = new THREE.Group();

  const gunBody = box(0.22, 0.18, 0.82, mat(0x121820, 0.48, 0.24));
  gunBody.position.z = -0.25;
  const barrel = cyl(0.035, 0.035, 0.72, mat(0x07090d, 0.45, 0.25));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.78);
  bodyParts.bodyGun.add(gunBody, barrel);
  bodyParts.bodyGun.position.set(0.28, 1.22, -0.52);

  for (const part of Object.values(bodyParts)) playerBody.add(part);
  scene.add(playerBody);
}

function makeFirstPersonWeapon() {
  fpWeapon = new THREE.Group();
  camera.add(fpWeapon);

  const gunDark = mat(0x0e1217, 0.44, 0.28);
  const gunMid = mat(0x323c49, 0.46, 0.28);
  const sleeve = mat(0x14233d, 0.8);
  const glove = mat(0x070707, 0.65);

  fpParts.leftArm = box(0.2, 0.2, 0.82, sleeve);
  fpParts.leftArm.position.set(-0.34, -0.18, -0.95);
  fpParts.leftArm.rotation.x = -0.55;
  fpParts.rightArm = box(0.2, 0.2, 0.78, sleeve);
  fpParts.rightArm.position.set(0.28, -0.25, -0.75);
  fpParts.rightArm.rotation.x = -0.35;
  fpParts.leftHand = box(0.18, 0.15, 0.2, glove);
  fpParts.leftHand.position.set(-0.23, -0.22, -1.28);
  fpParts.rightHand = box(0.18, 0.15, 0.2, glove);
  fpParts.rightHand.position.set(0.15, -0.28, -0.96);
  fpParts.receiver = box(0.34, 0.23, 0.92, gunMid);
  fpParts.receiver.position.set(0.02, -0.06, -1.02);
  fpParts.handguard = box(0.27, 0.18, 0.64, gunDark);
  fpParts.handguard.position.set(0.02, -0.03, -1.52);
  fpParts.barrel = cyl(0.045, 0.045, 1.0, gunDark);
  fpParts.barrel.rotation.x = Math.PI / 2;
  fpParts.barrel.position.set(0.02, 0.02, -1.88);
  fpParts.mag = box(0.2, 0.5, 0.24, gunDark);
  fpParts.mag.position.set(0.03, -0.43, -1.05);
  fpParts.optic = cyl(0.17, 0.17, 0.14, gunDark, 24);
  fpParts.optic.rotation.x = Math.PI / 2;
  fpParts.optic.position.set(0.02, 0.45, -0.88);
  fpParts.laserModule = box(0.13, 0.09, 0.28, gunDark);
  fpParts.laserModule.position.set(0.19, 0.03, -1.58);
  fpParts.laserOrigin = new THREE.Object3D();
  fpParts.laserOrigin.position.set(0.19, 0.03, -1.75);
  fpParts.muzzle = new THREE.Object3D();
  fpParts.muzzle.position.set(0.02, 0.02, -2.42);

  muzzleFlash = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.55, 14), basic(0xffd26a, true, 0.92));
  muzzleFlash.rotation.x = -Math.PI / 2;
  muzzleFlash.position.set(0.02, 0.02, -2.5);
  muzzleFlash.visible = false;

  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.1, 32), basic(0x67baff, true, 0.28));
  lens.position.set(0.02, 0.45, -0.965);
  lens.rotation.y = Math.PI;
  fpParts.dot = new THREE.Mesh(new THREE.SphereGeometry(0.015, 10, 10), basic(0xff1010));
  fpParts.dot.position.set(0.02, 0.45, -0.98);

  for (const p of Object.values(fpParts)) fpWeapon.add(p);
  fpWeapon.add(lens, muzzleFlash);

  laserLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.65 })
  );
  laserDot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 12), basic(0xff0000));
  scene.add(laserLine, laserDot);
}

function makeHelmetOverlay() {
  helmetOverlay = new THREE.Group();
  const shell = basic(0x121a13, true, 0.74);
  const glass = basic(0x020304, true, 0.33);
  const top = box(1.28, 0.14, 0.07, shell);
  top.position.set(0.08, 0.48, -0.62);
  const right = box(0.18, 0.75, 0.07, shell);
  right.position.set(0.62, 0.04, -0.58);
  const visor = box(0.5, 0.22, 0.045, glass);
  visor.position.set(0.22, 0.17, -0.66);
  helmetOverlay.add(top, right, visor);
  camera.add(helmetOverlay);
}

function chooseWeapon(key) {
  state.weaponKey = key;
  state.weapon = { ...WEAPONS[key] };
  state.ammo = state.weapon.mag;
  state.reserve = state.weapon.reserve;
  state.weapon.hasLaser = Math.random() < state.weapon.laserChance;
  state.weapon.hasOptic = Math.random() < state.weapon.opticChance;
  fpParts.laserModule.visible = state.weapon.hasLaser;
  fpParts.optic.visible = state.weapon.hasOptic;
  fpParts.dot.visible = state.weapon.hasOptic;
  el.weaponName.textContent = state.weapon.name;
}

function makeEnemy(x, z, faction = Math.random() < 0.5 ? "A" : "B") {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  root.userData = { enemy: true, hp: 100, faction, shootTimer: Math.random(), thinkTimer: 0, target: null, lastHeard: null, dead: false, walk: Math.random() * 10, armDamage: 0, legDamage: 0 };
  const army = faction === "A" ? mat(0x364b35, 0.82) : mat(0x4c3940, 0.82);
  const vest = mat(0x14191f, 0.74);
  const mask = mat(0x050505, 0.86);
  const helmet = mat(0x263026, 0.72, 0.08);

  function part(name, mesh, x, y, z, hitPart) {
    mesh.position.set(x, y, z);
    mesh.userData.root = root;
    mesh.userData.hitPart = hitPart;
    root.add(mesh);
    enemyMeshes.push(mesh);
    root.userData[name] = mesh;
  }

  part("torso", box(0.78, 0.9, 0.38, army), 0, 1.15, 0, "torso");
  part("vest", box(0.84, 0.62, 0.43, vest), 0, 1.2, -0.02, "torso");
  part("head", box(0.5, 0.5, 0.5, mask), 0, 1.85, 0, "head");
  part("helmet", box(0.62, 0.22, 0.56, helmet), 0, 2.12, 0, "head");
  part("lArm", box(0.23, 0.78, 0.23, army), -0.52, 1.15, -0.08, "arm");
  part("rArm", box(0.23, 0.78, 0.23, army), 0.52, 1.15, -0.08, "arm");
  part("lLeg", box(0.27, 0.72, 0.27, mat(0x202834, 0.82)), -0.2, 0.35, 0, "leg");
  part("rLeg", box(0.27, 0.72, 0.27, mat(0x202834, 0.82)), 0.2, 0.35, 0, "leg");

  const gun = new THREE.Group();
  const gb = box(0.2, 0.16, 0.72, mat(0x111820, 0.5, 0.22));
  gb.position.z = -0.25;
  const barrel = cyl(0.032, 0.032, 0.64, mat(0x05070a, 0.45, 0.25));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.7);
  const flash = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 12), basic(0xffd166, true, 0.9));
  flash.rotation.x = -Math.PI / 2;
  flash.position.set(0, 0.02, -1.02);
  flash.visible = false;
  gun.add(gb, barrel, flash);
  gun.position.set(0.26, 1.22, -0.42);
  root.add(gun);
  root.userData.gun = gun;
  root.userData.flash = flash;

  scene.add(root);
  enemies.push(root);
  return root;
}

function spawnEnemies() {
  for (let i = 0; i < 12; i++) {
    let x = 0, z = 0;
    for (let t = 0; t < 100; t++) {
      x = -40 + Math.random() * 80;
      z = -40 + Math.random() * 80;
      if (!collidesAt(x, z, 0.5) && Math.hypot(x, z - 12) > 15) break;
    }
    makeEnemy(x, z);
  }
}

function setPlayerPose(dt) {
  const forward = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
  const camRight = state.helmetCam ? 0.24 : 0;
  playerBody.position.set(camera.position.x - forward.x * 0.32 - right.x * camRight, 0, camera.position.z - forward.z * 0.32 - right.z * camRight);
  playerBody.rotation.y = state.yaw;

  const moving = Math.abs(state.velocity.x) + Math.abs(state.velocity.z) > 0.35;
  const swing = moving ? Math.sin(performance.now() * 0.009) * 0.25 : 0;
  bodyParts.lLeg.rotation.x = swing;
  bodyParts.rLeg.rotation.x = -swing;

  // Hide head/arms/gun during normal first-person, keep body/vest/legs visible when looking down.
  const lookDown = state.pitch < -0.35;
  bodyParts.head.visible = false;
  bodyParts.helmet.visible = state.helmetCam;
  bodyParts.goggles.visible = false;
  bodyParts.lArm.visible = false;
  bodyParts.rArm.visible = false;
  bodyParts.bodyGun.visible = false;
  bodyParts.torso.visible = lookDown;
  bodyParts.vest.visible = lookDown;
}

function updatePlayer(dt) {
  const fwd = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
  const wish = new THREE.Vector3();
  if (keys.has("KeyW")) wish.add(fwd);
  if (keys.has("KeyS")) wish.addScaledVector(fwd, -1);
  if (keys.has("KeyD")) wish.add(right);
  if (keys.has("KeyA")) wish.addScaledVector(right, -1);

  if (wish.lengthSq() > 0) wish.normalize();
  const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
  const injurySpeed = 1 - state.legInjury * 0.42;
  const aimSpeed = state.aimAmount > 0.4 ? 0.64 : 1;
  const targetSpeed = 5.9 * (sprint ? 1.35 : 1) * injurySpeed * aimSpeed;

  state.velocity.x += (wish.x * targetSpeed - state.velocity.x) * Math.min(1, dt * 13);
  state.velocity.z += (wish.z * targetSpeed - state.velocity.z) * Math.min(1, dt * 13);
  if (wish.lengthSq() === 0) {
    state.velocity.x *= Math.pow(0.001, dt);
    state.velocity.z *= Math.pow(0.001, dt);
  }

  const nx = camera.position.x + state.velocity.x * dt;
  const nz = camera.position.z + state.velocity.z * dt;
  if (!collidesAt(nx, camera.position.z)) camera.position.x = nx; else state.velocity.x = 0;
  if (!collidesAt(camera.position.x, nz)) camera.position.z = nz; else state.velocity.z = 0;
  camera.position.y = 1.72;

  state.shootTimer = Math.max(0, state.shootTimer - dt);
  if (state.reloading) {
    state.reloadTimer -= dt;
    if (state.reloadTimer <= 0) finishReload();
  }

  state.noiseTimer = Math.max(0, state.noiseTimer - dt);
}

function updateCamera(dt) {
  const lean = state.helmetCam ? Math.sin(performance.now() * 0.003) * 0.012 : 0;
  camera.rotation.y = state.yaw;
  camera.rotation.x = state.pitch;
  camera.rotation.z = lean + state.recoil * 0.012;
  const targetFov = state.helmetCam ? 88 : 80;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 6);
  camera.updateProjectionMatrix();
}

function nearSurface() {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  wallRay.set(camera.position, dir);
  wallRay.far = 1.25;
  const hits = wallRay.intersectObjects(worldMeshes, false);
  const lookingDownClose = state.pitch < -0.82;
  return hits.length > 0 || lookingDownClose;
}

function updateWeapon(dt) {
  const close = nearSurface();
  const canAim = state.aiming && !state.reloading && !close;
  state.aimAmount += ((canAim ? 1 : 0) - state.aimAmount) * Math.min(1, dt * 12);
  state.highReady += ((close ? 1 : 0) - state.highReady) * Math.min(1, dt * 10);

  const t = performance.now() * 0.001;
  const moving = Math.abs(state.velocity.x) + Math.abs(state.velocity.z) > 0.35;
  const bob = moving ? Math.sin(t * 8.4) * 0.024 * (1 - state.aimAmount * 0.75) : Math.sin(t * 1.6) * 0.006;
  const side = moving ? Math.cos(t * 7.0) * 0.015 * (1 - state.aimAmount * 0.7) : 0;

  state.swayX *= Math.pow(0.012, dt);
  state.swayY *= Math.pow(0.012, dt);
  state.recoil = Math.max(0, state.recoil - dt * 8.0);

  const hip = new THREE.Vector3(0.42 + (state.helmetCam ? 0.08 : 0), -0.47, -0.9);
  const ads = new THREE.Vector3(0.0 + (state.helmetCam ? 0.05 : 0), -0.31, -0.68);
  const high = new THREE.Vector3(0.36, -0.05, -0.73);
  const pos = hip.clone().lerp(ads, state.aimAmount).lerp(high, state.highReady);
  pos.x += side - state.swayX * (1 - state.aimAmount * 0.65);
  pos.y += bob + state.swayY * 0.55 - state.recoil * 0.045;
  pos.z += state.recoil * 0.17;
  fpWeapon.position.copy(pos);
  fpWeapon.rotation.set(-state.recoil * 0.25 + state.swayY * 0.45, side * 0.55 + state.swayX * 0.6, -side * 0.75 + state.swayX * 0.5);
  if (state.highReady > 0.02) {
    fpWeapon.rotation.x += -0.75 * state.highReady;
    fpWeapon.rotation.y += 0.38 * state.highReady;
    fpWeapon.rotation.z += -0.32 * state.highReady;
  }

  updateReloadPose(dt);
  updateLaser();

  el.crosshair.style.opacity = state.aimAmount > 0.55 ? "0" : "1";
  el.redDot.style.opacity = state.weapon?.hasOptic && state.aimAmount > 0.72 ? "1" : "0";
  helmetOverlay.visible = state.helmetCam && state.running;
  if (muzzleFlash.visible && state.recoil < 0.5) muzzleFlash.visible = false;
}

function updateReloadPose() {
  if (!state.reloading) {
    fpParts.mag.visible = true;
    fpParts.mag.position.set(0.03, -0.43, -1.05);
    fpParts.leftArm.position.set(-0.34, -0.18, -0.95);
    return;
  }
  const p = 1 - state.reloadTimer / state.weapon.reload;
  const dip = Math.sin(p * Math.PI);
  fpWeapon.position.y -= dip * 0.25;
  fpWeapon.rotation.z += dip * 0.34;
  fpParts.leftArm.rotation.x = -0.75 + dip * 0.35;
  if (p < 0.3) {
    fpParts.mag.position.y = -0.43 - p * 0.9;
    el.statusText.textContent = "MAG OUT";
  } else if (p < 0.52) {
    fpParts.mag.visible = false;
    fpParts.leftArm.position.y = -0.33;
    el.statusText.textContent = "NEW MAG";
  } else if (p < 0.78) {
    const q = (p - 0.52) / 0.26;
    fpParts.mag.visible = true;
    fpParts.mag.position.y = lerp(-0.98, -0.43, q);
    el.statusText.textContent = "MAG IN";
  } else {
    el.statusText.textContent = "CHAMBER";
  }
}

function updateLaser() {
  if (!state.weapon?.hasLaser || state.reloading || !state.running) {
    laserLine.material.opacity = 0;
    laserDot.visible = false;
    return;
  }
  const origin = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  fpParts.laserOrigin.getWorldPosition(origin);
  fpParts.laserOrigin.getWorldQuaternion(quat);
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quat).normalize();
  const end = origin.clone().addScaledVector(dir, 58);
  raycaster.set(origin, dir);
  raycaster.far = 58;
  const hits = raycaster.intersectObjects([...worldMeshes, ...enemyMeshes], false);
  if (hits.length) end.copy(hits[0].point);
  laserLine.geometry.setFromPoints([origin, end]);
  laserLine.geometry.attributes.position.needsUpdate = true;
  laserLine.material.opacity = state.highReady > 0.5 ? 0.05 : 0.72;
  laserDot.position.copy(end);
  laserDot.visible = state.highReady < 0.5;
}

function shoot() {
  if (!state.running || state.paused || state.reloading || state.shootTimer > 0) return;
  if (state.highReady > 0.5) { showMessage("TOO CLOSE"); return; }
  if (state.ammo <= 0) { reload(); return; }
  state.ammo--;
  state.shootTimer = state.weapon.fireDelay;
  state.recoil = state.weapon.recoil * (1 + state.armInjury * 0.35);
  muzzleFlash.visible = true;
  noise(camera.position, 38);
  playTone(90, 0.05, "square", 0.07);
  playTone(180, 0.04, "sawtooth", 0.06);
  spawnCasing();

  const pelletCount = state.weapon.pellets;
  for (let i = 0; i < pelletCount; i++) {
    const spread = state.weapon.spread * (1 - state.aimAmount * 0.62) * (1 + state.armInjury * 0.35);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();
    fireRay(camera.position.clone(), dir, true);
  }
  updateHud();
}

function fireRay(origin, dir, fromPlayer, shooter = null) {
  raycaster.set(origin, dir);
  raycaster.far = 115;
  const hitTargets = fromPlayer ? [...enemyMeshes, ...worldMeshes] : [...enemyMeshes, ...worldMeshes, playerBody.children];
  const hits = raycaster.intersectObjects(hitTargets, false);
  const muzzle = new THREE.Vector3();
  fpParts.muzzle.getWorldPosition(muzzle);
  let end = origin.clone().addScaledVector(dir, 80);
  if (hits.length) {
    const hit = hits[0];
    end = hit.point.clone();
    processHit(hit, fromPlayer, shooter);
  }
  makeBulletLine(fromPlayer ? muzzle : origin, end, fromPlayer ? 0xffefd0 : 0xffcf5d);
}

function processHit(hit, fromPlayer, shooter) {
  const obj = hit.object;
  if (obj.userData.kind === "glass" && !obj.userData.broken) {
    obj.userData.broken = true;
    obj.visible = false;
    spawnParticles(hit.point, 28, 0x9fd8ff, 0.75);
    playTone(980, 0.08, "triangle", 0.06);
    return;
  }
  if (obj.userData.kind === "light" && obj.userData.light?.intensity > 0) {
    obj.userData.light.intensity = 0;
    obj.material.color.setHex(0x1f1f1f);
    spawnParticles(hit.point, 14, 0xfff0a0, 0.5);
    playTone(440, 0.05, "sawtooth", 0.045);
    return;
  }
  if (obj.userData.kind === "doorHandle") {
    obj.userData.door.loose = true;
    obj.userData.door.targetAngle = Math.random() < 0.5 ? 1.25 : -1.25;
    spawnParticles(hit.point, 10, 0xd5b35b, 0.5);
    playTone(260, 0.07, "triangle", 0.045);
    return;
  }
  const root = obj.userData.root;
  if (root?.userData.enemy && !root.userData.dead) {
    damageEnemy(root, obj.userData.hitPart || "torso", hit.point, fromPlayer);
    return;
  }
  if (fromPlayer) spawnParticles(hit.point, 5, 0xd7d0bc, 0.3);
}

function damageEnemy(enemy, part, point, fromPlayer) {
  const mult = part === "head" ? 2.9 : part === "torso" ? 1 : 0.62;
  const dmg = state.weapon.damage * mult;
  enemy.userData.hp -= dmg;
  if (part === "arm") enemy.userData.armDamage = Math.min(1, enemy.userData.armDamage + 0.28);
  if (part === "leg") enemy.userData.legDamage = Math.min(1, enemy.userData.legDamage + 0.36);
  spawnBlood(point, part);
  enemy.userData.target = "player";
  if (enemy.userData.hp <= 0) killEnemy(enemy, part);
}

function killEnemy(enemy, part) {
  enemy.userData.dead = true;
  enemyMeshes.splice(0, enemyMeshes.length, ...enemyMeshes.filter(m => m.userData.root !== enemy));
  if (state.gore === "high" && part !== "torso") detachStylizedPart(enemy, part);
  createRagdoll(enemy);
  scene.remove(enemy);
}

function detachStylizedPart(enemy, part) {
  const pos = enemy.position.clone().add(new THREE.Vector3(0, part === "head" ? 1.8 : part === "arm" ? 1.1 : 0.45, 0));
  const chunk = box(part === "head" ? 0.42 : 0.22, part === "head" ? 0.42 : 0.55, 0.22, mat(0x151515, 0.84));
  chunk.position.copy(pos);
  chunk.userData.velocity = new THREE.Vector3((Math.random() - 0.5) * 1.4, 1.4, (Math.random() - 0.5) * 1.4);
  chunk.userData.life = 3;
  scene.add(chunk);
  droppedItems.push(chunk);
}

function createRagdoll(enemy) {
  const base = enemy.position.clone();
  const colors = [0x364b35, 0x14191f, 0x050505, 0x202834, 0x202834, 0x364b35, 0x364b35];
  const specs = [
    [0.76, 0.82, 0.36, 0, 1.05, 0], [0.84, 0.56, 0.42, 0, 1.15, -0.02], [0.48, 0.48, 0.48, 0, 1.8, 0],
    [0.26, 0.68, 0.26, -0.2, 0.38, 0], [0.26, 0.68, 0.26, 0.2, 0.38, 0],
    [0.22, 0.64, 0.22, -0.55, 1.1, -0.05], [0.22, 0.64, 0.22, 0.55, 1.1, -0.05],
  ];
  specs.forEach((s, i) => {
    const p = box(s[0], s[1], s[2], mat(colors[i], 0.82));
    p.position.set(base.x + s[3], s[4], base.z + s[5]);
    p.rotation.y = enemy.rotation.y;
    p.userData.velocity = new THREE.Vector3((Math.random() - 0.5) * 1.8, 1.2 + Math.random(), (Math.random() - 0.5) * 1.8);
    p.userData.spin = new THREE.Vector3(Math.random() * 5, Math.random() * 5, Math.random() * 5);
    p.userData.life = 4.0;
    scene.add(p);
    droppedItems.push(p);
  });
}

function spawnBlood(pos, part) {
  if (state.gore === "off") return;
  const count = state.gore === "high" ? (part === "head" ? 42 : 26) : 10;
  spawnParticles(pos, count, 0x8c0b13, 1.1);
}

function reload() {
  if (!state.running || state.reloading || state.ammo >= state.weapon.mag || state.reserve <= 0) return;
  state.reloading = true;
  state.reloadTimer = state.weapon.reload * (1 + state.armInjury * 0.28);
  el.statusText.textContent = "RELOADING";
  playTone(240, 0.08, "triangle", 0.045);
}

function finishReload() {
  const need = state.weapon.mag - state.ammo;
  const take = Math.min(need, state.reserve);
  state.ammo += take;
  state.reserve -= take;
  state.reloading = false;
  el.statusText.textContent = "";
  playTone(390, 0.06, "triangle", 0.05);
}

function cycleWeapon(key) {
  const map = { Digit1: "pistol", Digit2: "rifle", Digit3: "smg", Digit4: "shotgun", Digit5: "sniper" };
  if (!map[key] || state.reloading) return;
  chooseWeapon(map[key]);
  showMessage(state.weapon.name);
}

function updateEnemies(dt) {
  for (const enemy of enemies) {
    if (enemy.userData.dead || !enemy.parent) continue;
    enemy.userData.walk += dt * 7;
    enemy.userData.shootTimer -= dt;
    enemy.userData.thinkTimer -= dt;

    const target = findEnemyTarget(enemy);
    if (!target) continue;
    const targetPos = target === "player" ? camera.position : target.position;
    const dx = targetPos.x - enemy.position.x;
    const dz = targetPos.z - enemy.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    const canSee = !lineBlocked(new THREE.Vector3(enemy.position.x, 1.4, enemy.position.z), new THREE.Vector3(targetPos.x, 1.4, targetPos.z));
    enemy.rotation.y = Math.atan2(-dx, -dz);

    if (dist > 8 || !canSee) {
      const speed = 2.2 * (1 - enemy.userData.legDamage * 0.5);
      const nx = enemy.position.x + (dx / dist) * speed * dt;
      const nz = enemy.position.z + (dz / dist) * speed * dt;
      if (!collidesAt(nx, enemy.position.z, 0.5)) enemy.position.x = nx;
      if (!collidesAt(enemy.position.x, nz, 0.5)) enemy.position.z = nz;
    }

    enemy.userData.lLeg.rotation.x = Math.sin(enemy.userData.walk) * 0.35;
    enemy.userData.rLeg.rotation.x = -Math.sin(enemy.userData.walk) * 0.35;
    enemy.userData.lArm.rotation.x = -1.05;
    enemy.userData.rArm.rotation.x = -1.05;

    if (dist < 34 && canSee && enemy.userData.shootTimer <= 0) enemyShoot(enemy, target);
  }
  el.enemyText.textContent = `HOSTILES ${enemies.filter(e => !e.userData.dead && e.parent).length}`;
}

function findEnemyTarget(enemy) {
  let best = "player";
  let bestDist = enemy.position.distanceTo(camera.position);
  for (const other of enemies) {
    if (other === enemy || other.userData.dead || !other.parent) continue;
    // FFA bots: they can fight any other soldier, not only the player.
    const d = enemy.position.distanceTo(other.position);
    if (d < bestDist) { best = other; bestDist = d; }
  }
  if (state.noiseTimer > 0 && Math.random() < 0.35) return "player";
  return best;
}

function enemyShoot(enemy, target) {
  enemy.userData.shootTimer = 0.55 + Math.random() * 0.6 + enemy.userData.armDamage * 0.5;
  enemy.userData.flash.visible = true;
  setTimeout(() => { if (enemy.userData.flash) enemy.userData.flash.visible = false; }, 70);
  playTone(120, 0.04, "square", 0.035);
  const origin = enemy.position.clone();
  origin.y = 1.35;
  const targetPos = target === "player" ? camera.position.clone() : target.position.clone().add(new THREE.Vector3(0, 1.2, 0));
  const dir = targetPos.sub(origin).normalize();
  dir.x += (Math.random() - 0.5) * 0.035 * (1 + enemy.userData.armDamage);
  dir.y += (Math.random() - 0.5) * 0.02;
  dir.z += (Math.random() - 0.5) * 0.035 * (1 + enemy.userData.armDamage);
  dir.normalize();
  const end = origin.clone().addScaledVector(dir, 45);
  makeBulletLine(origin, end, 0xffca58);

  if (target === "player") {
    const chance = 0.58 - enemy.userData.armDamage * 0.22;
    if (Math.random() < chance) damagePlayer(9 + Math.random() * 8);
  } else {
    const hitPart = Math.random() < 0.2 ? "head" : Math.random() < 0.55 ? "torso" : Math.random() < 0.75 ? "arm" : "leg";
    damageBotFromBot(target, hitPart, end);
  }
}

function damageBotFromBot(bot, part, point) {
  const dmg = part === "head" ? 60 : part === "torso" ? 25 : 16;
  bot.userData.hp -= dmg;
  if (part === "arm") bot.userData.armDamage = Math.min(1, bot.userData.armDamage + 0.22);
  if (part === "leg") bot.userData.legDamage = Math.min(1, bot.userData.legDamage + 0.26);
  spawnBlood(point, part);
  if (bot.userData.hp <= 0) killEnemy(bot, part);
}

function damagePlayer(amount) {
  state.health = Math.max(0, state.health - amount);
  const roll = Math.random();
  if (roll < 0.24) state.armInjury = Math.min(1, state.armInjury + 0.18);
  else if (roll < 0.48) state.legInjury = Math.min(1, state.legInjury + 0.2);
  playTone(70, 0.06, "sawtooth", 0.055);
  updateHud();
  if (state.health <= 0) die();
}

function makeBulletLine(a, b, color) {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([a, b]),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 })
  );
  line.userData.life = 0.08;
  scene.add(line);
  bulletLines.push(line);
}

function spawnParticles(pos, count, color, force = 1) {
  for (let i = 0; i < count; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.045), basic(color));
    p.position.copy(pos);
    p.userData.velocity = new THREE.Vector3((Math.random() - 0.5) * 4.5 * force, Math.random() * 3.5 * force, (Math.random() - 0.5) * 4.5 * force);
    p.userData.life = 0.5 + Math.random() * 0.35;
    scene.add(p);
    particles.push(p);
  }
}

function spawnCasing() {
  const casing = cyl(0.022, 0.022, 0.12, mat(0xd1a238, 0.45, 0.2), 10);
  casing.rotation.z = Math.PI / 2;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  casing.position.copy(camera.position).addScaledVector(right, 0.32);
  casing.position.y -= 0.2;
  casing.userData.velocity = new THREE.Vector3(right.x * 2.1, 1.1, right.z * 2.1);
  casing.userData.spin = new THREE.Vector3(8, 5, 2);
  casing.userData.life = 2.0;
  scene.add(casing);
  droppedItems.push(casing);
}

function updateFX(dt) {
  for (let i = bulletLines.length - 1; i >= 0; i--) {
    const l = bulletLines[i];
    l.userData.life -= dt;
    l.material.opacity = Math.max(0, l.userData.life / 0.08);
    if (l.userData.life <= 0) { scene.remove(l); bulletLines.splice(i, 1); }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.userData.life -= dt;
    p.userData.velocity.y -= 7 * dt;
    p.position.addScaledVector(p.userData.velocity, dt);
    if (p.userData.life <= 0) { scene.remove(p); particles.splice(i, 1); }
  }
  for (let i = droppedItems.length - 1; i >= 0; i--) {
    const item = droppedItems[i];
    item.userData.life -= dt;
    item.userData.velocity.y -= 7 * dt;
    item.position.addScaledVector(item.userData.velocity, dt);
    if (item.userData.spin) {
      item.rotation.x += item.userData.spin.x * dt;
      item.rotation.y += item.userData.spin.y * dt;
      item.rotation.z += item.userData.spin.z * dt;
    }
    if (item.position.y < 0.08) {
      item.position.y = 0.08;
      item.userData.velocity.y *= -0.18;
      item.userData.velocity.x *= 0.7;
      item.userData.velocity.z *= 0.7;
    }
    if (item.userData.life <= 0) { scene.remove(item); droppedItems.splice(i, 1); }
  }
  for (const d of doors) {
    d.angle += (d.targetAngle - d.angle) * Math.min(1, dt * 5);
    d.root.rotation.y = d.axis === "z" ? d.angle : -d.angle;
  }
}

function ammoEstimate() {
  const r = state.ammo / state.weapon.mag;
  if (r > 0.85) return "FULL";
  if (r > 0.55) return "MOSTLY FULL";
  if (r > 0.32) return "HALF FULL";
  if (r > 0.12) return "LOW";
  if (r > 0) return "NEAR EMPTY";
  return "EMPTY";
}

function updateHud() {
  el.healthBar.style.width = `${state.health}%`;
  el.ammoText.textContent = ammoEstimate();
  el.modeText.textContent = `HELMET CAM ${state.helmetCam ? "ON" : "OFF"}`;
  el.weaponName.textContent = state.weapon?.name || "";
  const injuries = [];
  if (state.armInjury > 0.08) injuries.push("ARM HIT: WORSE RECOIL/RELOAD");
  if (state.legInjury > 0.08) injuries.push("LEG HIT: SLOWER MOVE");
  el.injuryText.textContent = injuries.length ? injuries.join(" • ") : "NO INJURY";
}

function showMessage(text) {
  el.message.textContent = text;
  el.message.style.opacity = "1";
  state.messageTimer = 1.1;
}

function updateMessage(dt) {
  state.messageTimer -= dt;
  if (state.messageTimer <= 0) el.message.style.opacity = "0";
}

function noise(pos, radius) {
  state.lastNoise.copy(pos);
  state.noiseTimer = 2.5;
  for (const e of enemies) {
    if (!e.userData.dead && e.position.distanceTo(pos) < radius) e.userData.target = "player";
  }
}

function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playTone(freq, duration, type, vol) {
  try {
    const ac = getAudio();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = vol;
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
    osc.stop(ac.currentTime + duration);
  } catch {}
}

function abruptAudioCut() {
  if (audioCtx) {
    try { audioCtx.suspend(); } catch {}
  }
}

function die() {
  if (state.dead) return;
  state.dead = true;
  state.running = false;
  state.aiming = false;
  if (document.pointerLockElement) document.exitPointerLock();
  abruptAudioCut();
  el.hud.style.display = "none";
  el.deathScreen.classList.remove("hidden");
  setTimeout(() => {
    el.deathScreen.classList.add("hidden");
    el.menu.classList.remove("hidden");
    el.menu.style.display = "grid";
  }, 2000);
}

function resetGame() {
  for (const e of enemies) scene.remove(e);
  enemies.length = 0;
  enemyMeshes.length = 0;
  for (const p of [...particles, ...bulletLines, ...droppedItems]) scene.remove(p);
  particles.length = 0;
  bulletLines.length = 0;
  droppedItems.length = 0;
  for (const d of doors) { d.loose = false; d.angle = 0; d.targetAngle = 0; d.root.rotation.y = 0; }
  for (const g of glassMeshes) { g.visible = true; g.userData.broken = false; }
  for (const l of lightMeshes) { if (l.userData.light) l.userData.light.intensity = 0.9; l.material.color.setHex(0xffffd0); }

  camera.position.set(0, 1.72, 12);
  state.yaw = 0;
  state.pitch = 0;
  state.velocity.set(0, 0, 0);
  state.health = 100;
  state.armInjury = 0;
  state.legInjury = 0;
  state.reloading = false;
  state.reloadTimer = 0;
  state.shootTimer = 0;
  state.recoil = 0;
  state.aimAmount = 0;
  state.highReady = 0;
  state.dead = false;
  chooseWeapon(state.weaponKey);
  spawnEnemies();
  updateHud();
}

function startGame() {
  state.gore = el.goreSelect.value;
  el.pauseGoreSelect.value = state.gore;
  state.helmetCam = el.helmetCamStart.checked;
  state.weaponKey = el.loadoutSelect.value;
  el.menu.classList.add("hidden");
  el.pauseMenu.classList.add("hidden");
  el.hud.style.display = "block";
  resetGame();
  state.running = true;
  state.paused = false;
  renderer.domElement.requestPointerLock();
}

function pauseGame() {
  if (!state.running || state.dead) return;
  state.paused = true;
  state.running = false;
  if (document.pointerLockElement) document.exitPointerLock();
  el.pauseMenu.classList.remove("hidden");
}

function resumeGame() {
  if (state.dead) return;
  state.gore = el.pauseGoreSelect.value;
  el.goreSelect.value = state.gore;
  state.paused = false;
  state.running = true;
  el.pauseMenu.classList.add("hidden");
  renderer.domElement.requestPointerLock();
}

function backToMenu() {
  state.running = false;
  state.paused = false;
  el.pauseMenu.classList.add("hidden");
  el.hud.style.display = "none";
  el.menu.classList.remove("hidden");
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (state.running) {
    updatePlayer(dt);
    updateCamera(dt);
    setPlayerPose(dt);
    updateWeapon(dt);
    updateEnemies(dt);
    updateMessage(dt);
    updateHud();
  }
  updateFX(dt);
  renderer.render(scene, camera);
}

el.playBtn.onclick = startGame;
el.resumeBtn.onclick = resumeGame;
el.backMenuBtn.onclick = backToMenu;

renderer.domElement.addEventListener("click", () => {
  if (state.running && !state.pointerLocked) renderer.domElement.requestPointerLock();
});

document.addEventListener("pointerlockchange", () => {
  state.pointerLocked = document.pointerLockElement === renderer.domElement;
});

document.addEventListener("contextmenu", e => e.preventDefault());

document.addEventListener("mousemove", e => {
  if (!state.running || !state.pointerLocked) return;
  const sens = state.aimAmount > 0.5 ? 0.00125 : 0.00205;
  state.yaw -= e.movementX * sens;
  state.pitch -= e.movementY * sens;
  state.pitch = clamp(state.pitch, -1.23, 1.15);
  state.swayX = clamp(state.swayX + e.movementX * 0.0009, -0.06, 0.06);
  state.swayY = clamp(state.swayY + e.movementY * 0.0007, -0.05, 0.05);
});

document.addEventListener("mousedown", e => {
  if (!state.running) return;
  if (!state.pointerLocked) return renderer.domElement.requestPointerLock();
  if (e.button === 0) shoot();
  if (e.button === 2) state.aiming = true;
});

document.addEventListener("mouseup", e => {
  if (e.button === 2) state.aiming = false;
});

document.addEventListener("keydown", e => {
  keys.add(e.code);
  if (e.code === "KeyR") reload();
  if (e.code === "KeyH") { state.helmetCam = !state.helmetCam; showMessage(`HELMET CAM ${state.helmetCam ? "ON" : "OFF"}`); }
  if (e.code === "KeyP") pauseGame();
  if (e.code.startsWith("Digit")) cycleWeapon(e.code);
});

document.addEventListener("keyup", e => keys.delete(e.code));

window.addEventListener("blur", () => { keys.clear(); state.aiming = false; });
window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

makeWorld();
chooseWeapon("rifle");
loop();
