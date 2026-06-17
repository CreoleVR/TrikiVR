# TrikiVR

Middleware that turns cheap **Żabka Triki** BLE gadgets into **SlimeVR
full-body trackers**.

It connects to one or more Triki devices over Bluetooth LE, decodes their IMU
stream, runs sensor fusion, and feeds the resulting orientation into the SlimeVR
Server by emulating tracker firmware over UDP (`:6969`).

## How it works

```
noble scan ──"Triki"──▶ TrikiDevice (one per device)
   subscribe NUS TX notify ─▶ decode (14-byte frame → gyro °/s + accel g)
   ─▶ VQF fusion (6-axis, per device) → quaternion
   ─▶ SlimeVRBridge: one EmulatedTracker per device
                                         │ UDP :6969 (handshake + rotation/accel)
                                         ▼
                                  SlimeVR Server
```

Built on the official SlimeVR packages
(`@slimevr/tracker-emulation`, `@slimevr/firmware-protocol`, `@slimevr/common`).
The Triki BLE protocol is ported from
[TrikiReader](https://github.com/AND-Y0/TrikiReader); orientation fusion is a
TypeScript port of [VQF](https://github.com/dlaidig/vqf) (`BasicVQF`).

### The hardware

- nRF52810 + ST LSM6DSL **6-axis IMU (no magnetometer)**.
- Nordic UART Service `6e400001-…`; IMU notifications arrive on TX `6e400003-…`.
- 14-byte frames: header `22 00`, then 6× int16 LE — gyro xyz ÷ 14.2857 (°/s),
  accel xyz ÷ 2048.0 (g).
- The IMU stream is started by writing `201000D007680003` to the RX
  characteristic.

Because there is no magnetometer, **yaw drifts** over time. This is normal for
6-DoF trackers — use SlimeVR's *Reset* / *Mounting reset* to re-align.

## Project layout

```
src/
  main.ts                     Electron main: window, IPC, owns TrackingService
  preload.mts                 contextBridge → window.trikivr
  core/
    TrackingService.ts        wires TrikiManager ↔ SlimeVRBridge
    triki/
      constants.ts            NUS UUIDs, frame layout, scales, start command
      decode.ts               frame reassembly + decode (unit-tested)
      vqf.ts                  BasicVQF port (MIT, dlaidig/vqf)
      fusion.ts               6-axis VQF orientation filter
      TrikiDevice.ts          one BLE peripheral: connect, subscribe, fuse
      TrikiManager.ts         noble scan + multi-device lifecycle
    slimevr/
      SlimeVRBridge.ts        one EmulatedTracker per device
      mapping.ts              IMU → SlimeVR quaternion axis remap
  static/                     renderer GUI (html/css/js)
```

## Build & run

```bash
npm install
npm run rebuild        # rebuild native BLE bindings against Electron's ABI
npm run setup:linux    # Linux only: grant BLE permission to the Electron binary
npm start              # builds (tsc + copy static) and launches Electron
```

`npm test` runs the decode/parser unit tests.

> **Native bindings:** `@stoprocent/noble` ships prebuilt binaries for Node, but
> Electron uses a different ABI, so `npm run rebuild` (electron-rebuild) is
> required before `npm start`. If your environment defers npm install scripts
> (e.g. an allow-scripts sandbox), approve them for `@stoprocent/noble`,
> `@stoprocent/bluetooth-hci-socket` and `electron` first.

### Bluetooth permissions

The app detects when it can't use Bluetooth and shows a **banner in the GUI**
with a platform-specific fix (the adapter check lives in
`src/core/triki/adapter.ts`):

- **Linux** — opening a raw HCI socket needs `CAP_NET_RAW` + `CAP_NET_ADMIN`.
  Run `npm run setup:linux` once (re-run after any `npm install`, which replaces
  the Electron binary). It grants the capability to the local Electron binary
  and registers Electron's bundled libs with the loader cache (required because
  file capabilities trigger glibc secure-execution mode). Undo with
  `scripts/teardown-linux-ble.sh`. Alternatively, run the app as root.
- **macOS** — grant Bluetooth access in System Settings → Privacy & Security →
  Bluetooth (the app reports `unauthorized` until you do).
- **Windows** — works out of the box; just ensure Bluetooth is on.

## Using it

1. Start the **SlimeVR Server**.
2. Launch TrikiVR, press the button on each Triki to wake it, then click
   **Start scanning**.
3. Click **Connect** on each discovered Triki — each appears as a separate
   tracker in SlimeVR.
4. Assign body parts and run SlimeVR's reset flow as usual.

If pitch/roll/yaw come out swapped or inverted, adjust the `AxisMap` in
`src/core/slimevr/mapping.ts` — the single place that maps the IMU frame to
SlimeVR's convention.

## License

MIT. Includes a TypeScript port of [VQF](https://github.com/dlaidig/vqf) by
Daniel Laidig (MIT).
