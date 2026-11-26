// Déclarations minimales pour les tests `node:test` (pas de @types/node installé).
declare module 'node:test' {
  type Fn = () => void | Promise<void>;
  export function test(name: string, fn: Fn): void;
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: Fn): void;
}
declare module 'node:assert/strict' {
  const assert: {
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    notDeepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    match(value: string, re: RegExp, message?: string): void;
    throws(fn: () => unknown, expected?: unknown): void;
    doesNotThrow(fn: () => unknown): void;
  };
  export default assert;
}
