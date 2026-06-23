# Normalize "Add to Home Screen"

## Problem

The install banner is the only surface and it almost never appears:

- **Chromium (Android / desktop Chrome / Edge):** never fires `beforeinstallprompt` because the app has no service worker. Chrome's install criteria require an SW with a fetch handler. Result: banner hidden.
- **iPadOS Safari:** UA reports as Macintosh, the `iphone|ipad|ipod` check fails, banner hidden.
- **Dismissal is permanent:** one tap of × sets `localStorage["tribe.install.dismissed"]=1` forever with no UI to undo.
- **No manual entry point** in the user menu / Settings, so once dismissed (or on any unsupported browser) the feature is invisible.

## Goal

A single, predictable install surface on every platform:

1. A **persistent "Install app" entry** the user can always find (never disappears unless the app is actually installed).
2. An **opportunistic banner** with sane snoozing (not permanent dismissal) for first-time visitors.
3. **Real Chromium install support** so Android/desktop Chrome shows the native prompt instead of the iOS fallback instructions.

## Plan

### 1. Add a minimal service worker so Chromium qualifies for install

Use `vite-plugin-pwa` with `generateSW`, following the project's PWA skill rules:

- `registerType: "autoUpdate"`, `injectRegister: null`, `devOptions.enabled: false`.
- Navigation strategy `NetworkFirst` (no offline behavior promised — this exists solely to satisfy install criteria).
- Single guarded registration wrapper that refuses to register in dev, in iframes, on Lovable preview hosts (`id-preview--*`, `preview--*`, `*.lovableproject.com`, `*.lovableproject-dev.com`, `beta.lovable.dev`), and when `?sw=off` is set; in those cases it also unregisters any matching `/sw.js`.
- Registration wrapper called once from `RootComponent` in `__root.tsx` inside a `useEffect`.
- Keep the existing `manifest.webmanifest` (plugin's manifest generation disabled, or aligned with the current file).

This is the minimum change that unlocks `beforeinstallprompt` on Chromium without introducing offline behavior.

### 2. Rework `install-app-banner.tsx` into a small install module

Split responsibilities:

- **`useInstallPrompt()` hook** — owns: captured `BeforeInstallPromptEvent`, installed state (`display-mode: standalone` + iOS `navigator.standalone`), platform detection (Chromium-prompt / iOS-Safari / Android-Firefox / desktop-other), and a `promptInstall()` action. Fix iPadOS detection by also treating `navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1` as iPad.
- **`InstallAppBanner`** — opportunistic banner. Replace permanent dismissal with a **7-day snooze** stored as a timestamp (`tribe.install.snoozed_until`). Banner hides while snoozed, while installed, or when the platform offers no install path at all (e.g. desktop Firefox).
- **`InstallAppButton`** — small reusable button/menu-item that is always actionable: triggers the native prompt on Chromium, opens the iOS Safari instructions modal on iOS, and opens a generic "How to install" modal with per-browser steps elsewhere. Never hidden except when the app is already installed.
- Keep the existing iOS instructions modal; extend it with Android-Chrome and desktop-Chromium variants for the fallback path.

### 3. Add the persistent entry point

Add `InstallAppButton` to the Settings page (`src/routes/_authenticated/settings.tsx`) as a row in the existing settings list, labeled "Install app" with a short helper line ("Add Tribe Trips to your home screen"). This is the normalized, always-available trigger the user asked for. The opportunistic banner stays in `__root.tsx` for discoverability.

### 4. Verify

- Android Chrome: banner appears after SW registers; tapping Install fires the native prompt; after install, both surfaces hide.
- iOS Safari (iPhone + iPad): banner appears with iOS instructions; Settings entry always works.
- Desktop Chrome/Edge: banner appears; native prompt fires.
- Desktop Firefox / iOS Chrome: banner hidden; Settings entry opens a "your browser can't install this app — open in Safari/Chrome" modal.
- Lovable preview & dev: SW never registers; banner still renders for layout review.

## Technical notes

- Files touched: `vite.config.ts` (add plugin), `package.json` (`vite-plugin-pwa`), `src/components/install-app-banner.tsx` (rewrite), new `src/lib/install.ts` (hook + registration wrapper), `src/routes/__root.tsx` (call registration), `src/routes/_authenticated/settings.tsx` (add row).
- `manifest.webmanifest` already has correct `display`, `start_url`, `id`, icons (`any` + `maskable`) — no changes needed.
- The PWA skill's kill-switch worker is **not** needed here; there is no prior app SW deployed to evict.
- No offline caching is added; we only need Chromium to see "has SW with fetch handler" to enable install.
