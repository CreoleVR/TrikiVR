import { EventEmitter } from "events";

import { SlimeVRBridge, type SlimeVRBridgeOptions } from "./slimevr/SlimeVRBridge.js";
import type { AdapterIssue } from "./triki/adapter.js";
import { MAX_SAVED_GYRO_BIAS_SIGMA, STORED_GYRO_BIAS_SIGMA } from "./triki/constants.js";
import { GyroBiasStore } from "./triki/GyroBiasStore.js";
import type { TrikiDevice } from "./triki/TrikiDevice.js";
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
    private readonly manager: TrikiManager;
    private readonly bridge: SlimeVRBridge;
    private readonly gyroBiases: GyroBiasStore | null;

    constructor(bridgeOptions: SlimeVRBridgeOptions = {}, gyroBiasFile?: string, manager = new TrikiManager()) {
        super();
        this.manager = manager;
        this.bridge = new SlimeVRBridge(bridgeOptions);
        this.gyroBiases = gyroBiasFile ? new GyroBiasStore(gyroBiasFile) : null;

        this.manager.on("discover", (d) => this.emit("discover", d));
        this.manager.on("scanStart", () => this.emit("scanStart"));
        this.manager.on("scanStop", () => this.emit("scanStop"));
        this.manager.on("adapterIssue", (issue) => this.emit("adapterIssue", issue));
        this.manager.on("log", (msg) => this.emit("log", msg));
        this.manager.on("error", (err) => this.emit("error", err.message));

        this.manager.on("deviceConnected", async (device) => {
            const stored = this.gyroBiases?.get(device.address);
            if (stored) device.setGyroBias(stored, STORED_GYRO_BIAS_SIGMA);
            device.once("disconnected", () => this.saveGyroBias(device));
            // The first reading arrives while the Triki connects, before anyone listens.
            device.on("battery", (percent) => {
                this.bridge.sendBattery(device.id, percent);
                this.emit("battery", { id: device.id, percent });
            });
            if (device.battery !== undefined) this.emit("battery", { id: device.id, percent: device.battery });
            try {
                await this.bridge.addTracker(device.id, device.address);
            } catch (err) {
                this.emit("error", `SlimeVR tracker init failed for ${device.name}: ${(err as Error).message}`);
                return;
            }
            if (device.battery !== undefined) this.bridge.sendBattery(device.id, device.battery);
            let count = 0;
            let windowStart = Date.now();
            let hz = 0;
            device.on("data", ({ quaternion, linearAcceleration, sample }) => {
                this.bridge.sendData(device.id, quaternion, linearAcceleration);
                count++;
                const now = Date.now();
                if (now - windowStart >= 500) {
                    hz = Math.round((count * 1000) / (now - windowStart));
                    count = 0;
                    windowStart = now;
                }
                this.emit("deviceData", { id: device.id, hz, quaternion, accel: sample.accel });
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
        for (const device of this.manager.getConnectedDevices()) this.saveGyroBias(device);
        await this.manager.stopScanning().catch(() => {});
        await this.manager.disconnectAll();
        await this.bridge.removeAll();
    }

    private saveGyroBias(device: TrikiDevice): void {
        const estimate = device.gyroBias;
        if (!this.gyroBiases || !estimate || estimate.sigma > MAX_SAVED_GYRO_BIAS_SIGMA) return;
        try {
            this.gyroBiases.set(device.address, estimate.bias);
        } catch (err) {
            this.emit("error", `Saving the gyro offset of ${device.name} failed: ${(err as Error).message}`);
        }
    }
}
