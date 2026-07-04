import "@testing-library/jest-dom/vitest";

// Defensive Web Storage polyfill. jsdom ships localStorage/sessionStorage, but
// some environments (bare Node, --experimental-vm-modules with node env) don't.
// Guarding here means `vitest run` works with a plain command — no NODE_OPTIONS
// / --localstorage-file flags required.
function memStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
}
const g = globalThis as unknown as {
  localStorage?: Storage;
  sessionStorage?: Storage;
};
if (typeof g.localStorage === "undefined") g.localStorage = memStorage();
if (typeof g.sessionStorage === "undefined") g.sessionStorage = memStorage();

// Radix Tooltip uses pointer events / hasPointerCapture which jsdom doesn't ship.
if (!(Element.prototype as unknown as { hasPointerCapture?: unknown }).hasPointerCapture) {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
}
if (!(Element.prototype as unknown as { setPointerCapture?: unknown }).setPointerCapture) {
  (Element.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
}
if (!(Element.prototype as unknown as { releasePointerCapture?: unknown }).releasePointerCapture) {
  (Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture =
    () => {};
}
if (!(Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView) {
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
}
