// Ported from VQF by Daniel Laidig (https://github.com/dlaidig/vqf), MIT License.

const EPS = Number.EPSILON;
const SQRT2 = Math.SQRT2;
const DEG = Math.PI / 180;

export interface Quat {
    w: number;
    x: number;
    y: number;
    z: number;
}

export interface VQFParams {
    tauAcc: number;
    motionBiasEstEnabled: boolean;
    restBiasEstEnabled: boolean;
    biasSigmaInit: number;
    biasForgettingTime: number;
    biasClip: number;
    biasSigmaMotion: number;
    biasVerticalForgettingFactor: number;
    biasSigmaRest: number;
    restMinT: number;
    restFilterTau: number;
    restThGyr: number;
    restThAcc: number;
}

export const DEFAULT_VQF_PARAMS: VQFParams = {
    tauAcc: 3.0,
    motionBiasEstEnabled: true,
    restBiasEstEnabled: true,
    biasSigmaInit: 0.5,
    biasForgettingTime: 100.0,
    biasClip: 2.0,
    biasSigmaMotion: 0.1,
    biasVerticalForgettingFactor: 0.0001,
    biasSigmaRest: 0.03,
    restMinT: 1.5,
    restFilterTau: 0.5,
    restThGyr: 2.0,
    restThAcc: 0.5,
};

interface Filter {
    b: number[];
    a: number[];
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
        v[1] * (1 - 2 * q[1] * q[1] - 2 * q[3] * q[3]) +
        2 * v[2] * (q[2] * q[3] - q[1] * q[0]);
    const z =
        2 * v[0] * (q[3] * q[1] - q[0] * q[2]) +
        2 * v[1] * (q[0] * q[1] + q[3] * q[2]) +
        v[2] * (1 - 2 * q[1] * q[1] - 2 * q[2] * q[2]);
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

function clip(v: number[], n: number, min: number, max: number): void {
    for (let i = 0; i < n; i++) {
        if (v[i] < min) v[i] = min;
        else if (v[i] > max) v[i] = max;
    }
}

function filterCoeffs(tau: number, Ts: number): Filter {
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

function filterStep(x: number, f: Filter, state: number[], o: number): number {
    const y = f.b[0] * x + state[o];
    state[o] = f.b[1] * x - f.a[0] * y + state[o + 1];
    state[o + 1] = f.b[2] * x - f.a[1] * y;
    return y;
}

function filterVec(x: number[], n: number, tau: number, Ts: number, f: Filter, state: number[], out: number[]): void {
    if (Number.isNaN(state[0])) {
        if (Number.isNaN(state[1])) {
            state[1] = 0;
            for (let i = 0; i < n; i++) state[2 + i] = 0;
        }
        state[1]++;
        for (let i = 0; i < n; i++) {
            state[2 + i] += x[i];
            out[i] = state[2 + i] / state[1];
        }
        if (state[1] * Ts >= tau) {
            for (let i = 0; i < n; i++) {
                state[2 * i] = out[i] * (1 - f.b[0]);
                state[2 * i + 1] = out[i] * (f.b[2] - f.a[1]);
            }
        }
        return;
    }
    for (let i = 0; i < n; i++) out[i] = filterStep(x[i], f, state, 2 * i);
}

function nanState(n: number): number[] {
    return new Array<number>(Math.max(2 * n, n + 2)).fill(NaN);
}

function scaledIdentity(scale: number, out: number[]): void {
    out.fill(0);
    out[0] = scale;
    out[4] = scale;
    out[8] = scale;
}

function mat3Mul(a: number[], b: number[], out: number[]): void {
    const t = new Array<number>(9);
    for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) t[3 * r + c] = a[3 * r] * b[c] + a[3 * r + 1] * b[3 + c] + a[3 * r + 2] * b[6 + c];
    for (let i = 0; i < 9; i++) out[i] = t[i];
}

function mat3MulTpsFirst(a: number[], b: number[], out: number[]): void {
    const t = new Array<number>(9);
    for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) t[3 * r + c] = a[r] * b[c] + a[3 + r] * b[3 + c] + a[6 + r] * b[6 + c];
    for (let i = 0; i < 9; i++) out[i] = t[i];
}

function mat3MulTpsSecond(a: number[], b: number[], out: number[]): void {
    const t = new Array<number>(9);
    for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++)
            t[3 * r + c] = a[3 * r] * b[3 * c] + a[3 * r + 1] * b[3 * c + 1] + a[3 * r + 2] * b[3 * c + 2];
    for (let i = 0; i < 9; i++) out[i] = t[i];
}

function mat3Inv(m: number[], out: number[]): boolean {
    const A = m[4] * m[8] - m[5] * m[7];
    const D = m[2] * m[7] - m[1] * m[8];
    const G = m[1] * m[5] - m[2] * m[4];
    const B = m[5] * m[6] - m[3] * m[8];
    const E = m[0] * m[8] - m[2] * m[6];
    const H = m[2] * m[3] - m[0] * m[5];
    const C = m[3] * m[7] - m[4] * m[6];
    const F = m[1] * m[6] - m[0] * m[7];
    const I = m[0] * m[4] - m[1] * m[3];
    const det = m[0] * A + m[1] * B + m[2] * C;
    if (det >= -EPS && det <= EPS) {
        out.fill(0);
        return false;
    }
    out[0] = A / det;
    out[1] = D / det;
    out[2] = G / det;
    out[3] = B / det;
    out[4] = E / det;
    out[5] = H / det;
    out[6] = C / det;
    out[7] = F / det;
    out[8] = I / det;
    return true;
}

export class VQF {
    readonly params: VQFParams;
    readonly gyrTs: number;
    readonly accTs: number;

    private readonly accLp: Filter;
    private readonly restGyrLp: Filter;
    private readonly restAccLp: Filter;
    private readonly biasP0: number;
    private readonly biasV: number;
    private readonly biasMotionW: number;
    private readonly biasVerticalW: number;
    private readonly biasRestW: number;

    private gyrQuat = [1, 0, 0, 0];
    private accQuat = [1, 0, 0, 0];
    private restDetected = false;
    private lastAccLp = [0, 0, 0];
    private accLpState = nanState(3);
    private bias = [0, 0, 0];
    private biasP = new Array<number>(9).fill(0);
    private motionBiasEstRLpState = nanState(9);
    private motionBiasEstBiasLpState = nanState(2);
    private restLastSquaredDeviations = [0, 0];
    private restT = 0;
    private restLastGyrLp = [0, 0, 0];
    private restGyrLpState = nanState(3);
    private restLastAccLp = [0, 0, 0];
    private restAccLpState = nanState(3);

    constructor(gyrTs: number, params: Partial<VQFParams> = {}, accTs = -1) {
        this.params = { ...DEFAULT_VQF_PARAMS, ...params };
        this.gyrTs = gyrTs;
        this.accTs = accTs > 0 ? accTs : gyrTs;
        const p = this.params;

        this.accLp = filterCoeffs(p.tauAcc, this.accTs);
        this.biasP0 = (p.biasSigmaInit * 100) ** 2;
        this.biasV = ((0.1 * 100) ** 2 * this.accTs) / p.biasForgettingTime;
        const pMotion = (p.biasSigmaMotion * 100) ** 2;
        this.biasMotionW = pMotion ** 2 / this.biasV + pMotion;
        this.biasVerticalW = this.biasMotionW / Math.max(p.biasVerticalForgettingFactor, 1e-10);
        const pRest = (p.biasSigmaRest * 100) ** 2;
        this.biasRestW = pRest ** 2 / this.biasV + pRest;
        this.restGyrLp = filterCoeffs(p.restFilterTau, this.gyrTs);
        this.restAccLp = filterCoeffs(p.restFilterTau, this.accTs);

        this.resetState();
    }

    resetState(): void {
        this.gyrQuat = [1, 0, 0, 0];
        this.accQuat = [1, 0, 0, 0];
        this.restDetected = false;
        this.lastAccLp = [0, 0, 0];
        this.accLpState = nanState(3);
        this.bias = [0, 0, 0];
        scaledIdentity(this.biasP0, this.biasP);
        this.motionBiasEstRLpState = nanState(9);
        this.motionBiasEstBiasLpState = nanState(2);
        this.restLastSquaredDeviations = [0, 0];
        this.restT = 0;
        this.restLastGyrLp = [0, 0, 0];
        this.restGyrLpState = nanState(3);
        this.restLastAccLp = [0, 0, 0];
        this.restAccLpState = nanState(3);
    }

    updateGyr(gyr: number[], dt = this.gyrTs): void {
        const p = this.params;
        if (p.restBiasEstEnabled) {
            filterVec(gyr, 3, p.restFilterTau, this.gyrTs, this.restGyrLp, this.restGyrLpState, this.restLastGyrLp);
            const lp = this.restLastGyrLp;
            this.restLastSquaredDeviations[0] = (gyr[0] - lp[0]) ** 2 + (gyr[1] - lp[1]) ** 2 + (gyr[2] - lp[2]) ** 2;
            const biasClip = p.biasClip * DEG;
            if (
                this.restLastSquaredDeviations[0] >= (p.restThGyr * DEG) ** 2 ||
                Math.abs(lp[0]) > biasClip ||
                Math.abs(lp[1]) > biasClip ||
                Math.abs(lp[2]) > biasClip
            ) {
                this.restT = 0;
                this.restDetected = false;
            }
        }

        const g = [gyr[0] - this.bias[0], gyr[1] - this.bias[1], gyr[2] - this.bias[2]];
        const gyrNorm = norm(g, 3);
        const angle = gyrNorm * dt;
        if (gyrNorm > EPS) {
            const c = Math.cos(angle / 2);
            const s = Math.sin(angle / 2) / gyrNorm;
            quatMultiply(this.gyrQuat, [c, s * g[0], s * g[1], s * g[2]], this.gyrQuat);
            normalize(this.gyrQuat, 4);
        }
    }

    updateAcc(acc: number[]): void {
        if (acc[0] === 0 && acc[1] === 0 && acc[2] === 0) return;
        const p = this.params;

        if (p.restBiasEstEnabled) {
            filterVec(acc, 3, p.restFilterTau, this.accTs, this.restAccLp, this.restAccLpState, this.restLastAccLp);
            const lp = this.restLastAccLp;
            this.restLastSquaredDeviations[1] = (acc[0] - lp[0]) ** 2 + (acc[1] - lp[1]) ** 2 + (acc[2] - lp[2]) ** 2;
            if (this.restLastSquaredDeviations[1] >= p.restThAcc ** 2) {
                this.restT = 0;
                this.restDetected = false;
            } else {
                this.restT += this.accTs;
                if (this.restT >= p.restMinT) this.restDetected = true;
            }
        }

        const accEarth = [0, 0, 0];
        quatRotate(this.gyrQuat, acc, accEarth);
        filterVec(accEarth, 3, p.tauAcc, this.accTs, this.accLp, this.accLpState, this.lastAccLp);
        quatRotate(this.accQuat, this.lastAccLp, accEarth);
        normalize(accEarth, 3);

        const corr = [0, 1, 0, 0];
        const qw = Math.sqrt((accEarth[2] + 1) / 2);
        if (qw > 1e-6) {
            corr[0] = qw;
            corr[1] = (0.5 * accEarth[1]) / qw;
            corr[2] = (-0.5 * accEarth[0]) / qw;
            corr[3] = 0;
        }
        quatMultiply(corr, this.accQuat, this.accQuat);
        normalize(this.accQuat, 4);

        if (!p.motionBiasEstEnabled && !p.restBiasEstEnabled) return;
        const biasClip = p.biasClip * DEG;
        const q = [0, 0, 0, 0];
        quatMultiply(this.accQuat, this.gyrQuat, q);
        const R = [
            1 - 2 * q[2] ** 2 - 2 * q[3] ** 2,
            2 * (q[2] * q[1] - q[0] * q[3]),
            2 * (q[0] * q[2] + q[3] * q[1]),
            2 * (q[0] * q[3] + q[2] * q[1]),
            1 - 2 * q[1] ** 2 - 2 * q[3] ** 2,
            2 * (q[2] * q[3] - q[1] * q[0]),
            2 * (q[3] * q[1] - q[0] * q[2]),
            2 * (q[0] * q[1] + q[3] * q[2]),
            1 - 2 * q[1] ** 2 - 2 * q[2] ** 2,
        ];
        const b = this.bias;
        const biasLp = [R[0] * b[0] + R[1] * b[1] + R[2] * b[2], R[3] * b[0] + R[4] * b[1] + R[5] * b[2]];
        filterVec(R, 9, p.tauAcc, this.accTs, this.accLp, this.motionBiasEstRLpState, R);
        filterVec(biasLp, 2, p.tauAcc, this.accTs, this.accLp, this.motionBiasEstBiasLpState, biasLp);

        let w: number[];
        let e: number[];
        if (this.restDetected && p.restBiasEstEnabled) {
            e = [this.restLastGyrLp[0] - b[0], this.restLastGyrLp[1] - b[1], this.restLastGyrLp[2] - b[2]];
            scaledIdentity(1, R);
            w = [this.biasRestW, this.biasRestW, this.biasRestW];
        } else if (p.motionBiasEstEnabled) {
            e = [
                -accEarth[1] / this.accTs + biasLp[0] - R[0] * b[0] - R[1] * b[1] - R[2] * b[2],
                accEarth[0] / this.accTs + biasLp[1] - R[3] * b[0] - R[4] * b[1] - R[5] * b[2],
                -R[6] * b[0] - R[7] * b[1] - R[8] * b[2],
            ];
            w = [this.biasMotionW, this.biasMotionW, this.biasVerticalW];
        } else {
            e = [0, 0, 0];
            w = [-1, -1, -1];
        }

        const P = this.biasP;
        if (P[0] < this.biasP0) P[0] += this.biasV;
        if (P[4] < this.biasP0) P[4] += this.biasV;
        if (P[8] < this.biasP0) P[8] += this.biasV;
        if (w[0] < 0) return;

        clip(e, 3, -biasClip, biasClip);
        const K = new Array<number>(9);
        mat3MulTpsSecond(P, R, K);
        mat3Mul(R, K, K);
        K[0] += w[0];
        K[4] += w[1];
        K[8] += w[2];
        mat3Inv(K, K);
        mat3MulTpsFirst(R, K, K);
        mat3Mul(P, K, K);
        b[0] += K[0] * e[0] + K[1] * e[1] + K[2] * e[2];
        b[1] += K[3] * e[0] + K[4] * e[1] + K[5] * e[2];
        b[2] += K[6] * e[0] + K[7] * e[1] + K[8] * e[2];
        mat3Mul(K, R, K);
        mat3Mul(K, P, K);
        for (let i = 0; i < 9; i++) P[i] -= K[i];
        clip(b, 3, -biasClip, biasClip);
    }

    update(gyr: number[], acc: number[], dt = this.gyrTs): void {
        this.updateGyr(gyr, dt);
        this.updateAcc(acc);
    }

    getQuat6D(): Quat {
        const out = [0, 0, 0, 0];
        quatMultiply(this.accQuat, this.gyrQuat, out);
        return { w: out[0], x: out[1], y: out[2], z: out[3] };
    }

    getBiasEstimate(): { bias: [number, number, number]; sigma: number } {
        const P = this.biasP;
        const sum1 = Math.abs(P[0]) + Math.abs(P[1]) + Math.abs(P[2]);
        const sum2 = Math.abs(P[3]) + Math.abs(P[4]) + Math.abs(P[5]);
        const sum3 = Math.abs(P[6]) + Math.abs(P[7]) + Math.abs(P[8]);
        const p = Math.min(Math.max(sum1, sum2, sum3), this.biasP0);
        return { bias: [this.bias[0], this.bias[1], this.bias[2]], sigma: (Math.sqrt(p) * Math.PI) / 100 / 180 };
    }

    setBiasEstimate(bias: number[], sigma = -1): void {
        this.bias = [bias[0], bias[1], bias[2]];
        if (sigma > 0) scaledIdentity((sigma * ((180 * 100) / Math.PI)) ** 2, this.biasP);
    }

    getRestDetected(): boolean {
        return this.restDetected;
    }
}
