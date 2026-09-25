export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

function freezeObject(value: object, seen: WeakSet<object>): void {
  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  for (const nested of Object.values(value as Record<string, unknown>)) {
    if (typeof nested === "object" && nested !== null) {
      freezeObject(nested, seen);
    }
  }

  Object.freeze(value);
}

export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (typeof value === "object" && value !== null) {
    freezeObject(value, new WeakSet<object>());
  }

  return value as DeepReadonly<T>;
}
