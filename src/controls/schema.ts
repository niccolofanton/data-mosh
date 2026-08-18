/**
 * Control schema: how a set of controls is declared, and its normalisation into
 * the flat entries the pane binds to Tweakpane.
 *
 *   { fadeDuration: { value: 370, min: 1, max: 2000, step: 1, label: 'Fade (ms)' } }
 *   { enabled: { value: true, label: 'Enabled' } }
 *   { mode: { value: 'melt', options: { Melt: 'melt', Bloom: 'bloom' } } }
 *   { tint: { value: '#ff0044', label: 'Cast' } }   // colour picker
 *
 * Value types are inferred (see `ControlValues`), so consumers never annotate
 * anything by hand.
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
 * renders a colour picker for them.
 */
export interface StringControl {
  value: string;
  label?: string;
}

/** Dropdown. `options` maps the label shown to the value produced. */
export interface SelectControl<T extends ControlPrimitive = ControlPrimitive> {
  value: T;
  options: Readonly<Record<string, T>>;
  label?: string;
}

export type ControlSpec =
  | NumberControl
  | BooleanControl
  | StringControl
  | SelectControl;

export type ControlSchema = Readonly<Record<string, ControlSpec>>;

/** Value produced by a single schema entry. */
export type ControlValue<C> = C extends {
  options: Readonly<Record<string, infer T>>;
}
  ? T
  : C extends { value: infer V }
    ? V
    : never;

/** Values object returned by `useControls`, inferred from the schema. */
export type ControlValues<S extends ControlSchema> = {
  [K in keyof S]: ControlValue<S[K]>;
};

/** Per-folder options. */
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
 * stores, diffs and binds; the public schema is never kept around.
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
    };

function isPrimitive(value: unknown): value is ControlPrimitive {
  return (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  );
}

function normalizeEntry(
  key: string,
  spec: ControlSpec,
  where: string,
): NormalizedEntry {
  const label = spec.label;
  const value = spec.value;

  if ('options' in spec) {
    if (!isPrimitive(value)) {
      throw new Error(`${where}: a select needs a primitive "value".`);
    }
    return { kind: 'select', key, label, value, options: spec.options };
  }
  if (typeof value === 'number') {
    return {
      kind: 'number',
      key,
      label,
      value,
      min: spec.min,
      max: spec.max,
      step: spec.step,
    };
  }
  if (typeof value === 'boolean') return { kind: 'boolean', key, label, value };
  if (typeof value === 'string') return { kind: 'text', key, label, value };

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

/**
 * Structural fingerprint of an entry: everything that, when changed, requires
 * the Tweakpane blade to be rebuilt (label, range, options, default value).
 */
export function entrySignature(entry: NormalizedEntry): string {
  return JSON.stringify(Object.values(entry));
}

/**
 * Narrows a raw value coming from Tweakpane (change event or restored state) to
 * the type the entry declares. Returns `undefined` when it does not fit, so
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
  }
}
