# TODO

State of the v1 spec (issue #1). Everything below the "Done" list needs a human, hardware or both.

## Done (covered by seam tests against the fake OBS)

- #2 Stop, #3 release workflow, #4 password protection, #5 reconnect and Disconnected state,
#6 camera targeting, #7 version and feature gating, #8 Home and Preset keys
- #10 Move key, #11 motion safety, #12 Zoom key (built on **provisional** assumptions, see below)

## Not started

- #13 Zoom Dial, #14 Dial press action: need the dial payloads from #9 first
- #15 README completion, first tagged release, Community Store submission
- Placeholder icons in `com.ulanzi.obsptz.ulanziPlugin/resources/`: `move-{n,ne,e,se,s,sw,w,nw}.svg`,
`zoom-{in,out}.svg` (chosen at runtime per key) and the per-action icons. Replace in place, same names.
- The logged OBS errors are sometimes empty ("Could not connect to OBS at localhost:4455: "):
fall back to the error code or name.

## Assumptions to confirm on the real hardware (#9 and the #10 to #12 work)

Each of these is a guess that is easy to change; the file to change is named.

- [ ] **Pan/tilt/zoom signs.** Assumed from the OBS-PTZ API doc ("a positive speed increases the

  position"): +pan = right, +tilt = up, +zoom = in. Press each of the 8 Move directions and both
  Zoom keys on a real camera. If any are reversed (camera mounted upside down, `pan_invert`,
  `tilt_invert` settings in OBS-PTZ), fix `PAN_TILT` / `ZOOM_DIRECTIONS` in `src/plugin/motion.js`.
- [ ] **Does the camera stop on key up?** Move stops by sending `ptz_move` with the held axes at 0

  (not `ptz_stop`, so releasing one key never halts another key's axis). If a camera ignores a
  zero speed, switch release to `ptz_stop` in `sendStop` in `src/plugin/service.js`
  (it already falls back to `ptz_stop` if the zero-speed request errors).
- [ ] **Diagonal speed.** A diagonal sends the full speed on both axes (not normalised). Check it feels right.
- [ ] **Which events Studio sends for a Move/Zoom key:** `keydown` then `keyup`? Does a long press

  send anything extra (`run`, hold events) that the plugin should ignore? Record the raw events (`OBSPTZ_DEBUG=1`).
- [ ] **Does `run` also fire after a hold** (for Stop, Home, Preset)? If so a held Preset key may recall twice.
- [ ] **`setactive` payload.** The simulator sends `{ active: true|false }`; the plugin stops a held

  key on `active === false`. Confirm real Studio uses the same field, by switching pages while holding a key.
- [ ] **Removing a held key** (delete it from the deck while holding): confirm `clear` arrives and the camera stops.
- [ ] **Quit Studio while a key is held.** Does the plugin process get a signal (the plugin handles

  SIGINT/SIGTERM/SIGHUP) or is it killed outright? Does the websocket `close` arrive first?
  If neither, the 10 s watchdog is the only protection; consider whether to shorten the default.
- [ ] **Network drop / OBS quit while a key is held.** The stop cannot reach OBS, so it is sent as soon as

  OBS is back. Check whether OBS-PTZ itself stops a camera when the websocket client goes away,
  and how long a camera keeps running without a new command (the real runaway risk).
- [ ] **Stop latency.** A release waits for the move's reply before the stop is sent (so the stop can

  never overtake the move). Check there is no noticeable lag; if OBS is slow to answer this
  could delay a stop by up to the 5 s request timeout.
- [ ] **Direction icons.** Move/Zoom keys set their image at runtime with `setPathIcon("./resources/...svg")`.

  Check Studio accepts that path form and SVG; fall back to `setBaseDataIcon` if not.
- [ ] **Inspector** loads in Studio, shows Direction/Speed/Stop-after for Move and Zoom only, applies

  defaults (north / in, 0.5, 10 s) to a new key, and saves.
- [ ] Two Move keys held at once (e.g. East + North): both axes move; releasing one leaves the other going.
- [ ] Watchdog: hold a key with Studio's key-up suppressed (or use the simulator's "button down" without "up")

  and confirm the camera stops after the configured seconds.

## Spike items from #9 (still needed from real Studio and the D200X)

- [ ] Raw logged events for a press, a hold, a dial turn and a hold-rotate (needed for #13)
- [ ] Ulanzi Studio plugin folder location on macOS and Windows
- [ ] Any finding that contradicts the click/hold split

## Other manual checks

- [ ] Windows: `npm run dev` symlinks need Developer Mode or admin; confirm or switch to a junction
- [ ] macOS and Windows: Studio launches `plugin/app.js` with its bundled Node (20.x)

## Loading the plugin into Ulanzi Studio

- Where it goes: I don't know Studio's plugin folder. The SDK docs don't say, Studio isn't installed here, and finding it is one of the #9 items, so I won't guess.
- Finding it: on the hardware machine, install any plugin from the Store, then search for its folder. On macOS use find \~/Library -name "\*.ulanziPlugin" -maxdepth 6. On Windows use dir /s /b %APPDATA%\\\*.ulanziPlugin. Its parent folder is the plugins folder.
- Linking: run ULANZI\_PLUGINS\_DIR=&lt;that folder&gt; npm run dev (Windows: set the variable first), then restart Studio. Windows symlinks need Developer Mode or admin rights; if that fails I can switch the script to a junction.
- Fallback: if the symlink isn't picked up, copy the com.ulanzi.obsptz.ulanziPlugin folder in after npm run build. npm run package makes a release zip, but I don't know whether Studio can import one outside the Store. Check for an import option and tell me.