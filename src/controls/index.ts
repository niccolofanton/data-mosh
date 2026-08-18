'use client';

/**
 * The demo's control panel: Driftpane (Tweakpane v4 plus localStorage
 * persistence, a draggable panel and presets) behind a React hook.
 *
 *   const { fadeDuration } = useControls('🎞️ Datamosh', {
 *     fadeDuration: { value: 370, min: 1, max: 2000, step: 1, label: 'Recovery (ms)' },
 *   });
 *
 * There is no host element to render: the panel appears as soon as the first
 * hook mounts and disappears with the last one. Two components may pass the
 * same folder title and their controls merge into that one folder; keys must
 * then be unique within it.
 *
 * Everything DOM-related happens inside effects, so the hook is safe during the
 * server render that `output: 'export'` performs at build time: the first
 * render returns the defaults declared in the schema, and the persisted values
 * arrive on the next commit.
 *
 *   index.ts     this hook
 *   pane.ts      registry + Tweakpane/Driftpane lifecycle
 *   schema.ts    schema types, inference, normalisation, coercion
 *   tweakpane.ts structural typings for Tweakpane v4
 *
 * The pane is a pure function of the registry: registrations are collected and
 * flushed on the next macrotask, and the panel is rebuilt only when the
 * resulting structure actually differs. That is what makes StrictMode's double
 * mount, HMR and lazily mounting components (R3F children, Suspense) safe - see
 * the long comment in `pane.ts` for why Driftpane requires it.
 */

import { useEffect, useRef, useState } from 'react';

import { registerControls } from './pane';
import {
  entrySignature,
  normalizeSchema,
  type ControlPrimitive,
  type ControlSchema,
  type ControlValues,
  type FolderOptions,
  type NormalizedEntry,
} from './schema';

export type {
  BooleanControl,
  ControlPrimitive,
  ControlSchema,
  ControlSpec,
  ControlValue,
  ControlValues,
  FolderOptions,
  NumberControl,
  SelectControl,
  StringControl,
} from './schema';

function defaultsOf(
  entries: readonly NormalizedEntry[],
): Record<string, ControlPrimitive> {
  const values: Record<string, ControlPrimitive> = {};
  for (const entry of entries) values[entry.key] = entry.value;
  return values;
}

function shallowEqual(
  a: Record<string, ControlPrimitive>,
  b: Record<string, ControlPrimitive>,
): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.is(a[key], b[key]));
}

/**
 * Registers a folder of controls on the shared pane and returns their current
 * values, typed from the schema. Re-renders the component whenever the user
 * moves one of them.
 *
 * The schema may be an inline literal: re-registration is driven by its
 * structural signature, not by object identity.
 */
export function useControls<S extends ControlSchema>(
  folder: string,
  schema: S,
  options?: FolderOptions,
): ControlValues<S> {
  const entries = normalizeSchema(folder, schema);
  const signature = entries.map(entrySignature).join(' ');
  const collapsed = options?.collapsed ?? false;
  const order = options?.order;

  // Latest-value ref: the effect below only re-runs when the SIGNATURE changes,
  // yet it must always register the freshest entries.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const [values, setValues] = useState<Record<string, ControlPrimitive>>(() =>
    defaultsOf(entries),
  );

  useEffect(() => {
    const apply = (next: Record<string, ControlPrimitive>) => {
      setValues((previous) => (shallowEqual(previous, next) ? previous : next));
    };
    const registration = registerControls({
      folder,
      options: { collapsed, order },
      entries: entriesRef.current,
      notify: apply,
    });
    // Values remembered from an earlier mount (or restored from localStorage)
    // take precedence over the freshly computed defaults.
    apply(registration.values);
    return () => registration.dispose();
  }, [folder, signature, collapsed, order]);

  // The registry is value-typed but key-erased; this is the single point where
  // the schema's inferred shape is put back on.
  return values as unknown as ControlValues<S>;
}
