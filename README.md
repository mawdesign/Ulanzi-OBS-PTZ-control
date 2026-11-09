# OBS PTZ Control — Ulanzi Deck plugin

Control PTZ cameras from an Ulanzi D200X (and other Ulanzi Deck devices) through
[OBS-PTZ](https://github.com/glikely/obs-ptz), using the obs-websocket `obs-ptz` vendor API.

**Status:** early development. The Stop key and the OBS connection work; more actions are on the way.

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
Set `OBSPTZ_DEBUG=1` in the environment Studio launches the plugin from to log every Studio event at debug level
(secret-bearing events are logged by name only). Use it to confirm real event behaviour
(`run` vs `keydown`/`keyup`, `dialrotate` payloads) on hardware.

## Security note
The OBS password will be stored AES-256-GCM encrypted with a machine-derived key. That is
obfuscation-grade, not strong secrecy: it stops casual reads and copying settings between machines,
not malware running as your user. A keychain backend is planned.

## Licence
MIT. Vendored Ulanzi SDK code is Apache-2.0 (see `src/vendor/ulanzi-api/NOTICE.md`).
