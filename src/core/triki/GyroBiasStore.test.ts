import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { GyroBiasStore } from "./GyroBiasStore.js";

test("gyro offsets are saved per Triki and read back", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "trikivr-"));
    try {
        const file = path.join(dir, "nested", "gyro-offsets.json");
        assert.equal(new GyroBiasStore(file).get("aa:bb"), undefined);

        const store = new GyroBiasStore(file);
        assert.equal(store.set("aa:bb", { x: 1.5, y: -2, z: 0.25 }), true);
        assert.equal(store.set("cc:dd", { x: 0, y: 0, z: 3 }), true);
        assert.equal(store.set("aa:bb", { x: 1.52, y: -2.01, z: 0.26 }), false);

        const reloaded = new GyroBiasStore(file);
        assert.deepEqual(reloaded.get("aa:bb"), { x: 1.5, y: -2, z: 0.25 });
        assert.deepEqual(reloaded.get("cc:dd"), { x: 0, y: 0, z: 3 });
        assert.equal(reloaded.set("aa:bb", { x: 1.6, y: -2, z: 0.25 }), true);
        assert.deepEqual(new GyroBiasStore(file).get("aa:bb"), { x: 1.6, y: -2, z: 0.25 });
        assert.ok(statSync(file).size > 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("a damaged offsets file is ignored", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "trikivr-"));
    try {
        const file = path.join(dir, "gyro-offsets.json");
        writeFileSync(file, "{ not json");
        assert.equal(new GyroBiasStore(file).get("aa:bb"), undefined);

        writeFileSync(file, JSON.stringify({ "aa:bb": { x: 1, y: "2", z: 3 }, "cc:dd": { x: 1, y: 2, z: 3 } }));
        const store = new GyroBiasStore(file);
        assert.equal(store.get("aa:bb"), undefined);
        assert.deepEqual(store.get("cc:dd"), { x: 1, y: 2, z: 3 });
        assert.ok(readFileSync(file, "utf8").includes("cc:dd"));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
