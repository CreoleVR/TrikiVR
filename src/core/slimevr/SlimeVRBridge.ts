import { createHash } from "crypto";
import { MACAddress, Vector } from "@slimevr/common";
import {
    BoardType,
    FirmwareFeatureFlags,
    MCUType,
    RotationDataType,
    SensorStatus,
    SensorType,
} from "@slimevr/firmware-protocol";
import { EmulatedTracker } from "@slimevr/tracker-emulation";

import type { ImuSample } from "../triki/decode.js";
import type { Quat } from "../triki/fusion.js";
import { type AxisMap, IDENTITY_AXIS_MAP, toSlimeVRQuaternion } from "./mapping.js";

const FIRMWARE_NAME = "TrikiVR";

export interface SlimeVRBridgeOptions {
    serverAddress?: string;
    serverPort?: number;
    axisMap?: AxisMap;
}

export class SlimeVRBridge {
    private readonly trackers = new Map<string, EmulatedTracker>();
    private readonly serverAddress: string;
    private readonly serverPort: number;
    private readonly axisMap: AxisMap;

    constructor(options: SlimeVRBridgeOptions = {}) {
        // Loopback by default: the SlimeVR Server runs on the same host, and a
        // 255.255.255.255 broadcast does not reliably loop back to it.
        this.serverAddress = options.serverAddress ?? "127.0.0.1";
        this.serverPort = options.serverPort ?? 6969;
        this.axisMap = options.axisMap ?? IDENTITY_AXIS_MAP;
    }

    async addTracker(deviceId: string, address: string): Promise<void> {
        if (this.trackers.has(deviceId)) return;

        const tracker = new EmulatedTracker(
            macFromAddress(address || deviceId),
            FIRMWARE_NAME,
            new FirmwareFeatureFlags(new Map([])),
            BoardType.UNKNOWN,
            MCUType.UNKNOWN,
            this.serverAddress,
            this.serverPort,
        );

        await tracker.init();
        await tracker.addSensor(SensorType.UNKNOWN, SensorStatus.OK);
        this.trackers.set(deviceId, tracker);
    }

    async removeTracker(deviceId: string): Promise<void> {
        const tracker = this.trackers.get(deviceId);
        if (!tracker) return;
        this.trackers.delete(deviceId);
        await tracker.deinit().catch(() => {});
    }

    async removeAll(): Promise<void> {
        await Promise.allSettled([...this.trackers.keys()].map((id) => this.removeTracker(id)));
    }

    sendData(deviceId: string, quaternion: Quat, sample: ImuSample): void {
        const tracker = this.trackers.get(deviceId);
        if (!tracker) return;

        const rotation = toSlimeVRQuaternion(quaternion, this.axisMap);
        void tracker.sendRotationData(0, RotationDataType.NORMAL, rotation, 0);
        void tracker.sendAcceleration(0, new Vector(sample.accel.x, sample.accel.y, sample.accel.z));
    }

    sendBattery(deviceId: string, percent: number): void {
        const tracker = this.trackers.get(deviceId);
        if (!tracker) return;
        const voltage = 3.3 + (percent / 100) * 0.9;
        void tracker.changeBatteryLevel(voltage, percent / 100);
    }
}

function macFromAddress(address: string): MACAddress {
    const hexPairs = address.split(":");
    if (hexPairs.length === 6 && hexPairs.every((p) => /^[0-9a-fA-F]{2}$/.test(p))) {
        return new MACAddress(hexPairs.map((p) => parseInt(p, 16)) as MACAddressBytes);
    }
    const digest = createHash("sha1").update(address).digest();
    return new MACAddress([...digest.subarray(0, 6)] as MACAddressBytes);
}

type MACAddressBytes = [number, number, number, number, number, number];
