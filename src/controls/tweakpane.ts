/**
 * Minimal STRUCTURAL typings for the slice of the Tweakpane v4 API this adapter
 * uses, plus the single cast needed to obtain them.
 *
 * Why not use the library's own types? The published `tweakpane` package
 * re-exports almost all of its public types (`FolderApi`, `BindingApi`,
 * `TpChangeEvent`, `RootApi`, ...) from `@tweakpane/core`, which it lists only
 * as a dev dependency. In a consumer install that package is absent, so those
 * re-exports resolve to nothing and even the `Pane` class loses every inherited
 * member: `new Pane().addFolder(...)` is a *type* error, although it works
 * perfectly at runtime (the core is bundled inside `dist/tweakpane.js`).
 *
 * Rather than pull in an extra dependency, we declare the handful of members we
 * actually call - the same approach the Driftpane demo takes. The interfaces
 * below are intentionally a subset: adding a new Tweakpane feature means adding
 * its signature here first.
 *
 * `TpPane` is structurally compatible with Driftpane's `PaneLike`, so it can be
 * handed to `createDriftpane()` without further casts.
 */

import { Pane } from 'tweakpane';

/** Payload of a Tweakpane `change` event. The value is validated by the caller. */
export interface TpChangeEvent {
  readonly value: unknown;
  /** `true` on the last event of a gesture (e.g. slider release). */
  readonly last: boolean;
}

/** Options accepted by `addBinding` for the input kinds we support. */
export interface TpBindingParams {
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Presence of `options` turns the binding into a list (select). */
  options?: Readonly<Record<string, unknown>>;
}

export interface TpBinding {
  on(eventName: 'change', handler: (ev: TpChangeEvent) => void): unknown;
  refresh(): void;
  dispose(): void;
}

export interface TpFolder {
  readonly element: HTMLElement;
  expanded: boolean;
  addBinding(
    target: Record<string, unknown>,
    key: string,
    params?: TpBindingParams,
  ): TpBinding;
  addFolder(params: { title: string; expanded?: boolean }): TpFolder;
  dispose(): void;
}

/** Root pane. Superset of a folder, plus the state API Driftpane relies on. */
export interface TpPane extends TpFolder {
  exportState(): Record<string, unknown>;
  importState(state: Record<string, unknown>): boolean;
  on(eventName: 'change' | 'fold', handler: (ev: unknown) => void): unknown;
  addBlade(params: Record<string, unknown>): unknown;
  refresh(): void;
}

/**
 * Creates a Tweakpane root inside `container`. This is the ONLY place where the
 * degraded `Pane` type is cast onto our structural view of the API.
 */
export function createTweakpane(config: {
  title: string;
  container: HTMLElement;
}): TpPane {
  return new Pane(config) as unknown as TpPane;
}
