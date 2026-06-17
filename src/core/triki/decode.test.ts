import { strict as assert } from "node:assert";
import { test } from "node:test";

import { ACCEL_SCALE, GYRO_SCALE } from "./constants.js";
import { decodeFrame, FrameParser } from "./decode.js";

function makeFrame(gx: number, gy: number, gz: number, ax: number, ay: number, az: number): Buffer {
    const f = Buffer.alloc(14);
    f[0] = 0x22;
    f[1] = 0x00;
    f.writeInt16LE(gx, 2);
    f.writeInt16LE(gy, 4);
    f.writeInt16LE(gz, 6);
    f.writeInt16LE(ax, 8);
    f.writeInt16LE(ay, 10);
    f.writeInt16LE(az, 12);
    return f;
}

test("decodeFrame applies the scale factors", () => {
    const sample = decodeFrame(makeFrame(143, 286, -143, 2048, 4096, -2048));
    assert.equal(sample.gyro.x, 143 / GYRO_SCALE);
    assert.equal(sample.gyro.y, 286 / GYRO_SCALE);
    assert.equal(sample.gyro.z, -143 / GYRO_SCALE);
    assert.equal(sample.accel.x, 2048 / ACCEL_SCALE);
    assert.equal(sample.accel.y, 4096 / ACCEL_SCALE);
    assert.equal(sample.accel.z, -2048 / ACCEL_SCALE);
    assert.equal(sample.raw.gyro.x, 143);
    assert.equal(sample.raw.accel.z, -2048);
});

test("FrameParser yields a single clean frame", () => {
    const parser = new FrameParser();
    const samples = parser.push(makeFrame(143, 0, 0, 0, 0, 2048));
    assert.equal(samples.length, 1);
    assert.equal(samples[0].gyro.x, 143 / GYRO_SCALE);
    assert.equal(parser.droppedBytes, 0);
});

test("FrameParser resynchronises past leading garbage and splits", () => {
    const parser = new FrameParser();
    const a = makeFrame(143, 0, 0, 0, 0, 0);
    const b = makeFrame(0, 286, 0, 0, 0, 0);
    const samples = parser.push(Buffer.concat([Buffer.from([0x01, 0x99, 0x10]), a, b]));
    assert.equal(samples.length, 2);
    assert.equal(samples[0].gyro.x, 143 / GYRO_SCALE);
    assert.equal(samples[1].gyro.y, 286 / GYRO_SCALE);
    assert.equal(parser.droppedBytes, 3);
});

test("FrameParser reassembles a frame split across two notifications", () => {
    const parser = new FrameParser();
    const f = makeFrame(143, 286, 429, 0, 0, 2048);
    assert.equal(parser.push(f.subarray(0, 6)).length, 0);
    const samples = parser.push(f.subarray(6));
    assert.equal(samples.length, 1);
    assert.equal(samples[0].gyro.z, 429 / GYRO_SCALE);
});
