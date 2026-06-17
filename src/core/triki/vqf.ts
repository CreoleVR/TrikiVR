// Ported from BasicVQF by Daniel Laidig (https://github.com/dlaidig/vqf), MIT License.

const EPS = Number.EPSILON;
const SQRT2 = Math.SQRT2;

export interface Quat {
    w: number;
    x: number;
    y: number;
    z: number;
}

function quatMultiply(q1: number[], q2: number[], out: number[]): void {
    const w = q1[0] * q2[0] - q1[1] * q2[1] - q1[2] * q2[2] - q1[3] * q2[3];
    const x = q1[0] * q2[1] + q1[1] * q2[0] + q1[2] * q2[3] - q1[3] * q2[2];
    const y = q1[0] * q2[2] - q1[1] * q2[3] + q1[2] * q2[0] + q1[3] * q2[1];
    const z = q1[0] * q2[3] + q1[1] * q2[2] - q1[2] * q2[1] + q1[3] * q2[0];
    out[0] = w;
    out[1] = x;
    out[2] = y;
    out[3] = z;
}

function quatRotate(q: number[], v: number[], out: number[]): void {
    const x =
        (1 - 2 * q[2] * q[2] - 2 * q[3] * q[3]) * v[0] +
        2 * v[1] * (q[2] * q[1] - q[0] * q[3]) +
        2 * v[2] * (q[0] * q[2] + q[3] * q[1]);
    const y =
        2 * v[0] * (q[0] * q[3] + q[2] * q[1]) +
        (1 - 2 * q[1] * q[1] - 2 * q[3] * q[3]) * v[1] +
        2 * v[2] * (q[2] * q[3] - q[1] * q[0]);
    const z =
        2 * v[0] * (q[3] * q[1] - q[0] * q[2]) +
        2 * v[1] * (q[0] * q[1] + q[3] * q[2]) +
        (1 - 2 * q[1] * q[1] - 2 * q[2] * q[2]) * v[2];
    out[0] = x;
    out[1] = y;
    out[2] = z;
}

function norm(v: number[], n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) s += v[i] * v[i];
    return Math.sqrt(s);
}

function normalize(v: number[], n: number): void {
    const m = norm(v, n);
    if (m < EPS) return;
    for (let i = 0; i < n; i++) v[i] /= m;
}

function filterCoeffs(tau: number, Ts: number): { b: number[]; a: number[] } {
    if (tau < Ts / 2) {
        return { b: [1, 0, 0], a: [0, 0] };
    }
    const fc = SQRT2 / (2.0 * Math.PI) / tau;
    const C = Math.tan(Math.PI * fc * Ts);
    const D = C * C + SQRT2 * C + 1;
    const b0 = (C * C) / D;
    return {
        b: [b0, 2 * b0, b0],
        a: [(2 * (C * C - 1)) / D, (1 - SQRT2 * C + C * C) / D],
    };
}

function filterInitialState(x0: number, b: number[], a: number[]): [number, number] {
    return [x0 * (1 - b[0]), x0 * (b[2] - a[1])];
}

function filterStep(x: number, b: number[], a: number[], state: number[], o: number): number {
    const y = b[0] * x + state[o];
    state[o] = b[1] * x - a[0] * y + state[o + 1];
    state[o + 1] = b[2] * x - a[1] * y;
    return y;
}

const TAU_ACC = 2.0;

export class BasicVQF {
    private readonly tauAcc = TAU_ACC;
    private accTs: number;
    private b: number[];
    private a: number[];

    private gyrQuat = [1, 0, 0, 0];
    private accQuat = [1, 0, 0, 0];
    private accLpState = [NaN, NaN, NaN, NaN, NaN, NaN];
    private lastAccLp = [0, 0, 0];

    constructor(sampleTs: number) {
        this.accTs = sampleTs;
        const c = filterCoeffs(this.tauAcc, this.accTs);
        this.b = c.b;
        this.a = c.a;
    }

    reset(): void {
        this.gyrQuat = [1, 0, 0, 0];
        this.accQuat = [1, 0, 0, 0];
        this.accLpState = [NaN, NaN, NaN, NaN, NaN, NaN];
        this.lastAccLp = [0, 0, 0];
    }

    updateGyr(gyr: number[], dt: number): void {
        const gyrNorm = norm(gyr, 3);
        const angle = gyrNorm * dt;
        if (gyrNorm > EPS) {
            const c = Math.cos(angle / 2);
            const s = Math.sin(angle / 2) / gyrNorm;
            const step = [c, s * gyr[0], s * gyr[1], s * gyr[2]];
            quatMultiply(this.gyrQuat, step, this.gyrQuat);
            normalize(this.gyrQuat, 4);
        }
    }

    updateAcc(acc: number[]): void {
        if (acc[0] === 0 && acc[1] === 0 && acc[2] === 0) return;

        const accEarth = [0, 0, 0];
        quatRotate(this.gyrQuat, acc, accEarth);
        this.filterVec(accEarth);

        quatRotate(this.accQuat, this.lastAccLp, accEarth);
        normalize(accEarth, 3);

        const corr = [1, 0, 0, 0];
        const qw = Math.sqrt((accEarth[2] + 1) / 2);
        if (qw > 1e-6) {
            corr[0] = qw;
            corr[1] = (0.5 * accEarth[1]) / qw;
            corr[2] = (-0.5 * accEarth[0]) / qw;
            corr[3] = 0;
        } else {
            corr[0] = 0;
            corr[1] = 1;
            corr[2] = 0;
            corr[3] = 0;
        }
        quatMultiply(corr, this.accQuat, this.accQuat);
        normalize(this.accQuat, 4);
    }

    getQuat6D(): Quat {
        const out = [0, 0, 0, 0];
        quatMultiply(this.accQuat, this.gyrQuat, out);
        return { w: out[0], x: out[1], y: out[2], z: out[3] };
    }

    private filterVec(x: number[]): void {
        const st = this.accLpState;
        if (Number.isNaN(st[0])) {
            if (Number.isNaN(st[1])) {
                st[1] = 0;
                st[2] = 0;
                st[3] = 0;
                st[4] = 0;
            }
            st[1]++;
            for (let i = 0; i < 3; i++) {
                st[2 + i] += x[i];
                this.lastAccLp[i] = st[2 + i] / st[1];
            }
            if (st[1] * this.accTs >= this.tauAcc) {
                for (let i = 0; i < 3; i++) {
                    const [s0, s1] = filterInitialState(this.lastAccLp[i], this.b, this.a);
                    st[2 * i] = s0;
                    st[2 * i + 1] = s1;
                }
            }
            return;
        }
        for (let i = 0; i < 3; i++) {
            this.lastAccLp[i] = filterStep(x[i], this.b, this.a, st, 2 * i);
        }
    }
}
