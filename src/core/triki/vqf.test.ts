import { strict as assert } from "node:assert";
import { test } from "node:test";

import { TRIKI_VQF_PARAMS } from "./fusion.js";
import { VQF, type VQFParams } from "./vqf.js";

const TS = 1 / 104;

function sample(i: number): { gyr: number[]; acc: number[] } {
    const t = i * TS;
    const m = t > 5 ? 1 : 0;
    return {
        gyr: [
            0.02 + m * 0.5 * Math.sin(1.3 * t),
            -0.03 + m * 0.4 * Math.sin(0.7 * t + 1),
            0.05 + m * 0.3 * Math.sin(0.9 * t + 2),
        ],
        acc: [
            0.5 + m * Math.sin(2.1 * t),
            -0.3 + m * 0.8 * Math.sin(1.7 * t + 0.5),
            9.79 + m * 0.6 * Math.sin(2.9 * t + 1),
        ],
    };
}

interface Expected {
    quat: number[];
    bias: number[];
    rest: boolean;
}

function check(params: Partial<VQFParams>, expected: Map<number, Expected>): void {
    const vqf = new VQF(TS, params);
    const last = Math.max(...expected.keys());
    for (let i = 0; i <= last; i++) {
        const { gyr, acc } = sample(i);
        vqf.update(gyr, acc);
        const want = expected.get(i);
        if (!want) continue;
        const q = vqf.getQuat6D();
        [q.w, q.x, q.y, q.z].forEach((v, k) => assert.ok(Math.abs(v - want.quat[k]) < 1e-9, `quat[${k}] at ${i}`));
        const { bias } = vqf.getBiasEstimate();
        bias.forEach((v, k) => assert.ok(Math.abs(v - want.bias[k]) < 1e-9, `bias[${k}] at ${i}`));
        assert.equal(vqf.getRestDetected(), want.rest);
    }
}

test("VQF matches the reference implementation with the Triki parameters", () => {
    check(
        TRIKI_VQF_PARAMS,
        new Map([
            [
                519,
                {
                    quat: [0.99792867466974, -0.011374587489514308, -0.030277620281561207, 0.055607955738593874],
                    bias: [0.01975303034017476, -0.029610523811782277, 0.049479731437021404],
                    rest: true,
                },
            ],
            [
                2079,
                {
                    quat: [0.9319172940491383, -0.14842800342035983, 0.3089553472921413, 0.1185153080085875],
                    bias: [0.02026683072172968, -0.030441329450726595, 0.049489865873004454],
                    rest: false,
                },
            ],
        ]),
    );
});

test("VQF matches the reference implementation with the default parameters", () => {
    check(
        {},
        new Map([
            [
                519,
                {
                    quat: [0.9899663414298617, 0.00880704289655798, -0.058842655263029016, 0.12816637918342358],
                    bias: [0.00475156131907852, -0.007300646852263662, -0.00047226252939717447],
                    rest: false,
                },
            ],
            [
                2079,
                {
                    quat: [0.7918984742989987, -0.2534464477107716, 0.2590231143069757, 0.49149641992635573],
                    bias: [0.014272249867281863, -0.02366571970092004, 0.003205451237054582],
                    rest: false,
                },
            ],
        ]),
    );
});
