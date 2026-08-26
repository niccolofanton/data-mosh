import * as THREE from 'three';
import { DataMoshManager } from './datamosh';
import { controls, createPane } from './debug';
import { SHOTS } from './scenes';

// Renderer and canvas. The composer takes over clearing, so nothing else here
// touches the framebuffer.
const renderer = new THREE.WebGLRenderer({ powerPreference: 'high-performance' });
document.body.append(renderer.domElement);

// One scene holding every shot at once: switching is a visibility flip, which
// keeps the geometry warm and the cut instant.
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);

// One fog instance for the whole run, recoloured and re-dialled on the cut.
// Attached up front because adding it later would recompile every material;
// a density of zero is the shots that want to see all the way out.
const fog = new THREE.FogExp2(0x000000, 0);
scene.fog = fog;
const light = new THREE.DirectionalLight(0xffffff, 2.4);
light.position.set(3, 4, 5);
scene.add(new THREE.AmbientLight(0xffffff, 1.1), light, ...SHOTS.map((shot) => shot.object));

// The cut. Called once at boot, and then by the manager on every gesture: the
// new shot lands in the frame after the one already on screen, which is exactly
// the mismatch the effect feeds on.
let index = -1;

const cut = (): true => {
  index = (index + 1) % SHOTS.length;
  const shot = SHOTS[index];

  for (const [i, other] of SHOTS.entries()) other.object.visible = i === index;
  scene.background = shot.background;
  // Same colour as the background, so what the fog swallows lands exactly on
  // the clear colour and the far edge of a shot stops existing.
  fog.color.copy(shot.background);
  fog.density = shot.fog;
  camera.position.set(...shot.camera);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return true;
};

// Trigger state. Pointer, spacebar and the latch toggle all feed one flag the
// manager polls; `lastRelease` starts the recovery fade. Tracking the two
// sources apart is what stops a released key from cancelling a held mouse.
const input = { pressed: false, lastRelease: -1 };
const held = { pointer: false, keyboard: false };

const sync = (source?: keyof typeof held, down = false) => {
  if (source) held[source] = down;

  const pressed = controls.latch || held.pointer || held.keyboard;
  if (pressed === input.pressed) return;

  input.pressed = pressed;
  input.lastRelease = pressed ? -1 : performance.now();
};

// Press on the canvas only, so dragging a slider does not trigger the effect —
// but release anywhere, including outside the window. pointercancel covers a
// touch stolen by a system gesture, blur an alt-tab with the key still down:
// either would otherwise leave the effect stuck on.
renderer.domElement.addEventListener('pointerdown', (e) => { if (e.button === 0) sync('pointer', true); });
for (const type of ['pointerup', 'pointercancel']) addEventListener(type, () => sync('pointer'));
addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat) sync('keyboard', true); });
addEventListener('keyup', (e) => { if (e.code === 'Space') sync('keyboard'); });
addEventListener('blur', () => { held.pointer = held.keyboard = false; sync(); });

cut();

// A panel change can flip the trigger (the latch) as well as any shader value,
// so both are refreshed on the same callback.
const manager = new DataMoshManager(renderer, scene, camera, input, cut);
createPane(() => { sync(); manager.updateSettings(); });

// setPixelRatio has to stay here: the composer only resizes the renderer when
// the CSS size changes, so moving the window to a different display would
// otherwise leave the buffers at the old density.
const resize = () => {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  manager.setSize(innerWidth, innerHeight);
};

addEventListener('resize', resize);
resize();

// Every shot animates, visible or not: the cut has to land mid-movement, or
// there would be no motion for the decoder to smear the old picture along.
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  for (const shot of SHOTS) shot.update(delta);
  manager.render(delta);
});
