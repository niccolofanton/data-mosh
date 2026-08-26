import * as THREE from 'three';
import { forgetPreviousMatrix } from './datamosh';

/**
 * The shots the effect cuts between. Every one of them is a different *shape*
 * of motion field, because that is the only thing the decoder ever sees: a
 * translation, a zoom, a rotation, and vectors that disagree with their
 * neighbours all smear in completely different ways. Light and dark alternate
 * down the list so that any cut also inverts the picture.
 */
export type Shot = {
  background: THREE.Color; camera: [number, number, number];
  /** Exponential fog density, in the shot's own background colour. 0 = none. */
  fog: number;
  object: THREE.Object3D; update: (delta: number) => void;
};

const knot = new THREE.Mesh(
  // 0.85 and 0.306: the knot at 85%, tube included, so it keeps its
  // proportions and simply sits further inside the frame.
  new THREE.TorusKnotGeometry(0.85, 0.306, 180, 32),
  new THREE.MeshStandardMaterial({ color: '#e9e3d4', roughness: 0.35, metalness: 0.15 }),
);

// The swarm. Positions are spread by multiplying the index with primes and
// keeping the remainder: scattered enough to read as random, and identical on
// every run, which is what makes the effect reproducible.
const COUNT = 50;
const SPAN = 40;
const SPEED = 3.2;

const boxes = new THREE.Group();
// The tilt is baked into the shared geometry: 50 meshes, one buffer, no
// per-object rotation to update.
const boxGeometry = new THREE.BoxGeometry().rotateY(0.8).rotateX(0.4);
const boxMaterial = new THREE.MeshStandardMaterial({ color: '#1b1b22', roughness: 0.5 });
const spread = (i: number, prime: number) => ((i * prime) % 1000) / 1000;

for (let i = 0; i < COUNT; i++) {
  const box = new THREE.Mesh(boxGeometry, boxMaterial);
  box.position.set(-SPAN / 2 + spread(i, 7919) * SPAN, -2 + spread(i, 6151) * 4, -6 + spread(i, 3571) * 8);
  box.scale.setScalar(0.4 + spread(i, 2749) * 0.7);
  boxes.add(box);
}

// The tunnel. Rings coming straight down the barrel, so the vectors point out
// of the centre of the frame instead of across it: the picture is torn open
// from the middle rather than dragged sideways.
const RING_COUNT = 18;
const RING_GAP = 1.7;
const RING_SPEED = 7;
const RING_END = 5.5;

const tunnel = new THREE.Group();
const ringGeometry = new THREE.TorusGeometry(2.3, 0.13, 8, 56);
const ringMaterial = new THREE.MeshStandardMaterial({ color: '#8fd8ff', roughness: 0.25, metalness: 0.5 });

for (let i = 0; i < RING_COUNT; i++) {
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  // The twist stops the rings from reading as one smooth pipe, which would
  // leave the block matcher nothing to lock onto along the wall.
  ring.position.z = RING_END - i * RING_GAP;
  ring.rotation.z = i * 0.35;
  tunnel.add(ring);
}

// The wave. Neighbouring columns ride opposite phases, so half the blocks in
// any neighbourhood move up while the other half move down — the worst case for
// block matching, and where the mismatch dial finally has something to bite on.
const WAVE_COLS = 19;
const WAVE_ROWS = 11;
const WAVE_PITCH = 0.82;
const WAVE_AMPLITUDE = 0.62;

const wave = new THREE.Group();
const cubeGeometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
const cubeMaterial = new THREE.MeshStandardMaterial({ color: '#23232b', roughness: 0.55 });
let wavePhase = 0;

for (let i = 0; i < WAVE_COLS * WAVE_ROWS; i++) {
  const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
  cube.position.x = ((i % WAVE_COLS) - (WAVE_COLS - 1) / 2) * WAVE_PITCH;
  wave.add(cube);
}

// The vortex. One flat fan turning in the plane of the screen: the vectors are
// tangential and grow with the radius, so the smear curls instead of running
// off in a straight line.
const BLADES = 11;
const BLADE_RADIUS = 1.75;

const vortex = new THREE.Group();
const bladeGeometry = new THREE.BoxGeometry(2.7, 0.24, 0.06);
const bladeMaterial = new THREE.MeshStandardMaterial({ color: '#ff9a52', roughness: 0.4, metalness: 0.2 });

for (let i = 0; i < BLADES; i++) {
  const angle = (i / BLADES) * Math.PI * 2;
  const blade = new THREE.Mesh(bladeGeometry, bladeMaterial);
  blade.position.set(Math.cos(angle) * BLADE_RADIUS, Math.sin(angle) * BLADE_RADIUS, i * 0.02);
  blade.rotation.z = angle;
  vortex.add(blade);
}

// The floor. A hard checker sliding away in perspective: the vectors are long
// at the bottom of the frame and sub-pixel at the horizon, so one shot holds
// every magnitude at once. The 2x2 texture is the cheapest way to hand the
// residual coder the high frequencies it exists to correct.
const FLOOR_SPEED = 5;
/** Two cells of the pattern, in world units: the wrap distance. */
const FLOOR_PERIOD = 4;

const checker = new THREE.DataTexture(
  new Uint8Array([234, 231, 222, 255, 26, 26, 32, 255, 26, 26, 32, 255, 234, 231, 222, 255]), 2, 2,
);
checker.needsUpdate = true;
checker.wrapS = checker.wrapT = THREE.RepeatWrapping;
checker.repeat.setScalar(30);
checker.colorSpace = THREE.SRGBColorSpace;
// Mipmaps on a 2x2 checker collapse to flat grey in the distance, which is
// exactly right: the alternative is a shimmering moiré that the velocity pass
// would happily measure as real motion.
checker.generateMipmaps = true;
checker.minFilter = THREE.LinearMipmapLinearFilter;
checker.magFilter = THREE.NearestFilter;

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ map: checker, roughness: 0.8 }),
);
floor.position.y = -1.4;

export const SHOTS: Shot[] = [
  {
    background: new THREE.Color('#0b0b0f'),
    camera: [0, 0, 4.2],
    fog: 0,
    object: knot,
    update: (delta) => knot.rotation.set(knot.rotation.x + delta * 0.55, knot.rotation.y + delta * 0.9, 0),
  },
  {
    background: new THREE.Color('#d9d4c8'),
    camera: [0, 0.6, 6],
    // The swarm wraps well outside the frame, so there is nothing to hide.
    fog: 0,
    object: boxes,
    // Each box wraps on its own, so the swarm never lines up into a visible seam.
    update: (delta) => boxes.children.forEach((box) => {
      box.position.x -= SPEED * delta;
      if (box.position.x < -SPAN / 2) {
        box.position.x += SPAN;
        forgetPreviousMatrix(box);
      }
    }),
  },
  {
    background: new THREE.Color('#04060d'),
    camera: [0, 0, 6],
    // Heavy: the rings recycle 31 units out, and the fog has to be shut well
    // before that or the new one is seen arriving. It also gives the tube its
    // depth — on a near-black background the falloff reads as distance.
    fog: 0.1,
    object: tunnel,
    update: (delta) => tunnel.children.forEach((ring) => {
      ring.position.z += RING_SPEED * delta;
      if (ring.position.z > RING_END) {
        ring.position.z -= RING_COUNT * RING_GAP;
        forgetPreviousMatrix(ring);
      }
    }),
  },
  {
    background: new THREE.Color('#ccd3d7'),
    camera: [0, 0, 9],
    fog: 0,
    object: wave,
    update: (delta) => {
      wavePhase += delta;
      wave.children.forEach((cube, i) => {
        const row = Math.floor(i / WAVE_COLS);
        cube.position.y = (row - (WAVE_ROWS - 1) / 2) * WAVE_PITCH
          + Math.sin(wavePhase * 2.6 + (i % WAVE_COLS) * 2.1) * WAVE_AMPLITUDE;
      });
    },
  },
  {
    background: new THREE.Color('#130a14'),
    camera: [0, 0, 5.5],
    fog: 0,
    object: vortex,
    update: (delta) => { vortex.rotation.z += delta * 1.5; },
  },
  {
    background: new THREE.Color('#b6c0c6'),
    camera: [0, 1.1, 5],
    // Buries the far edge of the plane well before it is reached. Without it
    // the horizon *is* that edge, and it visibly hops every time the floor
    // wraps back on itself.
    fog: 0.05,
    object: floor,
    // Wrapping on the pattern period rather than on the plane keeps the jump
    // out of the picture: the checker lands exactly back on itself. It is still
    // a teleport as far as the velocity pass is concerned, hence the forget.
    update: (delta) => {
      floor.position.z += FLOOR_SPEED * delta;
      if (floor.position.z > FLOOR_PERIOD) {
        floor.position.z -= FLOOR_PERIOD;
        forgetPreviousMatrix(floor);
      }
    },
  },
];
