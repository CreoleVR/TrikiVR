import { strict as assert } from "node:assert";
import { test } from "node:test";

import { toLegacyAccelFrame } from "./mapping.js";

function rotateAroundZ(v: { x: number; y: number; z: number }, angle: number) {
    const w = Math.cos(angle / 2);
    const s = Math.sin(angle / 2);
    const tx = 2 * (-s * v.y);
    const ty = 2 * (s * v.x);
    return { x: v.x + w * tx - s * ty, y: v.y + w * ty + s * tx, z: v.z };
}

test("acceleration survives the server's correction for old protocol versions", () => {
    const original = { x: 1.25, y: -0.5, z: 3 };
    const received = rotateAroundZ(toLegacyAccelFrame(original), -Math.PI / 2);
    assert.ok(Math.abs(received.x - original.x) < 1e-12);
    assert.ok(Math.abs(received.y - original.y) < 1e-12);
    assert.ok(Math.abs(received.z - original.z) < 1e-12);
});
