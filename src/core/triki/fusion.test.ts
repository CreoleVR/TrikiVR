import { strict as assert } from "node:assert";
import { test } from "node:test";

import { OrientationFusion, type Quat } from "./fusion.js";

const TS = 1 / 104;
const OFFSET = { x: 2.5, y: -1.5, z: 3.5 };

function headingDeg(q: Quat): number {
    return (Math.atan2(2 * (q.x * q.y + q.w * q.z), 1 - 2 * (q.y * q.y + q.z * q.z)) * 180) / Math.PI;
}

function still(fusion: OrientationFusion, seconds: number, accel = { x: 0, y: 0, z: 1 }): Quat {
    let q = fusion.quaternion;
    for (let i = 0; i < Math.round(seconds / TS); i++) q = fusion.update({ gyro: OFFSET, accel }, TS);
    return q;
}

test("a still Triki with a gyro offset keeps its heading", () => {
    const fusion = new OrientationFusion();
    const before = headingDeg(still(fusion, 10));
    const after = headingDeg(still(fusion, 50));
    assert.ok(Math.abs(after - before) < 0.2, `heading moved ${after - before}`);
    const bias = fusion.gyroBias!.bias;
    assert.ok(Math.abs(bias.x - OFFSET.x) < 0.01 && Math.abs(bias.y - OFFSET.y) < 0.01 && Math.abs(bias.z - OFFSET.z) < 0.01);
});

test("a stored gyro offset is used from the first sample", () => {
    const fresh = new OrientationFusion();
    const stored = new OrientationFusion();
    stored.setGyroBias(OFFSET, 0.3);
    assert.ok(Math.abs(headingDeg(still(fresh, 1.5))) > 4);
    assert.ok(Math.abs(headingDeg(still(stored, 1.5))) < 0.1);
});

test("linear acceleration is gravity-free, in m/s², in the sensor frame", () => {
    const fusion = new OrientationFusion();
    const tilt = (30 * Math.PI) / 180;
    const accel = { x: 0, y: Math.sin(tilt), z: Math.cos(tilt) };
    still(fusion, 10, accel);
    const rest = fusion.linearAcceleration;
    assert.ok(Math.hypot(rest.x, rest.y, rest.z) < 0.02, `still ${JSON.stringify(rest)}`);

    fusion.update({ gyro: OFFSET, accel: { x: 0.1, y: accel.y, z: accel.z } }, TS);
    const push = fusion.linearAcceleration;
    assert.ok(Math.abs(push.x - 0.980665) < 0.02 && Math.abs(push.y) < 0.02 && Math.abs(push.z) < 0.02, JSON.stringify(push));
});
