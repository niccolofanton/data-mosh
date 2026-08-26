/**
 * Which of the two shots the edit is currently on.
 *
 * `scene-cut` says *that* a cut happens; this says *what we cut to*. The split
 * exists because the cut is triggered from inside the pipeline, which has no
 * business knowing there is such a thing as a room or a dancer, while the shot
 * list is pure scene direction.
 *
 * The reason a shot list makes the effect better, and not just prettier: an
 * I-frame removal melt is the motion of shot B applied to the pixels of shot A,
 * so the two shots disagreeing is the whole material the effect works with.
 * Swinging the camera to another corner of the same room is a weak
 * disagreement - same walls, same palette, same lighting. Cutting to a white
 * limbo, then to a black one, is about as far as two consecutive frames of a
 * recording can get from each other: every macroblock the decoder holds is
 * wrong in a different way.
 *
 * Everything a subscriber changes has to be applied immediately, for the reason
 * spelled out in `scene-cut`: the pipeline re-captures the previous-frame
 * transforms the instant the cut returns. Visibility flags and direct writes to
 * `Object3D`, never React state.
 */

import * as THREE from "three";

export type Shot = "room" | "dancer";

/** The rotation, in order. A cut advances by one and wraps back to the room. */
export const SHOTS: readonly Shot[] = ["room", "dancer"];

/**
 * Centre of the room: what the camera orbits, what the subject sits on, and the
 * point the room is scaled about on a cut.
 */
export const SCENE_CENTRE = new THREE.Vector3(0, 1.5, 0);

export type ShotHandler = (current: Shot, previous: Shot) => void;

/**
 * Where the camera stands for the shots that do not use the room's orbit.
 *
 * `fov` is only set where the shot wants a specific one; the others get the
 * camera's own default back.
 *
 * The dancer's shot gets close instead of zooming, and that is a requirement of
 * the effect rather than a preference. A long lens from far away compresses the
 * whole figure into a thin slice of the depth range, so the depth buffer holds
 * almost the same value everywhere on it and there is no parallax to drive: the
 * subject and the emptiness behind it move together. Standing two metres away
 * with a normal lens spreads the body across a real depth interval, and a hand
 * reaching towards the camera then moves across the frame several times faster
 * than the shoulder behind it.
 */
export const SHOT_CAMERA: Record<
  Exclude<Shot, "room">,
  {
    position: readonly [number, number, number];
    target: readonly [number, number, number];
    fov?: number;
  }
> = {
  // Locked off. Every vector in this shot therefore belongs to the
  // choreography, which is what the velocity pass reads out of the skeleton -
  // see the previous-bone-texture half of `velocity-pass`, without which a
  // still camera in front of a dancing rig produces an entirely empty motion
  // field and the cut lands on a picture that does not move.
  dancer: {
    // Far enough back to hold the whole line of seven, close enough that the
    // metre and a half of depth between the lead and the back pair reads as
    // depth rather than as scale.
    position: [0, 0.95, 3.4],
    target: [0, 0.95, 0],
    fov: 55,
  },
};

let index = 0;
const handlers = new Set<ShotHandler>();

export const shot = {
  /** The shot currently on screen. */
  get current(): Shot {
    return SHOTS[index];
  },

  /**
   * Adds a handler and returns the function that removes it again, so a React
   * effect can hand it straight back as its cleanup.
   */
  subscribe(handler: ShotHandler): () => void {
    handlers.add(handler);

    return () => {
      handlers.delete(handler);
    };
  },

  /**
   * Moves to the next shot and tells everyone, synchronously.
   *
   * Called from a single `scene-cut` subscriber (see `ShotStage`) rather than
   * having every interested component subscribe to the cut itself: that way the
   * advance provably happens before any handler reads `shot.current`, instead
   * of depending on the order a Set happens to iterate in.
   */
  advance(): void {
    const previous = SHOTS[index];
    index = (index + 1) % SHOTS.length;
    const current = SHOTS[index];

    // Copied first: a handler is free to unsubscribe itself while running.
    for (const handler of [...handlers]) {
      handler(current, previous);
    }
  },
};
