import { strict as assert } from "node:assert";
import { test } from "node:test";

import { headingRad, multiply, VisualOrientation, type Q } from "./visual.js";

const DEG = Math.PI / 180;

function axisAngle(x: number, y: number, z: number, deg: number): Q {
    const h = (deg * DEG) / 2;
    return { w: Math.cos(h), x: x * Math.sin(h), y: y * Math.sin(h), z: z * Math.sin(h) };
}

function up(q: Q): number[] {
    return [2 * (q.x * q.z - q.w * q.y), 2 * (q.y * q.z + q.w * q.x), 1 - 2 * (q.x * q.x + q.y * q.y)];
}

function shown(connect: Q, now: Q): Q {
    const view = new VisualOrientation({ smoothing: 1, deadbandDeg: 0 });
    view.update(connect);
    return view.update(now);
}

test("Trikis lying the same way show the same tilt however they were held at connect", () => {
    const upsideDown = axisAngle(1, 0, 0, 180);
    const heldTilted = multiply(axisAngle(0, 0, 1, 40), multiply(axisAngle(1, 0, 0, 30), axisAngle(0, 1, 0, -20)));
    const a = shown(heldTilted, multiply(axisAngle(0, 0, 1, 70), upsideDown));
    const b = shown(axisAngle(0, 0, 1, -100), multiply(axisAngle(0, 0, 1, -10), upsideDown));
    up(a).forEach((v, i) => assert.ok(Math.abs(v - up(b)[i]) < 1e-9));
    assert.ok(Math.abs(up(a)[2] + 1) < 1e-9);
});

test("the heading starts at zero and follows turns about the vertical", () => {
    const poses = [axisAngle(0, 0, 1, 123), multiply(axisAngle(0, 0, 1, -60), axisAngle(1, 0, 0, 180)), multiply(axisAngle(0, 0, 1, 15), axisAngle(0, 1, 0, 90))];
    for (const pose of poses) {
        const view = new VisualOrientation({ smoothing: 1, deadbandDeg: 0 });
        assert.ok(Math.abs(headingRad(view.update(pose))) < 1e-9);
        const turned = view.update(multiply(axisAngle(0, 0, 1, 30), pose));
        assert.ok(Math.abs(headingRad(turned) - 30 * DEG) < 1e-9);
    }
});
