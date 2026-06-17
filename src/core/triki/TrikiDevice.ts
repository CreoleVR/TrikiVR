import { EventEmitter } from "events";
import type { Characteristic, Peripheral } from "@stoprocent/noble";

import {
    BATTERY_LEVEL_CHARACTERISTIC_UUID,
    NUS_RX_CHARACTERISTIC_UUID,
    NUS_TX_CHARACTERISTIC_UUID,
    START_COMMAND,
    STARTUP_DISCARD_SAMPLES,
} from "./constants.js";
import { FrameParser, type ImuSample } from "./decode.js";
import { OrientationFusion, type Quat } from "./fusion.js";

export interface TrikiDeviceEvents {
    data: (data: { quaternion: Quat; sample: ImuSample }) => void;
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

    async connect(): Promise<void> {
        this.peripheral.once("disconnect", () => {
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

        if (battery) void this.readBattery(battery);
        this.emit("connected");
    }

    async disconnect(): Promise<void> {
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
            this.emit("data", { quaternion, sample });
        }
    }

    private async readBattery(battery: Characteristic): Promise<void> {
        try {
            const value = await battery.readAsync();
            if (value.length > 0) this.emit("battery", value.readUInt8(0));
        } catch {
            return;
        }
    }
}
