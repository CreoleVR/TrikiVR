import { EventEmitter } from "events";
import type { Characteristic, Peripheral } from "@stoprocent/noble";

import {
    BATTERY_LEVEL_CHARACTERISTIC_UUID,
    BATTERY_POLL_MS,
    NUS_RX_CHARACTERISTIC_UUID,
    NUS_TX_CHARACTERISTIC_UUID,
    START_COMMAND,
    STARTUP_DISCARD_SAMPLES,
} from "./constants.js";
import { FrameParser, type ImuSample } from "./decode.js";
import { OrientationFusion, type Quat, type Vec3 } from "./fusion.js";

export interface TrikiDeviceEvents {
    data: (data: { quaternion: Quat; linearAcceleration: Vec3; sample: ImuSample }) => void;
    battery: (percent: number) => void;
    connected: () => void;
    disconnected: () => void;
    error: (error: Error) => void;
}

export declare interface TrikiDevice {
    on<E extends keyof TrikiDeviceEvents>(event: E, listener: TrikiDeviceEvents[E]): this;
    emit<E extends keyof TrikiDeviceEvents>(event: E, ...args: Parameters<TrikiDeviceEvents[E]>): boolean;
}

export class TrikiDevice extends EventEmitter {
    readonly id: string;
    readonly name: string;
    readonly address: string;

    private readonly peripheral: Peripheral;
    private readonly parser = new FrameParser();
    private readonly fusion = new OrientationFusion();
    private txCharacteristic?: Characteristic;
    private batteryCharacteristic?: Characteristic;
    private batteryTimer?: NodeJS.Timeout;
    private batteryPercent?: number;
    private sampleCount = 0;
    private connected = false;
    private measuredDt = 0.01;
    private framesInWindow = 0;
    private windowStartMs: number | null = null;

    constructor(peripheral: Peripheral) {
        super();
        this.peripheral = peripheral;
        this.id = peripheral.id;
        this.address = peripheral.address || peripheral.id;
        this.name = peripheral.advertisement?.localName || "Triki";
    }

    get isConnected(): boolean {
        return this.connected;
    }

    /** Last battery level in percent, once the Triki has reported one. */
    get battery(): number | undefined {
        return this.batteryPercent;
    }

    async connect(): Promise<void> {
        this.peripheral.once("disconnect", () => {
            this.stopBattery();
            this.connected = false;
            this.emit("disconnected");
        });

        await this.peripheral.connectAsync();
        this.connected = true;

        const { characteristics } = await this.peripheral.discoverAllServicesAndCharacteristicsAsync();

        const tx = characteristics.find((c) => c.uuid === NUS_TX_CHARACTERISTIC_UUID);
        const rx = characteristics.find((c) => c.uuid === NUS_RX_CHARACTERISTIC_UUID);
        const battery = characteristics.find((c) => c.uuid === BATTERY_LEVEL_CHARACTERISTIC_UUID);
        if (!tx) throw new Error(`Triki ${this.name}: NUS TX characteristic not found`);

        this.txCharacteristic = tx;
        tx.on("data", (data: Buffer) => this.handleNotification(data));
        await tx.subscribeAsync();

        if (rx) {
            await rx.writeAsync(START_COMMAND, true);
        }

        if (battery) void this.watchBattery(battery);
        this.emit("connected");
    }

    async disconnect(): Promise<void> {
        this.stopBattery();
        try {
            if (this.txCharacteristic) {
                this.txCharacteristic.removeAllListeners("data");
                await this.txCharacteristic.unsubscribeAsync().catch(() => {});
            }
            await this.peripheral.disconnectAsync();
        } finally {
            this.connected = false;
        }
    }

    resetOrientation(): void {
        this.fusion.reset();
    }

    get gyroBias(): { bias: Vec3; sigma: number } | null {
        return this.fusion.gyroBias;
    }

    setGyroBias(biasDegPerSec: Vec3, sigmaDegPerSec: number): void {
        this.fusion.setGyroBias(biasDegPerSec, sigmaDegPerSec);
    }

    private handleNotification(data: Buffer): void {
        const now = Date.now();
        const samples = this.parser.push(data);

        const ready: ImuSample[] = [];
        for (const sample of samples) {
            if (this.sampleCount < STARTUP_DISCARD_SAMPLES) {
                this.sampleCount++;
                continue;
            }
            this.sampleCount++;
            ready.push(sample);
        }
        if (ready.length === 0) return;

        if (this.windowStartMs === null) this.windowStartMs = now;
        this.framesInWindow += ready.length;
        const span = now - this.windowStartMs;
        if (span >= 1000 && this.framesInWindow > 0) {
            const avg = span / 1000 / this.framesInWindow;
            this.measuredDt = Math.min(Math.max(0.5 * this.measuredDt + 0.5 * avg, 0.002), 0.05);
            this.framesInWindow = 0;
            this.windowStartMs = now;
        }

        for (const sample of ready) {
            const quaternion = this.fusion.update(sample, this.measuredDt);
            this.emit("data", { quaternion, linearAcceleration: this.fusion.linearAcceleration, sample });
        }
    }

    // Triki has the standard Battery Service: one byte of percent, readable and notified on change. Reads
    // repeat every minute in case notifications don't come.
    private async watchBattery(battery: Characteristic): Promise<void> {
        this.batteryCharacteristic = battery;
        battery.on("data", (data: Buffer) => this.handleBattery(data));
        const read = () =>
            battery
                .readAsync()
                .then((data) => this.handleBattery(data))
                .catch(() => {});
        this.batteryTimer = setInterval(() => void read(), BATTERY_POLL_MS);
        this.batteryTimer.unref?.();
        if (battery.properties?.includes("notify")) await battery.subscribeAsync().catch(() => {});
        await read();
    }

    private handleBattery(data: Buffer): void {
        if (!this.batteryCharacteristic || data.length < 1) return;
        const percent = data.readUInt8(0);
        if (percent > 100 || percent === this.batteryPercent) return;
        this.batteryPercent = percent;
        this.emit("battery", percent);
    }

    private stopBattery(): void {
        if (this.batteryTimer) clearInterval(this.batteryTimer);
        this.batteryTimer = undefined;
        if (this.batteryCharacteristic) {
            this.batteryCharacteristic.removeAllListeners("data");
            this.batteryCharacteristic = undefined;
        }
    }
}
