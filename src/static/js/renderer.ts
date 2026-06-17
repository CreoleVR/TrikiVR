import { VisualOrientation, type Q as Quat } from "./visual.js";

interface DiscoveredDevice {
    id: string;
    name: string;
    address: string;
    rssi: number;
}

interface DeviceData {
    id: string;
    hz: number;
    quaternion: Quat;
    accel: { x: number; y: number; z: number };
}

interface TrikiVRApi {
    startScanning(): Promise<void>;
    stopScanning(): Promise<void>;
    connect(id: string): Promise<void>;
    disconnect(id: string): Promise<void>;
    onDiscover(cb: (d: DiscoveredDevice) => void): void;
    onConnected(cb: (info: { id: string; name: string }) => void): void;
    onDisconnected(cb: (id: string) => void): void;
    onBattery(cb: (info: { id: string; percent: number }) => void): void;
    onScanStart(cb: () => void): void;
    onScanStop(cb: () => void): void;
    onLog(cb: (message: string) => void): void;
    onAdapterIssue(cb: (issue: { state: string; platform: string; message: string }) => void): void;
    onError(cb: (message: string) => void): void;
    onDeviceData(cb: (data: DeviceData) => void): void;
}

declare global {
    interface Window {
        trikivr: TrikiVRApi;
    }
}

const api = window.trikivr;

const scanToggle = document.getElementById("scan-toggle") as HTMLButtonElement;
const statusElEarly = document.getElementById("status");

if (!api) {
    if (statusElEarly) statusElEarly.textContent = "Error: IPC bridge (window.trikivr) not loaded";
    const b = document.getElementById("adapter-banner");
    const bm = document.getElementById("adapter-message");
    if (b && bm) {
        bm.textContent =
            "Internal error: the preload bridge didn't load, so the UI can't talk to Bluetooth. This is a build/config bug, not a permissions issue.";
        b.classList.remove("hidden");
    }
    throw new Error("window.trikivr is undefined — preload script did not load");
}

const statusEl = document.getElementById("status") as HTMLElement;
const deviceList = document.getElementById("device-list") as HTMLUListElement;
const logEl = document.getElementById("log") as HTMLPreElement;
const banner = document.getElementById("adapter-banner") as HTMLElement;
const bannerMessage = document.getElementById("adapter-message") as HTMLElement;

function showBanner(message: string): void {
    bannerMessage.textContent = message;
    banner.classList.remove("hidden");
}

function hideBanner(): void {
    banner.classList.add("hidden");
}

interface DeviceState extends DiscoveredDevice {
    connected: boolean;
    battery?: number;
    hz?: number;
    quaternion?: Quat;
    displayQuat?: Quat;
    accel?: { x: number; y: number; z: number };
    lastTextPaint?: number;
}

interface DeviceCard {
    li: HTMLLIElement;
    sub: HTMLElement;
    data: HTMLElement;
    cube: HTMLElement;
    badge: HTMLElement;
    button: HTMLButtonElement;
}

const devices = new Map<string, DeviceState>();
const cards = new Map<string, DeviceCard>();
const visuals = new Map<string, VisualOrientation>();
let scanning = false;

const TEXT_PAINT_INTERVAL_MS = 150;

function log(message: string): void {
    const time = new Date().toLocaleTimeString();
    logEl.textContent = `[${time}] ${message}\n${logEl.textContent}`;
}

function toEulerDeg(q: Quat): { roll: number; pitch: number; yaw: number } {
    const sinr = 2 * (q.w * q.x + q.y * q.z);
    const cosr = 1 - 2 * (q.x * q.x + q.y * q.y);
    const roll = Math.atan2(sinr, cosr);
    const sinp = 2 * (q.w * q.y - q.z * q.x);
    const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp);
    const siny = 2 * (q.w * q.z + q.x * q.y);
    const cosy = 1 - 2 * (q.y * q.y + q.z * q.z);
    const yaw = Math.atan2(siny, cosy);
    const deg = (r: number) => Math.round((r * 180) / Math.PI);
    return { roll: deg(roll), pitch: deg(pitch), yaw: deg(yaw) };
}

function quatToMatrix3d(q: Quat): string {
    const { w, x, y, z } = q;
    const m11 = 1 - 2 * (y * y + z * z);
    const m12 = 2 * (x * y - w * z);
    const m13 = 2 * (x * z + w * y);
    const m21 = 2 * (x * y + w * z);
    const m22 = 1 - 2 * (x * x + z * z);
    const m23 = 2 * (y * z - w * x);
    const m31 = 2 * (x * z - w * y);
    const m32 = 2 * (y * z + w * x);
    const m33 = 1 - 2 * (x * x + y * y);
    return `matrix3d(${m11},${m21},${m31},0,${m12},${m22},${m32},0,${m13},${m23},${m33},0,0,0,0,1)`;
}

function batteryIcon(percent: number): string {
    const color = percent <= 15 ? "#ff6b6b" : percent <= 40 ? "#ffb020" : "var(--ok)";
    const fill = Math.max(0, Math.min(100, percent));
    return `<span class="batt" title="${fill}%"><span class="batt-body"><span class="batt-fill" style="width:${fill}%;background:${color}"></span></span><span class="batt-cap"></span></span><span class="batt-pct">${fill}%</span>`;
}

const CUBE_FACES = ["front", "back", "right", "left", "top", "bottom"];

function createCard(device: DeviceState): DeviceCard {
    const li = document.createElement("li");
    li.className = "device";
    li.id = `dev-${device.id}`;

    const cube = document.createElement("div");
    cube.className = "cube";
    cube.innerHTML = CUBE_FACES.map((f) => `<div class="face ${f}">${f[0].toUpperCase()}</div>`).join("");
    const scene = document.createElement("div");
    scene.className = "cube-scene";
    scene.appendChild(cube);

    const meta = document.createElement("div");
    meta.className = "meta";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = device.name;
    const sub = document.createElement("span");
    sub.className = "sub";
    const data = document.createElement("div");
    data.className = "data";
    meta.append(name, sub, data);

    const right = document.createElement("div");
    right.className = "right";
    const badge = document.createElement("span");
    badge.className = "badge";
    const button = document.createElement("button");
    button.addEventListener("click", () => {
        if (devices.get(device.id)?.connected) void api.disconnect(device.id);
        else void api.connect(device.id);
    });
    right.append(badge, button);

    li.append(scene, meta, right);
    deviceList.appendChild(li);

    return { li, sub, data, cube, badge, button };
}

function renderList(): void {
    const empty = deviceList.querySelector(".empty");
    if (devices.size === 0) {
        cards.clear();
        deviceList.innerHTML =
            '<li class="empty">No Triki devices found yet. Press the button on a Triki and start scanning.</li>';
        return;
    }
    if (empty) deviceList.innerHTML = "";

    for (const device of devices.values()) {
        let card = cards.get(device.id);
        if (!card) {
            card = createCard(device);
            cards.set(device.id, card);
        }
        card.li.classList.toggle("is-connected", device.connected);
        card.badge.textContent = device.connected ? "connected" : "found";
        card.badge.classList.toggle("connected", device.connected);
        card.button.textContent = device.connected ? "Disconnect" : "Connect";
        paintText(device, card, true);
    }

    for (const [id, card] of cards) {
        if (!devices.has(id)) {
            card.li.remove();
            cards.delete(id);
        }
    }
}

function paintText(device: DeviceState, card: DeviceCard, force = false): void {
    const now = performance.now();
    if (!force && device.lastTextPaint && now - device.lastTextPaint < TEXT_PAINT_INTERVAL_MS) return;
    device.lastTextPaint = now;

    const battery = device.battery !== undefined ? ` · ${batteryIcon(device.battery)}` : "";
    card.sub.innerHTML = `${device.address} · ${device.rssi} dBm${battery}`;

    const displayQuat = device.displayQuat ?? device.quaternion;
    if (device.connected && displayQuat) {
        const e = toEulerDeg(displayQuat);
        const a = device.accel;
        const accel = a ? `  accel [${a.x.toFixed(2)}, ${a.y.toFixed(2)}, ${a.z.toFixed(2)}]g` : "";
        card.data.innerHTML = `yaw <b>${e.yaw}°</b> pitch <b>${e.pitch}°</b> roll <b>${e.roll}°</b> · <span class="hz">${device.hz ?? 0} Hz</span>${accel}`;
        card.data.style.display = "";
    } else {
        card.data.style.display = "none";
    }
}

function animate(): void {
    for (const [id, card] of cards) {
        const device = devices.get(id);
        if (!device?.connected || !device.quaternion) continue;
        let vis = visuals.get(id);
        if (!vis) {
            vis = new VisualOrientation({ smoothing: 0.6, deadbandDeg: 0 });
            visuals.set(id, vis);
        }
        const smoothed = vis.update(device.quaternion);
        device.displayQuat = smoothed;
        card.cube.style.transform = quatToMatrix3d(smoothed);
    }
    requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

scanToggle.addEventListener("click", async () => {
    if (scanning) {
        await api.stopScanning();
    } else {
        statusEl.textContent = "Checking Bluetooth…";
        await api.startScanning();
    }
});

api.onLog((message) => log(message));

api.onScanStart(() => {
    scanning = true;
    scanToggle.textContent = "Stop scanning";
    scanToggle.classList.add("scanning");
    statusEl.textContent = "Scanning…";
    hideBanner();
});

api.onAdapterIssue((issue) => {
    scanning = false;
    scanToggle.textContent = "Start scanning";
    scanToggle.classList.remove("scanning");
    statusEl.textContent = `Bluetooth unavailable (${issue.state})`;
    showBanner(issue.message);
    log(`Adapter issue [${issue.state}]: ${issue.message}`);
});

api.onScanStop(() => {
    scanning = false;
    scanToggle.textContent = "Start scanning";
    scanToggle.classList.remove("scanning");
    statusEl.textContent = "Idle";
});

api.onDiscover((d) => {
    if (!devices.has(d.id)) {
        devices.set(d.id, { ...d, connected: false });
        log(`Discovered ${d.name} (${d.address})`);
        renderList();
    }
});

api.onConnected(({ id, name }) => {
    const device = devices.get(id);
    if (device) device.connected = true;
    log(`Connected ${name} → SlimeVR tracker created`);
    renderList();
});

api.onDisconnected((id) => {
    const device = devices.get(id);
    if (device) {
        device.connected = false;
        device.quaternion = undefined;
        device.displayQuat = undefined;
    }
    visuals.delete(id);
    log(`Disconnected ${device?.name ?? id}`);
    renderList();
});

api.onBattery(({ id, percent }) => {
    const device = devices.get(id);
    const card = cards.get(id);
    if (device) device.battery = percent;
    if (device && card) paintText(device, card, true);
});

api.onDeviceData(({ id, hz, quaternion, accel }) => {
    const device = devices.get(id);
    const card = cards.get(id);
    if (!device || !card) return;
    device.hz = hz;
    device.quaternion = quaternion;
    device.accel = accel;
    paintText(device, card);
});

api.onError((message) => {
    log(`Error: ${message}`);
    statusEl.textContent = "Error";
});

export {};
