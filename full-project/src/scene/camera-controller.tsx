import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { moshInput } from "@/state/mosh-input";
import { SCENE_CENTRE, Shot, shot, SHOT_CAMERA } from "@/state/shot";

/**
 * Yaw that aims the camera's -Z axis along `direction`, in the YXZ convention
 * the controller writes below.
 */
const yawTowards = (direction: THREE.Vector3): number =>
  Math.atan2(-direction.x, -direction.z);

/** Pitch that aims the camera's -Z axis along `direction`. */
const pitchTowards = (direction: THREE.Vector3): number =>
  Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));

/**
 * Shortest signed difference between two angles.
 *
 * Yaw wraps, so a target and a current angle can sit a few degrees apart while
 * being on opposite sides of the +/-PI seam. Easing the raw difference then
 * sends the camera the long way round at speed.
 */
const shortestAngle = (from: number, to: number): number =>
  THREE.MathUtils.euclideanModulo(to - from + Math.PI, Math.PI * 2) - Math.PI;

/** Keeps the camera clear of straight up / straight down, where yaw degenerates. */
const MAX_PITCH = THREE.MathUtils.degToRad(80);

/** The original controller was tuned per frame at 60 Hz. */
const REFERENCE_FPS = 60;
const MAX_FRAME_DELTA = 0.1;
const MOVE_SPEED = 0.05 * REFERENCE_FPS;

/** Preserves a per-frame easing coefficient at any refresh rate. */
const deltaAdjustedEase = (easeAt60Fps: number, delta: number): number =>
  1 - Math.pow(1 - easeAt60Fps, delta * REFERENCE_FPS);

/**
 * Camera controller component that handles camera rotation
 */

interface CameraControllerProps {
  autoRotate?: boolean;
}

export const CameraController = ({ autoRotate = false }: CameraControllerProps) => {
  // Selector rather than the whole store: the identity selector re-renders this
  // component on every `set()` r3f makes - size (so, every scroll), dpr,
  // frameloop - none of which it reads.
  const camera = useThree((state) => state.camera);
  // The trigger listens on the canvas, not on the window: the control panel is
  // an overlay, and a window level mousedown made every slider drag and every
  // checkbox click fire the effect.
  const canvas = useThree((state) => state.gl.domElement);
  // Pointer positions are only read inside useFrame, so they live in refs:
  // storing them in state would re-render this (null-rendering) component at
  // pointer-event rate.
  const mousePosition = useRef({ x: 0, y: 0 });
  const touchPosition = useRef({ x: 0, y: 0 });
  const isMouseMoving = useRef(false);
  const isTouchMoving = useRef(false);
  const isMouseOnScreen = useRef(false);
  const lastMouseMoveTime = useRef(0);
  const mouseIdleTimeout = 2000;
  const centralPoint = SCENE_CENTRE;
  const isInitialized = useRef(false);
  const initializationTime = useRef(0);

  const movement = useRef({
    forward: false,
    backward: false,
    left: false,
    right: false,
  });
  // The camera's orientation, owned here instead of being read back from
  // `camera.rotation` every frame.
  //
  // Reading it back cannot work. The controller also eased the quaternion
  // towards the centre of the room, and three keeps the two representations in
  // sync both ways (`Object3D` binds `rotation._onChange` and
  // `quaternion._onChange` to each other), so every frame the Euler angles were
  // re-derived from the quaternion in the default XYZ order - where yaw is
  // `asin(m13)` and therefore confined to +/-90 degrees, with anything beyond
  // expressed as a pitch/roll flip instead. A scene cut swings the camera well
  // past that, so the angles read back bore no relation to the ones written and
  // the two controls chased each other: the spin the user saw.
  //
  // Holding the state here and writing it out in YXZ order - yaw first, so it
  // has the whole circle to itself - removes the flip and the fight at once.
  const yaw = useRef(0);
  const pitch = useRef(0);
  const orientationReady = useRef(false);

  // Which shot is up, and the field of view the room's shot is framed with.
  // Both are read inside useFrame, so neither can be state.
  const activeShot = useRef<Shot>(shot.current);
  const defaultFov = useRef<number | null>(null);

  // Reused every frame; the controller runs on every one of them.
  const scratch = useMemo(
    () => ({
      forward: new THREE.Vector3(),
      toCentre: new THREE.Vector3(),
      right: new THREE.Vector3(),
      offset: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
    }),
    [],
  );

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      mousePosition.current = {
        x: (event.clientX / window.innerWidth) * 2 - 1,
        y: -(event.clientY / window.innerHeight) * 2 + 1,
      };
      isMouseMoving.current = true;
      isMouseOnScreen.current = true;
      lastMouseMoveTime.current = Date.now();

      // Recovery from a lost pointerup: releasing the button over a native
      // widget, a context menu or outside the document never delivers the
      // event, and the trigger would stay down forever. Any movement with no
      // button held proves nothing is pressed any more.
      if (event.buttons === 0) {
        moshInput.release("pointer");
      }
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length > 0) {
        const touch = event.touches[0];
        touchPosition.current = {
          x: (touch.clientX / window.innerWidth) * 2 - 1,
          y: -(touch.clientY / window.innerHeight) * 2 + 1,
        };
        isTouchMoving.current = true;
      }
    };

    // Pointer, touch and spacebar all drive the same shared mosh input store,
    // which the post-processing pipeline reads. Each one owns its own token, so
    // letting go of one never cancels a gesture another one is still holding.
    //
    // The "down" half is bound to the canvas so that interacting with the
    // control panel does not trigger the effect; the "up" half stays global,
    // otherwise dragging off the canvas would leave the trigger stuck.
    const handleTouchStart = () => {
      isTouchMoving.current = true;
      moshInput.press("touch");
    };

    const handleTouchEnd = () => {
      isTouchMoving.current = false;
      moshInput.release("touch");
    };

    const handlePointerDown = (event: PointerEvent) => {
      // Secondary buttons open menus and never deliver a matching up event.
      if (event.button !== 0) return;
      moshInput.press("pointer");
    };

    const handlePointerUp = () => {
      moshInput.release("pointer");
    };

    const handleMouseEnter = () => {
      isMouseOnScreen.current = true;
    };

    const handleMouseLeave = () => {
      isMouseOnScreen.current = false;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore OS auto-repeat: holding a key fires keydown continuously.
      if (event.repeat) return;

      switch (event.code) {
        case "KeyW":
          movement.current.forward = true;
          break;
        case "KeyS":
          movement.current.backward = true;
          break;
        case "KeyA":
          movement.current.left = true;
          break;
        case "KeyD":
          movement.current.right = true;
          break;
        case "Space":
          moshInput.press("keyboard");
          break;
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      switch (event.code) {
        case "KeyW":
          movement.current.forward = false;
          break;
        case "KeyS":
          movement.current.backward = false;
          break;
        case "KeyA":
          movement.current.left = false;
          break;
        case "KeyD":
          movement.current.right = false;
          break;
        case "Space":
          moshInput.release("keyboard");
          break;
      }
    };

    // A key/button held while the window loses focus (or the tab is hidden)
    // never delivers its keyup/pointerup, which would leave the input stuck down.
    const releaseAllInput = () => {
      moshInput.releaseAll();
      movement.current.forward = false;
      movement.current.backward = false;
      movement.current.left = false;
      movement.current.right = false;
      isTouchMoving.current = false;
    };

    const handleVisibilityChange = () => {
      if (document.hidden) releaseAllInput();
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    // Explicitly passive. Chrome's "passive by default" intervention covers
    // touchstart only on window, document and body - on an element target the
    // default is still non-passive, which makes the canvas a scroll-blocking
    // target and holds the compositor until this main thread, busy with the
    // whole composer chain, has run the handler. None of these three calls
    // preventDefault.
    canvas.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    canvas.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("mouseenter", handleMouseEnter);
    window.addEventListener("mouseleave", handleMouseLeave);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", releaseAllInput);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("mouseenter", handleMouseEnter);
      window.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", releaseAllInput);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      releaseAllInput();
    };
  }, [canvas]);

  useEffect(() => {
    if (camera && !isInitialized.current) {
      // Set initial camera rotation more gently
      const direction = new THREE.Vector3().subVectors(centralPoint, camera.position).normalize();
      camera.lookAt(camera.position.clone().add(direction));
      isInitialized.current = true;
      initializationTime.current = Date.now();
    }
  }, [camera, centralPoint]);

  /**
   * The cut a melt gesture triggers: the shot the effect will smear has to be a
   * different shot, not the same one from marginally further along.
   *
   * The camera is swung around the centre of the room by a large angle instead
   * of being dropped at a fixed list of viewpoints. Two reasons: the room is a
   * loaded model this component knows nothing about, and an orbit at a bounded
   * radius provably stays inside the shell the camera can already reach on its
   * own, so no cut can end up inside a wall. The radius and the height are
   * nudged as well, so consecutive cuts on the same side never frame alike.
   *
   * The whole transform is applied at once, orientation included: the camera
   * keeps looking at the centre, which means the next frame measures the motion
   * of the *new* shot rather than the slew of a camera correcting itself.
   */
  useEffect(() => {
    if (!camera) return;

    const { offset, toCentre, up } = scratch;
    const perspective = camera as THREE.PerspectiveCamera;

    if (defaultFov.current === null && perspective.isPerspectiveCamera) {
      defaultFov.current = perspective.fov;
    }

    /** Adopts the shot's field of view, or gives the camera its own back. */
    const setFieldOfView = (value: number | undefined) => {
      const wanted = value ?? defaultFov.current;
      if (!perspective.isPerspectiveCamera || wanted === null) return;
      if (wanted === undefined || perspective.fov === wanted) return;

      perspective.fov = wanted;
      perspective.updateProjectionMatrix();
    };

    return shot.subscribe((current) => {
      activeShot.current = current;

      // The two limbo shots are composed rather than explored: the camera is
      // placed outright and then holds still, so the only thing moving in frame
      // is the subject. Position and orientation are written in the same breath
      // for the same reason the orbit below does it - a camera still swinging
      // into place on the frame after the cut hands the effect the motion of
      // the swing instead of the motion of the new shot.
      if (current !== "room") {
        const pose = SHOT_CAMERA[current];

        setFieldOfView(pose.fov);
        camera.position.set(...pose.position);

        toCentre.set(...pose.target).sub(camera.position).normalize();
        yaw.current = yawTowards(toCentre);
        pitch.current = THREE.MathUtils.clamp(
          pitchTowards(toCentre),
          -MAX_PITCH,
          MAX_PITCH,
        );
        camera.rotation.set(pitch.current, yaw.current, 0, "YXZ");
        return;
      }

      setFieldOfView(undefined);

      // Never less than a quarter turn: below that the two shots still share
      // too much of the frame and the melt reads as a glitch on one image
      // rather than as two images fighting.
      const angle =
        (Math.random() < 0.5 ? -1 : 1) *
        THREE.MathUtils.degToRad(75 + Math.random() * 95);

      offset.subVectors(camera.position, centralPoint);

      const distance = Math.hypot(offset.x, offset.z);
      // Straight above the centre there is no horizontal direction to rotate;
      // any axis will do, and this one keeps the maths below unbranched.
      if (distance < 1e-3) {
        offset.set(0, offset.y, 1);
      }

      const radius = THREE.MathUtils.clamp(
        Math.max(distance, 1) * (0.75 + Math.random() * 0.7),
        1.3,
        2.8,
      );
      const height = THREE.MathUtils.clamp(
        centralPoint.y + offset.y + (Math.random() - 0.5) * 1.2,
        1,
        2.4,
      );

      // The look-around the camera is currently holding, measured against the
      // view it would have if it framed the centre from where it stands. Only
      // the offset is carried across the jump: the framing itself is rebuilt
      // from the new position, which is what stops the cut from being undone.
      toCentre.subVectors(centralPoint, camera.position).normalize();
      const heldYaw = shortestAngle(yawTowards(toCentre), yaw.current);
      const heldPitch = pitch.current - pitchTowards(toCentre);

      offset.y = 0;
      offset.normalize().applyAxisAngle(up, angle).multiplyScalar(radius);

      camera.position.set(
        centralPoint.x + offset.x,
        height,
        centralPoint.z + offset.z,
      );

      // Orientation is applied in the same breath as the position. A camera
      // left to swing round and find the centre over the following frames would
      // hand the effect the motion of that swing instead of the motion of the
      // new shot - and the swing is exactly what the cut exists to avoid.
      toCentre.subVectors(centralPoint, camera.position).normalize();
      yaw.current = yawTowards(toCentre) + heldYaw;
      pitch.current = THREE.MathUtils.clamp(
        pitchTowards(toCentre) + heldPitch,
        -MAX_PITCH,
        MAX_PITCH,
      );
      camera.rotation.set(pitch.current, yaw.current, 0, "YXZ");
    });
  }, [camera, centralPoint, scratch]);

  useFrame((state, delta) => {
    if (camera) {
      // A suspended tab must not turn its first resumed frame into a teleport.
      const frameDelta = Math.min(delta, MAX_FRAME_DELTA);
      const currentTime = Date.now();
      const timeSinceInit = currentTime - initializationTime.current;

      // Don't start automatic behavior immediately - wait 2 seconds after initialization
      if (timeSinceInit < 2000) {
        return;
      }

      /** Walks the camera on the horizontal plane it is currently facing. */
      const walk = () => {
        const { forward, right } = scratch;

        camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();

        right.crossVectors(camera.up, forward).normalize();

        if (movement.current.forward) {
          camera.position.addScaledVector(forward, MOVE_SPEED * frameDelta);
        }
        if (movement.current.backward) {
          camera.position.addScaledVector(forward, -MOVE_SPEED * frameDelta);
        }
        if (movement.current.left) {
          camera.position.addScaledVector(right, (MOVE_SPEED * frameDelta) / 2);
        }
        if (movement.current.right) {
          camera.position.addScaledVector(right, (-MOVE_SPEED * frameDelta) / 2);
        }
      };

      // A limbo shot does not use the framing logic below, which eases the aim
      // back towards the centre of the *room*: there it would quietly undo the
      // pose the cut set, and would do it as a slow drift - the one kind of
      // camera motion this effect cannot afford to have running for free.
      //
      // Instead the shot keeps its own subject centred. Walking is free to move
      // the camera anywhere, because it only happens while a key is held and so
      // cannot drift, and the aim is then rebuilt from wherever it ended up.
      // Without that, stepping sideways slid the whole line out of frame and
      // left the lens pointing at empty backdrop.
      const current = activeShot.current;

      if (current !== "room") {
        walk();

        const { toCentre } = scratch;
        toCentre.set(...SHOT_CAMERA[current].target).sub(camera.position);

        // Standing exactly on the subject has no direction to look along.
        if (toCentre.lengthSq() > 1e-6) {
          toCentre.normalize();
          yaw.current = yawTowards(toCentre);
          pitch.current = THREE.MathUtils.clamp(
            pitchTowards(toCentre),
            -MAX_PITCH,
            MAX_PITCH,
          );
          camera.rotation.set(pitch.current, yaw.current, 0, "YXZ");
        }

        return;
      }

      if (currentTime - lastMouseMoveTime.current > mouseIdleTimeout) {
        isMouseMoving.current = false;
      }

      const minRotationX = THREE.MathUtils.degToRad(-50);
      const maxRotationX = THREE.MathUtils.degToRad(50);
      const minRotationY = THREE.MathUtils.degToRad(-45);
      const maxRotationY = THREE.MathUtils.degToRad(45);

      const { forward, toCentre } = scratch;

      // Adopt whatever the initialisation effect's lookAt produced, rather than
      // snapping away from it on the first frame past the settling delay.
      if (!orientationReady.current) {
        camera.getWorldDirection(forward);
        yaw.current = yawTowards(forward);
        pitch.current = pitchTowards(forward);
        orientationReady.current = true;
      }

      // Framing the centre of the room is the resting pose, and every target
      // below is an offset from it. Deriving it from the geometry each frame is
      // what replaces the old slerp - and what makes a cut stick, since after
      // the jump it simply resolves to the view from the new position.
      toCentre.subVectors(centralPoint, camera.position).normalize();
      const baseYaw = yawTowards(toCentre);
      const basePitch = pitchTowards(toCentre);

      let yawOffset: number;
      let pitchOffset: number;
      let idle = false;

      if (
        autoRotate &&
        !isMouseMoving.current &&
        !isTouchMoving.current
      ) {
        const time = state.clock.elapsedTime;
        const noiseX = Math.sin(time * 0.7) * 0.5 + Math.sin(time * 1.3) * 0.5;
        const noiseY = Math.sin(time * 0.5) * 0.5 + Math.cos(time * 1.1) * 0.5;

        pitchOffset = THREE.MathUtils.lerp(
          minRotationX,
          maxRotationX,
          (noiseX + 1) * 0.5,
        );
        yawOffset = THREE.MathUtils.lerp(
          minRotationY,
          maxRotationY,
          (noiseY + 1) * 0.5,
        );
      } else if (isMouseMoving.current || isTouchMoving.current) {
        const position = isTouchMoving.current
          ? touchPosition.current
          : mousePosition.current;
        yawOffset = position.x * 0.5;
        pitchOffset = -position.y * 0.3;
      } else {
        // Nothing is driving the camera: drift back to the resting pose, at the
        // same couple of percent per frame the quaternion easing used to.
        yawOffset = 0;
        pitchOffset = 0;
        idle = true;
      }

      const yawEase = idle ? 0.02 : 0.05;
      const pitchEase = idle
        ? 0.02
        : (isMouseOnScreen.current && isMouseMoving.current) ||
            isTouchMoving.current
          ? 0.05
          : 0.03;
      const adjustedYawEase = deltaAdjustedEase(yawEase, frameDelta);
      const adjustedPitchEase = deltaAdjustedEase(pitchEase, frameDelta);

      yaw.current +=
        shortestAngle(yaw.current, baseYaw + yawOffset) * adjustedYawEase;
      pitch.current +=
        (THREE.MathUtils.clamp(
          basePitch + pitchOffset,
          -MAX_PITCH,
          MAX_PITCH,
        ) -
          pitch.current) *
        adjustedPitchEase;

      camera.rotation.set(pitch.current, yaw.current, 0, "YXZ");

      walk();
    }
  });

  // UI Elements
  return null;
};
