import { EventEmitter } from "events";
import NobleModule from "@stoprocent/noble";
import type { AdapterState, Noble, Peripheral } from "@stoprocent/noble";

import { adapterIssueMessage, type AdapterIssue } from "./adapter.js";
import { AUTO_CONNECT_RETRY_MS, TRIKI_NAME_MATCH } from "./constants.js";
import { TrikiDevice } from "./TrikiDevice.js";

const noble = NobleModule as unknown as Noble;

export interface DiscoveredDevice {
    id: string;
    name: string;
    address: string;
    rssi: number;
}

export interface TrikiManagerEvents {
    discover: (device: DiscoveredDevice) => void;
    deviceConnected: (device: TrikiDevice) => void;
    deviceDisconnected: (id: string) => void;
    scanStart: () => void;
    scanStop: () => void;
    adapterIssue: (issue: AdapterIssue) => void;
    log: (message: string) => void;
    error: (error: Error) => void;
}

export declare interface TrikiManager {
    on<E extends keyof TrikiManagerEvents>(event: E, listener: TrikiManagerEvents[E]): this;
    emit<E extends keyof TrikiManagerEvents>(event: E, ...args: Parameters<TrikiManagerEvents[E]>): boolean;
}

export class TrikiManager extends EventEmitter {
    autoConnect = true;

    private readonly devices = new Map<string, TrikiDevice>();
    private readonly discovered = new Map<string, Peripheral>();
    private readonly announced = new Set<string>();
    private readonly held = new Set<string>();
    private readonly lastAttempt = new Map<string, number>();
    private scanning = false;

    constructor(private readonly ble: Noble = noble) {
        super();
    }

    getConnectedDevices(): TrikiDevice[] {
        return [...this.devices.values()];
    }

    async startScanning(): Promise<void> {
        if (this.scanning) return;

        const state = await this.waitForPoweredOn();
        if (state !== "poweredOn") {
            this.emit("adapterIssue", {
                state,
                platform: process.platform,
                message: adapterIssueMessage(state, process.platform),
            });
            return;
        }

        this.announced.clear();
        this.ble.on("discover", this.onDiscover);
        try {
            await this.ble.startScanningAsync([], true);
        } catch {
            this.ble.removeListener("discover", this.onDiscover);
            this.emit("adapterIssue", {
                state: this.ble.state,
                platform: process.platform,
                message: adapterIssueMessage(this.ble.state, process.platform),
            });
            return;
        }
        this.scanning = true;
        this.emit("scanStart");
    }

    getAdapterState(): AdapterState {
        return this.ble.state;
    }

    private waitForPoweredOn(timeoutMs = 6000): Promise<AdapterState> {
        if (this.ble.state === "poweredOn") return Promise.resolve("poweredOn");

        return new Promise((resolve) => {
            let settled = false;
            const finish = (state: AdapterState): void => {
                if (settled) return;
                settled = true;
                this.ble.removeListener("stateChange", onState);
                clearTimeout(timer);
                resolve(state);
            };
            const onState = (state: AdapterState): void => {
                if (state !== "unknown" && state !== "resetting") finish(state);
            };
            this.ble.on("stateChange", onState);
            const timer = setTimeout(() => finish(this.ble.state), timeoutMs);
        });
    }

    async stopScanning(): Promise<void> {
        if (!this.scanning) return;
        this.ble.removeListener("discover", this.onDiscover);
        await this.ble.stopScanningAsync();
        this.scanning = false;
        this.emit("scanStop");
    }

    async connect(id: string): Promise<void> {
        this.held.delete(id);
        await this.open(id);
    }

    private async open(id: string): Promise<void> {
        if (this.devices.has(id)) return;
        const peripheral = this.discovered.get(id);
        if (!peripheral) throw new Error(`Unknown device id: ${id}`);

        const device = new TrikiDevice(peripheral);
        let up = false;
        device.once("disconnected", () => {
            if (this.devices.get(id) === device) this.devices.delete(id);
            this.announced.delete(id);
            if (up) this.emit("deviceDisconnected", id);
        });
        device.on("error", (err) => this.emit("error", err));

        this.devices.set(id, device);
        this.lastAttempt.set(id, Date.now());
        try {
            await device.connect();
        } catch (err) {
            if (this.devices.get(id) === device) this.devices.delete(id);
            if (device.isConnected) void device.disconnect().catch(() => {});
            throw err;
        }
        up = true;
        this.emit("deviceConnected", device);
    }

    async disconnect(id: string): Promise<void> {
        this.held.add(id);
        const device = this.devices.get(id);
        if (!device) return;
        await device.disconnect();
        this.devices.delete(id);
    }

    async disconnectAll(): Promise<void> {
        await Promise.allSettled([...this.devices.values()].map((d) => d.disconnect()));
        this.devices.clear();
    }

    private readonly onDiscover = (peripheral: Peripheral): void => {
        const name = peripheral.advertisement?.localName ?? "";
        if (!name.toLowerCase().includes(TRIKI_NAME_MATCH.toLowerCase())) return;

        const id = peripheral.id;
        this.discovered.set(id, peripheral);
        if (!this.announced.has(id)) {
            this.announced.add(id);
            this.emit("discover", { id, name, address: peripheral.address || id, rssi: peripheral.rssi });
        }

        if (!this.autoConnect || this.devices.has(id) || this.held.has(id)) return;
        if (Date.now() - (this.lastAttempt.get(id) ?? 0) < AUTO_CONNECT_RETRY_MS) return;
        this.open(id).catch((err: Error) => this.emit("log", `Connecting ${name} failed (${err.message}), retrying`));
    };
}
