/**
 * Registration point for the scene cut that a melt gesture triggers.
 *
 * The classic I-frame removal melt is not "an image smearing": it is the motion
 * of shot B applied to the pixels of shot A. Without a cut there is only one
 * shot, the motion vectors belong to the very picture they are dragging, and
 * the result is a smear of the scene over itself - recognisably wrong, but not
 * a datamosh.
 *
 * A 3D scene has no edit list to cut on, so the cut has to be *made*. It is a
 * cut in the editing sense, not just a camera move: several parts of the scene
 * subscribe and change at the same instant - the camera swings to another side
 * of the room, the subject becomes a different shape, the room itself changes
 * scale. The more the two shots disagree, the more there is for the motion
 * vectors of the second to drag out of the first.
 *
 * Ownership is split deliberately. The pipeline knows *when* to cut (it is the
 * only place that sees the gesture, the keyframe capture and the velocity state
 * in the right order) but has no business deciding what may change in someone
 * else's scene. The scene knows *what*, and subscribes here. The same
 * indirection as `mosh-input`, in the opposite direction.
 *
 * Everything a subscriber changes must be applied immediately and have its
 * world matrix refreshed before it returns: the pipeline re-captures the
 * previous-frame transforms as soon as the cut is done, and anything still
 * pending at that point would be measured as one enormous movement on the next
 * frame instead of being invisible, which is the whole point of cutting there.
 */
export type SceneCutHandler = () => void;

const handlers = new Set<SceneCutHandler>();

export const sceneCut = {
  /**
   * Adds a handler and returns the function that removes it again, so a React
   * effect can hand it straight back as its cleanup.
   */
  subscribe(handler: SceneCutHandler): () => void {
    handlers.add(handler);

    return () => {
      handlers.delete(handler);
    };
  },

  /**
   * Performs the cut.
   *
   * Returns whether anything was subscribed, because the caller has to
   * re-capture the scene transforms afterwards and only needs to pay for that
   * when something has actually moved.
   */
  run(): boolean {
    if (handlers.size === 0) {
      return false;
    }

    // Copied first: a handler is free to unsubscribe itself (or another one)
    // while the cut is being performed.
    for (const handler of [...handlers]) {
      handler();
    }

    return true;
  },
};
