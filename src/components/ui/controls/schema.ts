/**
 * Control schema: the public, leva-shaped description of a set of controls, and
 * its normalisation into the flat entries the pane manager binds to Tweakpane.
 *
 * The public shape is deliberately the subset of leva's schema this project
 * actually uses, so migrating a call site is a rename and nothing else:
 *
 *   { fadeDuration: { value: 370, min: 1, max: 2000, step: 1, label: '...' } }
 *   { enableCorruption: { value: true, label: '...' } }
 *   { preset: { value: 'soft', options: ['soft', 'hard'] } }
 *   { speed: 0.5 }                       // bare value shorthand
 *
 * Value types are inferred from the schema (see `ControlValues`), so consumers
 * never annotate anything by hand.
 */

/** Every value a control can hold. */
export type ControlPrimitive = number | boolean | string;

/** Slider / number input. Without `min`/`max` Tweakpane renders a number field. */
export interface NumberControl {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}

/** Checkbox. */
export interface BooleanControl {
  value: boolean;
  label?: string;
}

/**
 * Text field. Tweakpane auto-detects CSS colour strings (e.g. `'#ff0044'`) and
 * renders a colour picker for them, exactly like leva did.
 */
export interface StringControl {
  value: string;
  label?: string;
}

/** Dropdown. `options` is either a list of values or a label -> value map. */
export interface SelectControl<T extends ControlPrimitive = ControlPrimitive> {
  value: T;
  options: readonly T[] | Readonly<Record<string, T>>;
  label?: string;
}

export type ControlSpec =
  | ControlPrimitive
  | NumberControl
  | BooleanControl
  | StringControl
  | SelectControl;

export type ControlSchema = Readonly<Record<string, ControlSpec>>;

/** Value produced by a single schema entry. */
export type ControlValue<C> = C extends { options: readonly (infer T)[] }
  ? T
  : C extends { options: Readonly<Record<string, infer T>> }
    ? T
    : C extends { value: infer V }
      ? V
      : C extends number
        ? number
        : C extends boolean
          ? boolean
          : C extends string
            ? string
            : never;

/** Values object returned by `useControls`, inferred from the schema. */
export type ControlValues<S extends ControlSchema> = {
  [K in keyof S]: ControlValue<S[K]>;
};

/** Per-folder options, mirroring leva's `folder(schema, { collapsed })`. */
export interface FolderOptions {
  /** Start folded. Defaults to `false`. */
  collapsed?: boolean;
  /**
   * Explicit sort key. Folders with an explicit order come first, ascending;
   * the rest keep the order in which they were first registered.
   */
  order?: number;
}

// --- Normalised form -------------------------------------------------------

/**
 * Flat, fully-resolved description of one control. This is what the pane
 * manager stores, diffs and binds; the public schema is never kept around.
 */
export type NormalizedEntry =
  | {
      readonly kind: 'number';
      readonly key: string;
      readonly label?: string;
      readonly value: number;
      readonly min?: number;
      readonly max?: number;
      readonly step?: number;
    }
  | {
      readonly kind: 'boolean';
      readonly key: string;
      readonly label?: string;
      readonly value: boolean;
    }
  | {
      readonly kind: 'text';
      readonly key: string;
      readonly label?: string;
      readonly value: string;
    }
  | {
      readonly kind: 'select';
      readonly key: string;
      readonly label?: string;
      readonly value: ControlPrimitive;
      readonly options: Readonly<Record<string, ControlPrimitive>>;
    }
  | {
      readonly kind: 'button';
      readonly key: string;
      readonly title: string;
      readonly label?: string;
      /** Kept out of the structural signature: swapping it never rebuilds. */
      readonly onClick: () => void;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is ControlPrimitive {
  return (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  );
}

function toOptionMap(
  options: unknown,
  where: string,
): Readonly<Record<string, ControlPrimitive>> {
  if (Array.isArray(options)) {
    const map: Record<string, ControlPrimitive> = {};
    for (const option of options) {
      if (!isPrimitive(option)) {
        throw new Error(`${where}: option values must be primitives.`);
      }
      map[String(option)] = option;
    }
    return map;
  }
  if (isRecord(options)) {
    const map: Record<string, ControlPrimitive> = {};
    for (const [label, option] of Object.entries(options)) {
      if (!isPrimitive(option)) {
        throw new Error(`${where}: option values must be primitives.`);
      }
      map[label] = option;
    }
    return map;
  }
  throw new Error(`${where}: "options" must be an array or a label -> value map.`);
}

function normalizeEntry(
  key: string,
  spec: ControlSpec,
  where: string,
): NormalizedEntry {
  if (typeof spec === 'number') {
    return { kind: 'number', key, value: spec };
  }
  if (typeof spec === 'boolean') {
    return { kind: 'boolean', key, value: spec };
  }
  if (typeof spec === 'string') {
    return { kind: 'text', key, value: spec };
  }
  if (!isRecord(spec)) {
    throw new Error(`${where}: unsupported control definition.`);
  }

  const label = typeof spec.label === 'string' ? spec.label : undefined;
  const value = spec.value;

  if ('options' in spec) {
    const options = toOptionMap(spec.options, where);
    if (!isPrimitive(value)) {
      throw new Error(`${where}: a select needs a primitive "value".`);
    }
    return { kind: 'select', key, label, value, options };
  }
  if (typeof value === 'number') {
    return {
      kind: 'number',
      key,
      label,
      value,
      min: typeof spec.min === 'number' ? spec.min : undefined,
      max: typeof spec.max === 'number' ? spec.max : undefined,
      step: typeof spec.step === 'number' ? spec.step : undefined,
    };
  }
  if (typeof value === 'boolean') {
    return { kind: 'boolean', key, label, value };
  }
  if (typeof value === 'string') {
    return { kind: 'text', key, label, value };
  }
  throw new Error(`${where}: "value" must be a number, boolean or string.`);
}

/** Turns a public schema into ordered normalised entries. */
export function normalizeSchema(
  folder: string,
  schema: ControlSchema,
): NormalizedEntry[] {
  return Object.entries(schema).map(([key, spec]) =>
    normalizeEntry(key, spec, `controls "${folder}" -> "${key}"`),
  );
}

/** Default value of an entry, or `undefined` for entries that hold none. */
export function defaultValueOf(
  entry: NormalizedEntry,
): ControlPrimitive | undefined {
  return entry.kind === 'button' ? undefined : entry.value;
}

/**
 * Structural fingerprint of an entry: everything that, when changed, requires
 * the Tweakpane blade to be rebuilt (label, range, options, default value).
 * Callbacks are excluded on purpose - they are read through the registry at
 * call time, so a new closure on every render costs nothing.
 */
export function entrySignature(entry: NormalizedEntry): string {
  if (entry.kind === 'button') {
    return JSON.stringify(['button', entry.key, entry.title, entry.label]);
  }
  if (entry.kind === 'select') {
    return JSON.stringify([
      'select',
      entry.key,
      entry.label,
      entry.value,
      entry.options,
    ]);
  }
  if (entry.kind === 'number') {
    return JSON.stringify([
      'number',
      entry.key,
      entry.label,
      entry.value,
      entry.min,
      entry.max,
      entry.step,
    ]);
  }
  return JSON.stringify([entry.kind, entry.key, entry.label, entry.value]);
}

/**
 * Narrows a raw value coming from Tweakpane (change event or restored state)
 * to the type the entry declares. Returns `undefined` when it does not fit, so
 * corrupted persisted state can never leak into React.
 */
export function coerceValue(
  entry: NormalizedEntry,
  raw: unknown,
): ControlPrimitive | undefined {
  switch (entry.kind) {
    case 'number':
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
    case 'boolean':
      return typeof raw === 'boolean' ? raw : undefined;
    case 'text':
      return typeof raw === 'string' ? raw : undefined;
    case 'select':
      return isPrimitive(raw) && Object.values(entry.options).includes(raw)
        ? raw
        : undefined;
    case 'button':
      return undefined;
  }
}
