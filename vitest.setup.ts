import "@testing-library/jest-dom/vitest";

// Radix Tooltip uses pointer events / hasPointerCapture which jsdom doesn't ship.
if (!(Element.prototype as unknown as { hasPointerCapture?: unknown }).hasPointerCapture) {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false;
}
if (!(Element.prototype as unknown as { setPointerCapture?: unknown }).setPointerCapture) {
  (Element.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
}
if (!(Element.prototype as unknown as { releasePointerCapture?: unknown }).releasePointerCapture) {
  (Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {};
}
if (!(Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView) {
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
}
