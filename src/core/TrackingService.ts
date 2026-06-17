import { EventEmitter } from "events";

import { SlimeVRBridge, type SlimeVRBridgeOptions } from "./slimevr/SlimeVRBridge.js";
import type { AdapterIssue } from "./triki/adapter.js";
import { type DiscoveredDevice, TrikiManager } from "./triki/TrikiManager.js";

export interface TrackingServiceEvents {
    discover: (device: DiscoveredDevice) => void;
    connected: (info: { id: string; name: string }) => void;
    disconnected: (id: string) => void;
    battery: (info: { id: string; percent: number }) => void;
    scanStart: () => void;
    scanStop: () => void;
    adapterIssue: (issue: AdapterIssue) => void;
    log: (message: string) => void;
    error: (message: string) => void;
    deviceData: (data: {
        id: string;
        hz: number;
        quaternion: { w: number; x: number; y: number; z: number };
        accel: { x: number; y: number; z: number };
    }) => void;
}

export declare interface TrackingService {
    on<E extends keyof TrackingServiceEvents>(event: E, listener: TrackingServiceEvents[E]): this;
    emit<E extends keyof TrackingServiceEvents>(
        event: E,
        ...args: Parameters<TrackingServiceEvents[E]>
    ): boolean;
}

export class TrackingService extends EventEmitter {
    private readonly manager = new TrikiManager();
    private readonly bridge: SlimeVRBridge;

    constructor(bridgeOptions: SlimeVRBridgeOptions = {}) {
        super();
        this.bridge = new SlimeVRBridge(bridgeOptions);

        this.manager.on("discover", (d) => this.emit("discover", d));
        this.manager.on("scanStart", () => this.emit("scanStart"));
        this.manager.on("scanStop", () => this.emit("scanStop"));
        this.manager.on("adapterIssue", (issue) => this.emit("adapterIssue", issue));
        this.manager.on("log", (msg) => this.emit("log", msg));
        this.manager.on("error", (err) => this.emit("error", err.message));

        this.manager.on("deviceConnected", async (device) => {
            try {
                await this.bridge.addTracker(device.id, device.address);
            } catch (err) {
                this.emit("error", `SlimeVR tracker init failed for ${device.name}: ${(err as Error).message}`);
                return;
            }
            let count = 0;
            let windowStart = Date.now();
            let hz = 0;
            device.on("data", ({ quaternion, sample }) => {
                this.bridge.sendData(device.id, quaternion, sample);
                count++;
                const now = Date.now();
                if (now - windowStart >= 500) {
                    hz = Math.round((count * 1000) / (now - windowStart));
                    count = 0;
                    windowStart = now;
                }
                this.emit("deviceData", { id: device.id, hz, quaternion, accel: sample.accel });
            });
            device.on("battery", (percent) => {
                this.bridge.sendBattery(device.id, percent);
                this.emit("battery", { id: device.id, percent });
            });
            this.emit("connected", { id: device.id, name: device.name });
        });

        this.manager.on("deviceDisconnected", async (id) => {
            await this.bridge.removeTracker(id);
            this.emit("disconnected", id);
        });
    }

    startScanning(): Promise<void> {
        return this.manager.startScanning();
    }

    stopScanning(): Promise<void> {
        return this.manager.stopScanning();
    }

    connect(id: string): Promise<void> {
        return this.manager.connect(id);
    }

    disconnect(id: string): Promise<void> {
        return this.manager.disconnect(id);
    }

    async shutdown(): Promise<void> {
        await this.manager.stopScanning().catch(() => {});
        await this.manager.disconnectAll();
        await this.bridge.removeAll();
    }
}
