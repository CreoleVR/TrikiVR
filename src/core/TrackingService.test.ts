import { strict as assert } from "node:assert";
import { createSocket } from "node:dgram";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { Noble, Peripheral } from "@stoprocent/noble";

import { BATTERY_LEVEL_CHARACTERISTIC_UUID, NUS_TX_CHARACTERISTIC_UUID } from "./triki/constants.js";
import { TrikiManager } from "./triki/TrikiManager.js";
import { TrackingService } from "./TrackingService.js";

// The battery level characteristic of a real Triki: read + notify, one byte of percent. Like noble, a read
// result also arrives as a "data" event.
class FakeBattery extends EventEmitter {
    readonly uuid = BATTERY_LEVEL_CHARACTERISTIC_UUID;
    readonly properties = ["read", "notify"];
    subscribed = false;
    reads = 0;

    constructor(public level: number) {
        super();
    }

    async readAsync(): Promise<Buffer> {
        this.reads++;
        const value = Buffer.from([this.level]);
        this.emit("data", value, false);
        return value;
    }

    async subscribeAsync(): Promise<void> {
        this.subscribed = true;
    }

    async unsubscribeAsync(): Promise<void> {
        this.subscribed = false;
    }

    notify(level: number): void {
        this.level = level;
        if (this.subscribed) this.emit("data", Buffer.from([level]), true);
    }
}

class FakeTriki extends EventEmitter {
    readonly id = "c356b1e01181";
    readonly address = "c3:56:b1:e0:11:81";
    readonly advertisement = { localName: "Triki 3042954438" };
    readonly rssi = -50;

    constructor(readonly battery: FakeBattery) {
        super();
    }

    async connectAsync(): Promise<void> {}

    async discoverAllServicesAndCharacteristicsAsync() {
        const tx = Object.assign(new EventEmitter(), {
            uuid: NUS_TX_CHARACTERISTIC_UUID,
            properties: ["notify"],
            subscribeAsync: async () => {},
            unsubscribeAsync: async () => {},
        });
        return { services: [] as unknown[], characteristics: [tx, this.battery] };
    }

    async disconnectAsync(): Promise<void> {
        this.emit("disconnect");
    }
}

class FakeBle extends EventEmitter {
    state = "poweredOn";
    async startScanningAsync(): Promise<void> {}
    async stopScanningAsync(): Promise<void> {}
}

// Stands in for the SlimeVR Server on a private port: answers the handshake and records battery packets the
// way the server reads them (float voltage, float level 0..1; the server shows level × 100).
async function fakeSlimeVRServer() {
    const socket = createSocket("udp4");
    const levels: number[] = [];
    socket.on("message", (msg, from) => {
        const type = msg.readInt32BE(0);
        if (type === 3) socket.send(Buffer.from([3, ...Buffer.from("Hey OVR =D 5")]), from.port, from.address);
        if (type === 12) {
            const voltage = msg.readFloatBE(12);
            if (voltage > 2 && voltage < 6) levels.push(Math.round(msg.readFloatBE(16) * 10000) / 100);
        }
    });
    await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", resolve));
    return { port: socket.address().port, levels, close: () => socket.close() };
}

async function until(check: () => boolean, ms = 4000): Promise<void> {
    const end = Date.now() + ms;
    while (!check()) {
        if (Date.now() > end) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

async function connectOne(level: number) {
    const server = await fakeSlimeVRServer();
    const ble = new FakeBle();
    const battery = new FakeBattery(level);
    const triki = new FakeTriki(battery);
    const service = new TrackingService({ serverPort: server.port }, undefined, new TrikiManager(ble as unknown as Noble));
    const shown: number[] = [];
    service.on("battery", ({ percent }) => shown.push(percent));
    await service.startScanning();
    ble.emit("discover", triki as unknown as Peripheral);
    const close = async () => {
        await service.shutdown();
        server.close();
    };
    return { server, battery, shown, close };
}

test("the battery level read while a Triki connects reaches the window and SlimeVR", async () => {
    const { server, shown, close } = await connectOne(27);
    try {
        await until(() => shown.length > 0 && server.levels.includes(27));
        assert.deepEqual(shown, [27]);
        assert.ok(server.levels.includes(27), `SlimeVR got ${JSON.stringify(server.levels)}%, not 27%`);
    } finally {
        await close();
    }
});

test("battery changes the Triki notifies are passed on", async () => {
    const { server, battery, shown, close } = await connectOne(27);
    try {
        await until(() => shown.length > 0 && battery.subscribed);
        battery.notify(26);
        await until(() => shown.includes(26) && server.levels.includes(26));
        assert.deepEqual(shown, [27, 26]);
        assert.ok(server.levels.includes(26), `SlimeVR got ${JSON.stringify(server.levels)}%, not 26%`);
    } finally {
        await close();
    }
});
