import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import "./style.css";

const MODEL_URL = "/models/swat-character.glb";

/*
  If the model is too big/small, change this.
  Try 1, 0.5, 0.1, 2, etc.
*/
const MODEL_SCALE = 1;

const game = document.getElementById("game");
const menu = document.getElementById("menu");
const hud = document.getElementById("hud");
const playBtn = document.getElementById("playBtn");
const healthBar = document.getElementById("healthBar");
const ammoText = document.getElementById("ammoText");
const statusText = document.getElementById("statusText");
const modeText = document.getElementById("modeText");
const deathScreen = document.getElementById("deathScreen");

let operatorTemplate = null;
let modelLoaded = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd7ff);
scene.fog = new THREE.Fog(0x8fd7ff, 45, 150);

const camera = new THREE.PerspectiveCamera(
  82,
  window.innerWidth / window.innerHeight,
  0.03,
  250
);

camera.rotation.order = "YXZ";
camera.position.set(0, 1.72, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
game.appendChild(renderer.domElement);

scene.add(camera);

const hemi = new THREE.HemisphereLight(0xffffff, 0x2d6b35, 1.2);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(35, 55, 25);
sun.castShadow = true;
sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.camera.left = -90;
sun.shadow.camera.right = 90;
sun.shadow.camera.top = 90;
sun.shadow.camera.bottom = -90;
scene.add(sun);

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const center = new THREE.Vector2(0, 0);

const keys = {};
const enemies = [];
const enemyHitboxes = [];
const worldMeshes = [];
const solidBoxes = [];
const particles = [];
const bulletLines = [];
const doors = [];

let running = false;
let pointerLocked = false;
let dead = false;
let aiming = false;
let helmetCam = false;
let reloading = false;

let yaw = 0;
let pitch = 0;

let health = 100;
let ammo = 30;
let reserveAmmo = 90;
let reloadTimer = 0;
let shootTimer = 0;

let recoil = 0;
let swayX = 0;
let swayY = 0;
let armDamage = 0;
let legDamage = 0;
let damageFlash = 0;

const velocity = new THREE.Vector3();

let localRig = null;
let weapon = null;
let muzzle = null;
let muzzleFlash = null;
let laserLine = null;
let laserDot = null;
let helmetOverlay = null;

function mat(color, roughness = 0.75, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function basic(color) {
  return new THREE.MeshBasicMaterial({ color });
}

function box(w, h, d, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinder(r1, r2, h, material, segments = 16) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(r1, r2, h, segments),
    material
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addSolid(x, z, w, d) {
  solidBoxes.push({
    minX: x - w / 2,
    maxX: x + w / 2,
    minZ: z - d / 2,
    maxZ: z + d / 2,
  });
}

function collides(x, z) {
  const r = 0.5;

  if (x < -48 + r || x > 48 - r || z < -48 + r || z > 48 - r) {
    return true;
  }

  for (const b of solidBoxes) {
    if (
      x + r > b.minX &&
      x - r < b.maxX &&
      z + r > b.minZ &&
      z - r < b.maxZ
    ) {
      return true;
    }
  }

  return false;
}

function pointInsideSolid(x, z) {
  for (const b of solidBoxes) {
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) {
      return true;
    }
  }

  return false;
}

function lineBlocked(a, b) {
  const steps = 26;

  for (let i = 3; i < steps - 2; i++) {
    const t = i / steps;
    const x = THREE.MathUtils.lerp(a.x, b.x, t);
    const z = THREE.MathUtils.lerp(a.z, b.z, t);

    if (pointInsideSolid(x, z)) {
      return true;
    }
  }

  return false;
}

async function loadOperatorModel() {
  playBtn.textContent = "LOADING MODEL...";

  try {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(MODEL_URL);

    operatorTemplate = gltf.scene;
    operatorTemplate.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;

        if (obj.material) {
          obj.material.roughness = Math.max(obj.material.roughness || 0.7, 0.55);
          obj.material.metalness = obj.material.metalness || 0;
        }
      }
    });

    modelLoaded = true;
    playBtn.textContent = "PLAY";
  } catch (err) {
    console.warn("Could not load SWAT model. Using fallback body.", err);
    modelLoaded = false;
    playBtn.textContent = "PLAY";
    statusText.textContent = "Model missing, using fallback.";
  }
}

function makeFallbackOperator() {
  const group = new THREE.Group();

  const black = mat(0x050505, 0.8);
  const cloth = mat(0x111820, 0.85);
  const vest = mat(0x0b0f13, 0.75);
  const glass = new THREE.MeshStandardMaterial({
    color: 0x09111c,
    roughness: 0.2,
    metalness: 0.1,
    transparent: true,
    opacity: 0.75,
  });

  const torso = box(0.75, 0.8, 0.36, cloth);
  torso.position.set(0, 1.0, 0);
  group.add(torso);

  const vestMesh = box(0.85, 0.62, 0.42, vest);
  vestMesh.position.set(0, 1.06, -0.02);
  group.add(vestMesh);

  const head = box(0.48, 0.48, 0.48, black);
  head.name = "Head";
  head.position.set(0, 1.75, 0);
  group.add(head);

  const goggles = box(0.44, 0.15, 0.06, glass);
  goggles.name = "Goggles";
  goggles.position.set(0, 1.83, -0.28);
  group.add(goggles);

  const helmet = box(0.62, 0.22, 0.58, mat(0x161d18, 0.72, 0.05));
  helmet.name = "Helmet";
  helmet.position.set(0, 1.98, 0);
  group.add(helmet);

  const leftArm = box(0.24, 0.8, 0.24, cloth);
  leftArm.name = "LeftArm";
  leftArm.position.set(-0.55, 1.1, -0.05);
  group.add(leftArm);

  const rightArm = box(0.24, 0.8, 0.24, cloth);
  rightArm.name = "RightArm";
  rightArm.position.set(0.55, 1.1, -0.05);
  group.add(rightArm);

  const leftLeg = box(0.28, 0.78, 0.28, cloth);
  leftLeg.name = "LeftLeg";
  leftLeg.position.set(-0.2, 0.35, 0);
  group.add(leftLeg);

  const rightLeg = box(0.28, 0.78, 0.28, cloth);
  rightLeg.name = "RightLeg";
  rightLeg.position.set(0.2, 0.35, 0);
  group.add(rightLeg);

  return group;
}

function findRigBones(root) {
  const bones = {
    head: null,
    spine: null,
    leftArm: null,
    rightArm: null,
    leftForearm: null,
    rightForearm: null,
    leftLeg: null,
    rightLeg: null,
    leftShin: null,
    rightShin: null,
  };

  root.traverse((obj) => {
    if (!obj.isBone) return;

    const n = obj.name.toLowerCase();

    if (!bones.head && n.includes("head")) bones.head = obj;
    if (!bones.spine && (n.includes("spine") || n.includes("chest"))) bones.spine = obj;

    if (!bones.leftArm && n.includes("left") && (n.includes("arm") || n.includes("shoulder"))) bones.leftArm = obj;
    if (!bones.rightArm && n.includes("right") && (n.includes("arm") || n.includes("shoulder"))) bones.rightArm = obj;

    if (!bones.leftForearm && n.includes("left") && (n.includes("forearm") || n.includes("lowerarm"))) bones.leftForearm = obj;
    if (!bones.rightForearm && n.includes("right") && (n.includes("forearm") || n.includes("lowerarm"))) bones.rightForearm = obj;

    if (!bones.leftLeg && n.includes("left") && (n.includes("upleg") || n.includes("thigh") || n.includes("leg"))) bones.leftLeg = obj;
    if (!bones.rightLeg && n.includes("right") && (n.includes("upleg") || n.includes("thigh") || n.includes("leg"))) bones.rightLeg = obj;

    if (!bones.leftShin && n.includes("left") && (n.includes("shin") || n.includes("lowerleg") || n.includes("calf"))) bones.leftShin = obj;
    if (!bones.rightShin && n.includes("right") && (n.includes("shin") || n.includes("lowerleg") || n.includes("calf"))) bones.rightShin = obj;
  });

  return bones;
}

function createOperatorRig(isLocalPlayer) {
  const visual = operatorTemplate
    ? SkeletonUtils.clone(operatorTemplate)
    : makeFallbackOperator();

  visual.scale.setScalar(MODEL_SCALE);

  const rig = {
    visual,
    bones: findRigBones(visual),
    time: Math.random() * 100,
    isLocalPlayer,
  };

  if (isLocalPlayer) {
    hideLocalHeadParts(visual);
  }

  return rig;
}

function hideLocalHeadParts(root) {
  root.traverse((obj) => {
    const n = obj.name.toLowerCase();

    if (
      n.includes("head") ||
      n.includes("helmet") ||
      n.includes("goggle") ||
      n.includes("face") ||
      n.includes("mask") ||
      n.includes("neck")
    ) {
      obj.visible = false;
    }
  });
}

function animateRig(rig, dt, moving, aimingPose) {
  if (!rig) return;

  rig.time += dt * (moving ? 8 : 1.5);

  const t = rig.time;
  const walk = moving ? Math.sin(t) : 0;
  const bob = moving ? Math.abs(Math.sin(t)) * 0.035 : Math.sin(t * 0.45) * 0.008;

  rig.visual.position.y = bob;

  const b = rig.bones;

  if (b.spine) {
    b.spine.rotation.x = aimingPose ? -0.04 : Math.sin(t * 0.5) * 0.015;
  }

  if (b.head && !rig.isLocalPlayer) {
    b.head.rotation.x = aimingPose ? -0.05 : Math.sin(t * 0.35) * 0.03;
  }

  if (b.leftArm) {
    b.leftArm.rotation.x = aimingPose ? -1.15 : -walk * 0.35;
    b.leftArm.rotation.z = aimingPose ? -0.25 : 0;
  }

  if (b.rightArm) {
    b.rightArm.rotation.x = aimingPose ? -1.1 : walk * 0.35;
    b.rightArm.rotation.z = aimingPose ? 0.25 : 0;
  }

  if (b.leftForearm) {
    b.leftForearm.rotation.x = aimingPose ? -0.55 : 0;
  }

  if (b.rightForearm) {
    b.rightForearm.rotation.x = aimingPose ? -0.45 : 0;
  }

  if (b.leftLeg) {
    b.leftLeg.rotation.x = walk * 0.45;
  }

  if (b.rightLeg) {
    b.rightLeg.rotation.x = -walk * 0.45;
  }

  if (b.leftShin) {
    b.leftShin.rotation.x = Math.max(0, -walk) * 0.35;
  }

  if (b.rightShin) {
    b.rightShin.rotation.x = Math.max(0, walk) * 0.35;
  }
}

function makeWorld() {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    mat(0x365f38, 1)
  );

  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const wallMat = mat(0xb9b1a2, 0.92);
  const tileMat = mat(0x787878, 0.85);
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9ed8ff,
    roughness: 0.1,
    metalness: 0,
    transparent: true,
    opacity: 0.33,
  });

  function wall(x, z, w, h, d) {
    const mesh = box(w, h, d, wallMat);
    mesh.position.set(x, h / 2, z);
    scene.add(mesh);
    worldMeshes.push(mesh);
    addSolid(x, z, w, d);
  }

  function glass(x, z, w, h, d) {
    const mesh = box(w, h, d, glassMat);
    mesh.position.set(x, h / 2 + 0.6, z);
    mesh.userData.breakableGlass = true;
    scene.add(mesh);
    worldMeshes.push(mesh);
  }

  wall(0, -48, 96, 4, 2);
  wall(0, 48, 96, 4, 2);
  wall(-48, 0, 2, 4, 96);
  wall(48, 0, 2, 4, 96);

  wall(0, -24, 80, 3.5, 1.2);
  wall(0, 8, 80, 3.5, 1.2);
  wall(-22, 0, 1.2, 3.5, 44);
  wall(22, 0, 1.2, 3.5, 44);
  wall(0, 28, 60, 3.5, 1.2);

  glass(-12, -24.8, 8, 1.5, 0.12);
  glass(14, -24.8, 8, 1.5, 0.12);
  glass(-12, 8.8, 8, 1.5, 0.12);
  glass(14, 8.8, 8, 1.5, 0.12);

  for (let i = 0; i < 24; i++) {
    const desk = box(2.4, 0.8, 1.4, tileMat);
    desk.position.set(-38 + Math.random() * 76, 0.4, -38 + Math.random() * 76);
    desk.rotation.y = Math.random() * Math.PI;
    scene.add(desk);
    worldMeshes.push(desk);
    addSolid(desk.position.x, desk.position.z, 2.6, 1.6);
  }

  for (let i = 0; i < 12; i++) {
    const light = box(2.2, 0.08, 0.55, new THREE.MeshBasicMaterial({ color: 0xffffdd }));
    light.position.set(-36 + Math.random() * 72, 3.1, -36 + Math.random() * 72);
    light.userData.lightObject = true;
    scene.add(light);
    worldMeshes.push(light);
  }

  for (let i = 0; i < 5; i++) {
    makeDoor(-35 + i * 15, 8.8);
  }
}

function makeDoor(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const door = box(2.1, 2.6, 0.18, mat(0x5f3e22, 0.85));
  door.position.set(0, 1.3, 0);
  group.add(door);

  const handle = box(0.16, 0.16, 0.22, mat(0x111111, 0.45, 0.2));
  handle.position.set(0.78, 1.25, -0.18);
  handle.userData.doorHandle = true;
  handle.userData.doorGroup = group;
  group.add(handle);

  group.userData.loose = false;
  group.userData.swing = 0;
  group.userData.speed = 0;

  scene.add(group);
  worldMeshes.push(handle);
  doors.push(group);

  addSolid(x, z, 2.2, 0.3);
}

function updateDoors(dt) {
  for (const door of doors) {
    if (!door.userData.loose) continue;

    door.userData.swing += door.userData.speed * dt;
    door.userData.speed *= Math.pow(0.8, dt * 8);
    door.rotation.y = Math.sin(door.userData.swing) * 0.9;
  }
}

function makeWeapon() {
  weapon = new THREE.Group();
  camera.add(weapon);

  const gunDark = mat(0x0c1016, 0.45, 0.35);
  const gunMid = mat(0x2d3644, 0.5, 0.3);
  const sleeve = mat(0x080b0d, 0.85);
  const glove = mat(0x030303, 0.75);

  const leftArm = box(0.2, 0.2, 0.75, sleeve);
  leftArm.position.set(-0.36, -0.17, -0.85);
  leftArm.rotation.x = -0.55;
  weapon.add(leftArm);

  const rightArm = box(0.2, 0.2, 0.75, sleeve);
  rightArm.position.set(0.28, -0.23, -0.68);
  rightArm.rotation.x = -0.35;
  weapon.add(rightArm);

  const leftHand = box(0.18, 0.16, 0.2, glove);
  leftHand.position.set(-0.24, -0.2, -1.2);
  weapon.add(leftHand);

  const rightHand = box(0.18, 0.16, 0.2, glove);
  rightHand.position.set(0.16, -0.26, -0.9);
  weapon.add(rightHand);

  const receiver = box(0.34, 0.23, 0.85, gunMid);
  receiver.position.set(0.02, -0.05, -1.0);
  weapon.add(receiver);

  const handguard = box(0.27, 0.18, 0.6, gunDark);
  handguard.position.set(0.02, -0.02, -1.48);
  weapon.add(handguard);

  const mag = box(0.2, 0.52, 0.24, gunDark);
  mag.position.set(0.02, -0.43, -1.05);
  mag.rotation.x = 0.12;
  weapon.add(mag);

  const barrel = cylinder(0.045, 0.045, 1.0, gunDark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0.02, 0.02, -1.85);
  weapon.add(barrel);

  const sight = cylinder(0.16, 0.16, 0.13, gunDark, 24);
  sight.rotation.x = Math.PI / 2;
  sight.position.set(0.02, 0.44, -0.86);
  weapon.add(sight);

  const lens = new THREE.Mesh(
    new THREE.CircleGeometry(0.1, 32),
    new THREE.MeshBasicMaterial({
      color: 0x6dbbff,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
    })
  );
  lens.position.set(0.02, 0.44, -0.95);
  lens.rotation.y = Math.PI;
  weapon.add(lens);

  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.014, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xff1515 })
  );
  dot.position.set(0.02, 0.44, -0.965);
  weapon.add(dot);

  muzzleFlash = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.55, 16),
    new THREE.MeshBasicMaterial({
      color: 0xffd66b,
      transparent: true,
      opacity: 0.9,
    })
  );
  muzzleFlash.rotation.x = -Math.PI / 2;
  muzzleFlash.position.set(0.02, 0.02, -2.45);
  muzzleFlash.visible = false;
  weapon.add(muzzleFlash);

  muzzle = new THREE.Object3D();
  muzzle.position.set(0.02, 0.02, -2.45);
  weapon.add(muzzle);

  laserLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(0, 0, -20),
    ]),
    new THREE.LineBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.65,
    })
  );
  scene.add(laserLine);

  laserDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xff0000 })
  );
  scene.add(laserDot);
}

function makeHelmetOverlay() {
  helmetOverlay = new THREE.Group();

  const helmetMat = new THREE.MeshBasicMaterial({
    color: 0x0d120f,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
  });

  const visorMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });

  const rightEdge = box(0.22, 0.8, 0.08, helmetMat);
  rightEdge.position.set(0.62, 0.05, -0.55);
  helmetOverlay.add(rightEdge);

  const topEdge = box(1.25, 0.12, 0.08, helmetMat);
  topEdge.position.set(0.05, 0.48, -0.6);
  helmetOverlay.add(topEdge);

  const visor = box(0.55, 0.22, 0.05, visorMat);
  visor.position.set(0.22, 0.18, -0.66);
  helmetOverlay.add(visor);

  helmetOverlay.visible = false;
  camera.add(helmetOverlay);
}

function makeEnemy(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const rig = createOperatorRig(false);
  group.add(rig.visual);

  const enemy = {
    group,
    rig,
    hp: 100,
    alive: true,
    shootTimer: Math.random() * 1.2,
    thinkTimer: 0,
    target: null,
    speed: 2.6 + Math.random() * 0.5,
    armDamage: 0,
    legDamage: 0,
  };

  makeEnemyHitboxes(enemy);

  scene.add(group);
  enemies.push(enemy);

  return enemy;
}

function makeEnemyHitboxes(enemy) {
  const hitMat = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 0.001,
  });

  const zones = [
    { name: "head", size: [0.55, 0.55, 0.55], pos: [0, 1.75, 0] },
    { name: "torso", size: [0.85, 0.95, 0.45], pos: [0, 1.05, 0] },
    { name: "leftArm", size: [0.3, 0.85, 0.3], pos: [-0.58, 1.1, 0] },
    { name: "rightArm", size: [0.3, 0.85, 0.3], pos: [0.58, 1.1, 0] },
    { name: "leftLeg", size: [0.32, 0.85, 0.32], pos: [-0.22, 0.35, 0] },
    { name: "rightLeg", size: [0.32, 0.85, 0.32], pos: [0.22, 0.35, 0] },
  ];

  for (const zone of zones) {
    const mesh = box(zone.size[0], zone.size[1], zone.size[2], hitMat);
    mesh.position.set(zone.pos[0], zone.pos[1], zone.pos[2]);
    mesh.userData.enemy = enemy;
    mesh.userData.zone = zone.name;
    enemy.group.add(mesh);
    enemyHitboxes.push(mesh);
  }
}

function spawnEnemies() {
  for (let i = 0; i < 9; i++) {
    let x = 0;
    let z = 0;

    for (let t = 0; t < 200; t++) {
      x = -38 + Math.random() * 76;
      z = -38 + Math.random() * 76;

      const dx = x - camera.position.x;
      const dz = z - camera.position.z;

      if (!collides(x, z) && Math.sqrt(dx * dx + dz * dz) > 12) {
        break;
      }
    }

    makeEnemy(x, z);
  }
}

function nearestTargetFor(enemy) {
  let best = {
    type: "player",
    pos: camera.position.clone(),
    dist: enemy.group.position.distanceTo(camera.position),
    enemy: null,
  };

  for (const other of enemies) {
    if (other === enemy || !other.alive) continue;

    const dist = enemy.group.position.distanceTo(other.group.position);

    if (dist < best.dist) {
      best = {
        type: "enemy",
        pos: other.group.position.clone().add(new THREE.Vector3(0, 1.35, 0)),
        dist,
        enemy: other,
      };
    }
  }

  return best;
}

function updateEnemies(dt) {
  for (const enemy of enemies) {
    if (!enemy.alive) continue;

    const target = nearestTargetFor(enemy);
    enemy.target = target;

    const pos = enemy.group.position;
    const targetPos = target.pos;

    const flatTarget = new THREE.Vector3(targetPos.x, 0, targetPos.z);
    const flatPos = new THREE.Vector3(pos.x, 0, pos.z);
    const dir = flatTarget.sub(flatPos);
    const dist = dir.length();

    if (dist > 0.001) {
      dir.normalize();
    }

    enemy.group.rotation.y = Math.atan2(-dir.x, -dir.z);

    const canSee = !lineBlocked(
      pos.clone().add(new THREE.Vector3(0, 1.4, 0)),
      targetPos
    );

    const moveSpeed = enemy.speed * (1 - enemy.legDamage * 0.45);

    if (dist > 8 || !canSee) {
      const nx = pos.x + dir.x * moveSpeed * dt;
      const nz = pos.z + dir.z * moveSpeed * dt;

      if (!collides(nx, pos.z)) pos.x = nx;
      if (!collides(pos.x, nz)) pos.z = nz;
    }

    enemy.shootTimer -= dt;

    if (dist < 35 && canSee && enemy.shootTimer <= 0) {
      enemyShoot(enemy, target);
      enemy.shootTimer = 0.75 + Math.random() * 0.8 + enemy.armDamage * 0.6;
    }

    animateRig(enemy.rig, dt, dist > 8, canSee && dist < 35);
  }
}

function enemyShoot(enemy, target) {
  const start = enemy.group.position.clone().add(new THREE.Vector3(0, 1.4, 0));
  const end = target.pos.clone();

  const miss = 0.16 + enemy.armDamage * 0.28 + Math.random() * 0.1;
  end.x += (Math.random() - 0.5) * miss * 6;
  end.y += (Math.random() - 0.5) * miss * 4;
  end.z += (Math.random() - 0.5) * miss * 6;

  makeBulletLine(start, end, 0xffd36b);
  playSound(105, 0.04, "square", 0.035);

  if (target.type === "player") {
    if (Math.random() > miss) {
      damagePlayer(6 + Math.random() * 8);
    }
  } else if (target.enemy && target.enemy.alive) {
    if (Math.random() > miss) {
      damageEnemy(target.enemy, "torso", 20 + Math.random() * 12, target.enemy.group.position);
    }
  }
}

function updatePlayer(dt) {
  const forwardInput =
    (keys["KeyW"] || keys["ArrowUp"] ? 1 : 0) -
    (keys["KeyS"] || keys["ArrowDown"] ? 1 : 0);

  const sideInput =
    (keys["KeyD"] || keys["ArrowRight"] ? 1 : 0) -
    (keys["KeyA"] || keys["ArrowLeft"] ? 1 : 0);

  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

  const wish = new THREE.Vector3();
  wish.addScaledVector(forward, forwardInput);
  wish.addScaledVector(right, sideInput);

  const sprinting = keys["ShiftLeft"] || keys["ShiftRight"];
  const aimingSlow = aiming ? 0.64 : 1;
  const legSlow = 1 - legDamage * 0.55;
  const speed = 7.2 * (sprinting ? 1.35 : 1) * aimingSlow * legSlow;

  if (wish.lengthSq() > 0) {
    wish.normalize();
    velocity.x += (wish.x * speed - velocity.x) * Math.min(1, dt * 12);
    velocity.z += (wish.z * speed - velocity.z) * Math.min(1, dt * 12);
  } else {
    velocity.x *= Math.pow(0.001, dt);
    velocity.z *= Math.pow(0.001, dt);
  }

  const nx = camera.position.x + velocity.x * dt;
  const nz = camera.position.z + velocity.z * dt;

  if (!collides(nx, camera.position.z)) {
    camera.position.x = nx;
  } else {
    velocity.x = 0;
  }

  if (!collides(camera.position.x, nz)) {
    camera.position.z = nz;
  } else {
    velocity.z = 0;
  }

  camera.position.y = 1.72;

  camera.rotation.y = yaw;
  camera.rotation.x = pitch;

  if (shootTimer > 0) shootTimer -= dt;

  if (reloading) {
    reloadTimer -= dt;

    if (reloadTimer <= 0) {
      finishReload();
    }

    if (sprinting) {
      cancelReload();
    }
  }
}

function updateLocalBody(dt) {
  if (!localRig) return;

  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

  const cameraForwardOffset = helmetCam ? 0.45 : 0.32;
  const sideOffset = helmetCam ? 0.24 : 0;

  localRig.visual.position.x =
    camera.position.x - forward.x * cameraForwardOffset - right.x * sideOffset;

  localRig.visual.position.z =
    camera.position.z - forward.z * cameraForwardOffset - right.z * sideOffset;

  localRig.visual.rotation.y = yaw;

  const moving = Math.abs(velocity.x) + Math.abs(velocity.z) > 0.4;

  /*
    Only show the local body when looking down enough.
    This avoids the camera clipping inside the model's face.
  */
  localRig.visual.visible = pitch < -0.2;

  animateRig(localRig, dt, moving, aiming);
}

function updateWeapon(dt) {
  const moving = Math.abs(velocity.x) + Math.abs(velocity.z) > 0.4;
  const t = performance.now() * 0.001;

  const wallClose = isGunBlocked();
  const aimAmount = aiming && !wallClose && !reloading ? 1 : 0;
  const highReady = wallClose ? 1 : 0;

  swayX *= Math.pow(0.015, dt);
  swayY *= Math.pow(0.015, dt);

  recoil = Math.max(0, recoil - dt * 7.5);

  const hip = new THREE.Vector3(0.42, -0.46, -0.9);
  const ads = new THREE.Vector3(0.0, -0.31, -0.68);
  const high = new THREE.Vector3(0.36, -0.03, -0.72);

  const pos = hip.clone().lerp(ads, aimAmount);
  pos.lerp(high, highReady);

  if (helmetCam) {
    pos.x += 0.08;
  }

  const bob = moving ? Math.sin(t * 9) * 0.018 : Math.sin(t * 2) * 0.006;
  const sideBob = moving ? Math.cos(t * 7) * 0.012 : 0;

  pos.y += bob;
  pos.x += sideBob - swayX * (aiming ? 0.3 : 1);
  pos.y += swayY * (aiming ? 0.25 : 1);
  pos.z += recoil * 0.16;
  pos.y -= recoil * 0.04;

  weapon.position.copy(pos);

  weapon.rotation.x = -recoil * 0.22 + swayY * 0.45;
  weapon.rotation.y = sideBob * 0.5 + swayX * 0.65;
  weapon.rotation.z = sideBob * -0.8;

  if (highReady > 0) {
    weapon.rotation.x -= 0.75;
    weapon.rotation.y += 0.38;
    weapon.rotation.z -= 0.32;
    statusText.textContent = "WEAPON BLOCKED";
  } else if (!reloading) {
    statusText.textContent = "";
  }

  if (reloading) {
    const p = 1 - reloadTimer / 1.7;
    weapon.position.y -= Math.sin(p * Math.PI) * 0.25;
    weapon.rotation.z += Math.sin(p * Math.PI) * 0.38;
  }

  if (muzzleFlash.visible && recoil < 0.55) {
    muzzleFlash.visible = false;
  }

  updateLaser();

  helmetOverlay.visible = helmetCam && running;
  modeText.textContent = helmetCam ? "HELMET CAM ON" : "HELMET CAM OFF";
}

function isGunBlocked() {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);

  raycaster.set(camera.position, dir);
  raycaster.far = 1.35;

  const hits = raycaster.intersectObjects(worldMeshes, false);

  if (hits.length > 0) return true;

  return pitch < -1.05;
}

function updateLaser() {
  const origin = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const dir = new THREE.Vector3(0, 0, -1);

  muzzle.getWorldPosition(origin);
  muzzle.getWorldQuaternion(quat);
  dir.applyQuaternion(quat).normalize();

  let end = origin.clone().addScaledVector(dir, 55);

  raycaster.set(origin, dir);
  raycaster.far = 55;

  const hits = raycaster.intersectObjects(worldMeshes.concat(enemyHitboxes), false);

  if (hits.length > 0) {
    end = hits[0].point;
  }

  laserLine.geometry.setFromPoints([origin, end]);
  laserLine.geometry.attributes.position.needsUpdate = true;

  laserLine.material.opacity = reloading ? 0.08 : 0.62;
  laserDot.position.copy(end);
  laserDot.visible = running && !reloading;
}

function shoot() {
  if (!running || dead || reloading) return;
  if (shootTimer > 0) return;

  if (isGunBlocked()) {
    statusText.textContent = "WEAPON BLOCKED";
    return;
  }

  if (ammo <= 0) {
    reload();
    return;
  }

  ammo--;
  shootTimer = 0.095;
  recoil = 1 + armDamage * 0.65;
  muzzleFlash.visible = true;

  playSound(145, 0.045, "square", 0.075);
  playSound(70, 0.06, "sawtooth", 0.05);

  raycaster.setFromCamera(center, camera);
  raycaster.far = 90;

  const targets = enemyHitboxes.concat(worldMeshes);
  const hits = raycaster.intersectObjects(targets, false);

  const start = new THREE.Vector3();
  muzzle.getWorldPosition(start);

  let end = raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(70));

  if (hits.length > 0) {
    const hit = hits[0];
    end = hit.point;

    if (hit.object.userData.enemy) {
      const enemy = hit.object.userData.enemy;
      const zone = hit.object.userData.zone;
      damageEnemy(enemy, zone, getDamageForZone(zone), hit.point);
    } else {
      handleWorldHit(hit.object, hit.point);
    }
  }

  makeBulletLine(start, end, 0xfff2a0);
  updateHud();
}

function getDamageForZone(zone) {
  if (zone === "head") return 115;
  if (zone.includes("Arm")) return 22;
  if (zone.includes("Leg")) return 26;
  return 42;
}

function damageEnemy(enemy, zone, amount, point) {
  if (!enemy.alive) return;

  enemy.hp -= amount;

  if (zone.includes("Arm")) {
    enemy.armDamage = Math.min(1, enemy.armDamage + 0.32);
  }

  if (zone.includes("Leg")) {
    enemy.legDamage = Math.min(1, enemy.legDamage + 0.32);
  }

  spawnParticles(point, zone === "head" ? 24 : 12, 0x8a0d12);

  if (enemy.hp <= 0) {
    killEnemy(enemy);
  }
}

function killEnemy(enemy) {
  enemy.alive = false;

  for (let i = enemyHitboxes.length - 1; i >= 0; i--) {
    if (enemyHitboxes[i].userData.enemy === enemy) {
      enemy.group.remove(enemyHitboxes[i]);
      enemyHitboxes.splice(i, 1);
    }
  }

  enemy.group.rotation.x = -Math.PI / 2;
  enemy.group.position.y = 0.12;

  spawnParticles(enemy.group.position.clone().add(new THREE.Vector3(0, 1, 0)), 30, 0x8a0d12);
}

function handleWorldHit(obj, point) {
  if (obj.userData.breakableGlass) {
    scene.remove(obj);

    const index = worldMeshes.indexOf(obj);
    if (index >= 0) worldMeshes.splice(index, 1);

    spawnParticles(point, 26, 0xbfefff);
    playSound(530, 0.08, "triangle", 0.05);
    return;
  }

  if (obj.userData.lightObject) {
    obj.material.color.setHex(0x151515);
    spawnParticles(point, 16, 0xffffaa);
    playSound(260, 0.06, "square", 0.04);
    return;
  }

  if (obj.userData.doorHandle && obj.userData.doorGroup) {
    obj.userData.doorGroup.userData.loose = true;
    obj.userData.doorGroup.userData.speed = 4.5;
    spawnParticles(point, 12, 0x222222);
    playSound(190, 0.08, "sawtooth", 0.05);
    return;
  }

  spawnParticles(point, 8, 0xb9b1a2);
}

function reload() {
  if (!running || dead || reloading) return;
  if (ammo >= 30) return;
  if (reserveAmmo <= 0) {
    statusText.textContent = "NO RESERVE AMMO";
    return;
  }

  reloading = true;
  reloadTimer = 1.7;
  statusText.textContent = "RELOADING";

  playSound(260, 0.08, "triangle", 0.055);

  setTimeout(() => {
    if (reloading) playSound(155, 0.08, "sawtooth", 0.045);
  }, 550);

  setTimeout(() => {
    if (reloading) playSound(360, 0.06, "triangle", 0.055);
  }, 1250);
}

function cancelReload() {
  reloading = false;
  reloadTimer = 0;
  statusText.textContent = "RELOAD CANCELLED";
}

function finishReload() {
  const need = 30 - ammo;
  const take = Math.min(need, reserveAmmo);

  ammo += take;
  reserveAmmo -= take;
  reloading = false;
  statusText.textContent = "";
  updateHud();
}

function damagePlayer(amount) {
  if (dead) return;

  health -= amount;
  damageFlash = 0.45;

  if (Math.random() < 0.25) {
    armDamage = Math.min(1, armDamage + 0.18);
  }

  if (Math.random() < 0.2) {
    legDamage = Math.min(1, legDamage + 0.18);
  }

  playSound(90, 0.08, "sawtooth", 0.07);

  if (health <= 0) {
    health = 0;
    die();
  }

  updateHud();
}

function die() {
  dead = true;
  running = false;
  aiming = false;
  reloading = false;

  if (document.pointerLockElement) {
    document.exitPointerLock();
  }

  hud.style.display = "none";
  deathScreen.style.display = "grid";
  deathScreen.querySelector(".deathText").textContent = "SIGNAL LOST";

  setTimeout(() => {
    deathScreen.style.display = "none";
    menu.style.display = "grid";
    playBtn.textContent = "RESPAWN";
  }, 2000);
}

function updateHud() {
  healthBar.style.width = `${Math.max(0, health)}%`;
  ammoText.textContent = `${ammoEstimate(ammo)} / ${reserveEstimate(reserveAmmo)}`;
  modeText.textContent = helmetCam ? "HELMET CAM ON" : "HELMET CAM OFF";
}

function ammoEstimate(value) {
  if (value <= 0) return "EMPTY";
  if (value <= 7) return "LOW";
  if (value <= 16) return "HALF";
  if (value <= 25) return "MOSTLY FULL";
  return "FULL";
}

function reserveEstimate(value) {
  if (value <= 0) return "NO RESERVE";
  if (value <= 20) return "LOW";
  if (value <= 60) return "OK";
  return "PLENTY";
}

function makeBulletLine(start, end, color) {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([start, end]),
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
    })
  );

  line.userData.life = 0.07;
  scene.add(line);
  bulletLines.push(line);
}

function updateBulletLines(dt) {
  for (let i = bulletLines.length - 1; i >= 0; i--) {
    const line = bulletLines[i];
    line.userData.life -= dt;
    line.material.opacity = Math.max(0, line.userData.life / 0.07);

    if (line.userData.life <= 0) {
      scene.remove(line);
      bulletLines.splice(i, 1);
    }
  }
}

function spawnParticles(pos, count, color) {
  for (let i = 0; i < count; i++) {
    const p = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.045, 0.045),
      new THREE.MeshBasicMaterial({ color })
    );

    p.position.copy(pos);
    p.userData.velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 4,
      Math.random() * 3.2,
      (Math.random() - 0.5) * 4
    );
    p.userData.life = 0.45 + Math.random() * 0.35;

    scene.add(p);
    particles.push(p);
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];

    p.userData.life -= dt;
    p.userData.velocity.y -= 6.5 * dt;
    p.position.addScaledVector(p.userData.velocity, dt);

    if (p.userData.life <= 0) {
      scene.remove(p);
      particles.splice(i, 1);
    }
  }
}

function playSound(freq, duration, type, volume) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;

    if (!AudioCtx) return;

    if (!window.blockOpsAudio) {
      window.blockOpsAudio = new AudioCtx();
    }

    const ac = window.blockOpsAudio;

    if (ac.state === "suspended") {
      ac.resume();
    }

    const osc = ac.createOscillator();
    const gain = ac.createGain();

    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;

    osc.connect(gain);
    gain.connect(ac.destination);

    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
    osc.stop(ac.currentTime + duration);
  } catch {}
}

function clearEnemies() {
  for (const enemy of enemies) {
    scene.remove(enemy.group);
  }

  enemies.length = 0;
  enemyHitboxes.length = 0;
}

function resetGame() {
  clearEnemies();

  health = 100;
  ammo = 30;
  reserveAmmo = 90;
  armDamage = 0;
  legDamage = 0;
  recoil = 0;
  dead = false;
  reloading = false;
  aiming = false;

  yaw = 0;
  pitch = 0;
  velocity.set(0, 0, 0);

  camera.position.set(0, 1.72, 10);
  camera.rotation.set(0, 0, 0);

  if (localRig) {
    scene.remove(localRig.visual);
  }

  localRig = createOperatorRig(true);
  scene.add(localRig.visual);

  spawnEnemies();
  updateHud();
}

function startGame() {
  menu.style.display = "none";
  hud.style.display = "block";
  deathScreen.style.display = "none";

  resetGame();

  running = true;

  requestPointerLock();
}

function requestPointerLock() {
  try {
    renderer.domElement.requestPointerLock();
  } catch {}
}

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);

  if (running) {
    updatePlayer(dt);
    updateLocalBody(dt);
    updateWeapon(dt);
    updateEnemies(dt);
    updateDoors(dt);
  }

  damageFlash = Math.max(0, damageFlash - dt * 1.8);

  updateParticles(dt);
  updateBulletLines(dt);

  renderer.domElement.style.filter = damageFlash > 0
    ? `brightness(${1 + damageFlash}) contrast(${1 + damageFlash * 0.5})`
    : "";

  renderer.render(scene, camera);
}

playBtn.onclick = startGame;

renderer.domElement.addEventListener("click", () => {
  if (running && !pointerLocked) {
    requestPointerLock();
  }
});

document.addEventListener("pointerlockchange", () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
});

document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
  if (!running || !pointerLocked) return;

  const sens = aiming ? 0.0012 : 0.002;

  yaw -= e.movementX * sens;
  pitch -= e.movementY * sens;

  pitch = THREE.MathUtils.clamp(pitch, -1.25, 1.2);

  swayX += e.movementX * 0.0008;
  swayY += e.movementY * 0.0006;

  swayX = THREE.MathUtils.clamp(swayX, -0.06, 0.06);
  swayY = THREE.MathUtils.clamp(swayY, -0.05, 0.05);
});

document.addEventListener("mousedown", (e) => {
  if (!running) return;

  if (!pointerLocked) {
    requestPointerLock();
    return;
  }

  if (e.button === 0) shoot();
  if (e.button === 2) aiming = true;
});

document.addEventListener("mouseup", (e) => {
  if (e.button === 2) aiming = false;
});

document.addEventListener("keydown", (e) => {
  keys[e.code] = true;

  if (e.code === "KeyR") reload();

  if (e.code === "KeyH") {
    helmetCam = !helmetCam;
    helmetOverlay.visible = helmetCam && running;
    updateHud();
  }

  if (e.code === "Space") {
    e.preventDefault();
    shoot();
  }
});

document.addEventListener("keyup", (e) => {
  keys[e.code] = false;
});

window.addEventListener("blur", () => {
  for (const key of Object.keys(keys)) {
    keys[key] = false;
  }

  aiming = false;
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

makeWorld();
makeWeapon();
makeHelmetOverlay();
loadOperatorModel();
animate();
