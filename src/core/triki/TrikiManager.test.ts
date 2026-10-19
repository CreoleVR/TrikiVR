import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import { test, type TestContext } from "node:test";
import type { Noble, Peripheral } from "@stoprocent/noble";

import { AUTO_CONNECT_RETRY_MS, NUS_TX_CHARACTERISTIC_UUID } from "./constants.js";
import { TrikiManager } from "./TrikiManager.js";

class FakePeripheral extends EventEmitter {
    readonly id = "c356b1e01181";
    readonly address = "c3:56:b1:e0:11:81";
    readonly advertisement = { localName: "Triki 3042954438" };
    readonly rssi = -50;
    connects = 0;
    failNext = 0;

    async connectAsync(): Promise<void> {
        this.connects++;
        if (this.failNext > 0) {
            this.failNext--;
            throw new Error("Disconnected unknown");
        }
    }

    async discoverAllServicesAndCharacteristicsAsync() {
        const tx = Object.assign(new EventEmitter(), {
            uuid: NUS_TX_CHARACTERISTIC_UUID,
            subscribeAsync: async () => {},
            unsubscribeAsync: async () => {},
        });
        return { services: [] as unknown[], characteristics: [tx] };
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

const settle = () => new Promise((resolve) => setImmediate(resolve));

async function setup(t: TestContext) {
    let now = 1_000_000;
    t.mock.method(Date, "now", () => now);
    const ble = new FakeBle();
    const triki = new FakePeripheral();
    const manager = new TrikiManager(ble as unknown as Noble);
    const events = { discover: 0, connected: 0, disconnected: 0, logs: [] as string[] };
    manager.on("discover", () => events.discover++);
    manager.on("deviceConnected", () => events.connected++);
    manager.on("deviceDisconnected", () => events.disconnected++);
    manager.on("log", (message) => events.logs.push(message));
    await manager.startScanning();
    const advertise = async () => {
        ble.emit("discover", triki as unknown as Peripheral);
        await settle();
    };
    const wait = (ms: number) => {
        now += ms;
    };
    return { manager, triki, events, advertise, wait };
}

test("a Triki found while scanning connects by itself and is listed once", async (t) => {
    const { manager, triki, events, advertise } = await setup(t);
    await advertise();
    await advertise();
    await advertise();
    assert.equal(events.discover, 1);
    assert.equal(events.connected, 1);
    assert.equal(triki.connects, 1);
    assert.equal(manager.getConnectedDevices().length, 1);
});

test("a failed attempt is retried after a pause and does not break the next connection", async (t) => {
    const { manager, triki, events, advertise, wait } = await setup(t);
    triki.failNext = 1;
    await advertise();
    assert.equal(events.connected, 0);
    assert.equal(events.logs.length, 1);

    await advertise();
    assert.equal(triki.connects, 1);

    wait(AUTO_CONNECT_RETRY_MS);
    await advertise();
    assert.equal(triki.connects, 2);
    assert.equal(events.connected, 1);

    triki.emit("disconnect");
    await settle();
    assert.equal(events.disconnected, 1);
    assert.equal(manager.getConnectedDevices().length, 0);
});

test("a Triki disconnected by hand stays off until Connect is pressed", async (t) => {
    const { manager, triki, events, advertise, wait } = await setup(t);
    await advertise();
    await manager.disconnect(triki.id);
    wait(AUTO_CONNECT_RETRY_MS);
    await advertise();
    assert.equal(triki.connects, 1);

    await manager.connect(triki.id);
    assert.equal(triki.connects, 2);
    assert.equal(events.connected, 2);
});

test("a Triki that drops out reconnects when it advertises again", async (t) => {
    const { manager, triki, events, advertise, wait } = await setup(t);
    await advertise();
    triki.emit("disconnect");
    await settle();
    wait(AUTO_CONNECT_RETRY_MS);
    await advertise();
    assert.equal(events.discover, 2);
    assert.equal(events.connected, 2);
    assert.equal(manager.getConnectedDevices().length, 1);
});
