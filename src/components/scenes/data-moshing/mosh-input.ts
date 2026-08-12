import { useSyncExternalStore } from "react";

/**
 * Shared input state for the data mosh effect.
 *
 * Replaces the previous approach of synthesising fake KeyboardEvents to make
 * mouse/touch input reach the post-processing component: every input source
 * (spacebar, pointer, touch) now writes to this single store, and consumers
 * subscribe to it.
 *
 * The state is **reference counted per source**. A single boolean was not
 * enough: with three independent sources sharing one flag, a `mouseup` would
 * end a gesture that the spacebar was still holding (and the other way round),
 * so a stray click while a key was down silently cut the gesture short. Each
 * source now holds its own token and the gesture ends when the last one is
 * handed back.
 */
export type MoshInputSource = "keyboard" | "pointer" | "touch";

/**
 * The latch is a source too, but not one of the above, because it is the one
 * that must survive `releaseAll`.
 *
 * Everything in `MoshInputSource` is a physical hold whose matching release can
 * go missing when the window loses focus, which is what `releaseAll` exists to
 * recover from. A latch is a stated intention: the user ticked a box, nothing
 * about switching tabs revokes it, and dropping it there would leave the box
 * ticked with the effect off.
 */
let latched = false;

export interface MoshInputState {
  /** True while at least one input source is holding the mosh trigger down. */
  readonly pressed: boolean;
  /** performance.now() of the last release, or -1 while pressed / before the first release. */
  readonly lastReleaseTime: number;
}

const held = new Set<MoshInputSource>();

let snapshot: MoshInputState = { pressed: false, lastReleaseTime: -1 };

const listeners = new Set<() => void>();

const sync = () => {
  const pressed = latched || held.size > 0;
  if (pressed === snapshot.pressed) return;

  snapshot = {
    pressed,
    // Only the transition to "nobody is holding it" starts the recovery clock.
    lastReleaseTime: pressed ? -1 : performance.now(),
  };
  for (const listener of listeners) listener();
};

export const moshInput = {
  press(source: MoshInputSource): void {
    held.add(source);
    sync();
  },

  release(source: MoshInputSource): void {
    held.delete(source);
    sync();
  },

  /**
   * Drops every source at once. Used when the window loses focus or the tab is
   * hidden: the keyup / pointerup of a held input is never delivered in that
   * case, which would otherwise leave the trigger stuck down forever.
   */
  releaseAll(): void {
    if (held.size === 0) return;
    held.clear();
    sync();
  },

  /**
   * Holds the trigger down until it is told otherwise.
   *
   * Deliberately not one of the reference-counted sources: a held key ends when
   * the key comes up or the window loses focus, whereas this ends only when it
   * is switched off. It is also *or*-ed with them rather than replacing them, so
   * letting go of the spacebar while the latch is on does not end the gesture -
   * and the gesture the latch starts is a real one, keyframe capture and scene
   * cut included, because everything downstream reads the same `pressed` flag.
   */
  setLatched(value: boolean): void {
    if (latched === value) return;
    latched = value;
    sync();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getSnapshot(): MoshInputState {
    return snapshot;
  },
};

const serverSnapshot: MoshInputState = { pressed: false, lastReleaseTime: -1 };

/** Subscribe a React component to the shared mosh input state. */
export const useMoshInput = (): MoshInputState =>
  useSyncExternalStore(
    moshInput.subscribe,
    moshInput.getSnapshot,
    () => serverSnapshot,
  );
