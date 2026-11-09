# OBS PTZ Control — Ulanzi Deck plugin

Control PTZ cameras from an Ulanzi D200X (and other Ulanzi Deck devices) through
[OBS-PTZ](https://github.com/glikely/obs-ptz), using the obs-websocket `obs-ptz` vendor API.

**Status:** scaffold + event-logging spike. No PTZ features yet.

## Requirements
- OBS 28+ (obs-websocket v5) with authentication enabled
- OBS-PTZ with `websocket_access` set to `control` (default); API v0.10+
- Ulanzi Studio

## Develop
```sh
npm install
npm test
npm run build                       # bundles com.ulanzi.obsptz.ulanziPlugin/plugin/app.js
ULANZI_PLUGINS_DIR=/path/to/plugins npm run dev   # symlink the plugin folder into Studio or the SDK simulator
npm run package                     # dist/com.ulanzi.obsptz.ulanziPlugin.zip (release asset shape)
```
The spike (`src/plugin/app.js`) logs every Studio event; use it to confirm real event behaviour
(`run` vs `keydown`/`keyup`, `dialrotate` payloads) before feature work.

## Security note
The OBS password will be stored AES-256-GCM encrypted with a machine-derived key. That is
obfuscation-grade, not strong secrecy: it stops casual reads and copying settings between machines,
not malware running as your user. A keychain backend is planned.

## Licence
MIT. Vendored Ulanzi SDK code is Apache-2.0 (see `src/vendor/ulanzi-api/NOTICE.md`).
