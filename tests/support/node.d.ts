// Minimal ambient declarations so tests can use Node's fs without adding
// @types/node to the build. Vitest runs tests in Node, so the real modules
// exist at runtime; only the types were missing.
declare module 'node:fs' {
  export function writeFileSync(path: string, data: string): void;
}
declare module 'node:path' {
  export function resolve(...segments: string[]): string;
}
declare const __dirname: string;
