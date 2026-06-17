import { EventEmitter } from "events";
import NobleModule from "@stoprocent/noble";
import type { AdapterState, Noble, Peripheral } from "@stoprocent/noble";

import { adapterIssueMessage, type AdapterIssue } from "./adapter.js";
import { TRIKI_NAME_MATCH } from "./constants.js";
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
    private readonly devices = new Map<string, TrikiDevice>();
    private readonly discovered = new Map<string, Peripheral>();
    private scanning = false;

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

        noble.on("discover", this.onDiscover);
        try {
            await noble.startScanningAsync([], false);
        } catch {
            noble.removeListener("discover", this.onDiscover);
            this.emit("adapterIssue", {
                state: noble.state,
                platform: process.platform,
                message: adapterIssueMessage(noble.state, process.platform),
            });
            return;
        }
        this.scanning = true;
        this.emit("scanStart");
    }

    getAdapterState(): AdapterState {
        return noble.state;
    }

    private waitForPoweredOn(timeoutMs = 6000): Promise<AdapterState> {
        if (noble.state === "poweredOn") return Promise.resolve("poweredOn");

        return new Promise((resolve) => {
            let settled = false;
            const finish = (state: AdapterState): void => {
                if (settled) return;
                settled = true;
                noble.removeListener("stateChange", onState);
                clearTimeout(timer);
                resolve(state);
            };
            const onState = (state: AdapterState): void => {
                if (state !== "unknown" && state !== "resetting") finish(state);
            };
            noble.on("stateChange", onState);
            const timer = setTimeout(() => finish(noble.state), timeoutMs);
        });
    }

    async stopScanning(): Promise<void> {
        if (!this.scanning) return;
        noble.removeListener("discover", this.onDiscover);
        await noble.stopScanningAsync();
        this.scanning = false;
        this.emit("scanStop");
    }

    async connect(id: string): Promise<void> {
        if (this.devices.has(id)) return;
        const peripheral = this.discovered.get(id);
        if (!peripheral) throw new Error(`Unknown device id: ${id}`);

        const device = new TrikiDevice(peripheral);
        device.once("disconnected", () => {
            this.devices.delete(id);
            this.emit("deviceDisconnected", id);
        });
        device.on("error", (err) => this.emit("error", err));

        this.devices.set(id, device);
        try {
            await device.connect();
            this.emit("deviceConnected", device);
        } catch (err) {
            this.devices.delete(id);
            throw err;
        }
    }

    async disconnect(id: string): Promise<void> {
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

        this.discovered.set(peripheral.id, peripheral);
        this.emit("discover", {
            id: peripheral.id,
            name,
            address: peripheral.address || peripheral.id,
            rssi: peripheral.rssi,
        });
    };
}
