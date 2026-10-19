import { VQF, type Quat, type VQFParams } from "./vqf.js";

export type { Quat } from "./vqf.js";

export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

const DEG_TO_RAD = Math.PI / 180.0;
const STANDARD_GRAVITY = 9.80665;
const DEFAULT_TS = 1 / 104;

export const TRIKI_VQF_PARAMS: Partial<VQFParams> = {
    tauAcc: 2.0,
    restMinT: 2.0,
    restThGyr: 0.6,
    restThAcc: 0.06,
    biasClip: 6.0,
};

export class OrientationFusion {
    private vqf: VQF | null = null;
    private last: Quat = { w: 1, x: 0, y: 0, z: 0 };
    private linear: Vec3 = { x: 0, y: 0, z: 0 };
    private startBias: { bias: number[]; sigma: number } | null = null;

    get quaternion(): Quat {
        return { ...this.last };
    }

    get linearAcceleration(): Vec3 {
        return { ...this.linear };
    }

    get gyroBias(): { bias: Vec3; sigma: number } | null {
        if (!this.vqf) return null;
        const { bias, sigma } = this.vqf.getBiasEstimate();
        return {
            bias: { x: bias[0] / DEG_TO_RAD, y: bias[1] / DEG_TO_RAD, z: bias[2] / DEG_TO_RAD },
            sigma: sigma / DEG_TO_RAD,
        };
    }

    setGyroBias(biasDegPerSec: Vec3, sigmaDegPerSec: number): void {
        this.startBias = {
            bias: [biasDegPerSec.x * DEG_TO_RAD, biasDegPerSec.y * DEG_TO_RAD, biasDegPerSec.z * DEG_TO_RAD],
            sigma: sigmaDegPerSec * DEG_TO_RAD,
        };
        this.vqf?.setBiasEstimate(this.startBias.bias, this.startBias.sigma);
    }

    reset(): void {
        if (this.vqf) {
            const { bias, sigma } = this.vqf.getBiasEstimate();
            this.vqf.resetState();
            this.vqf.setBiasEstimate(bias, sigma);
        }
        this.last = { w: 1, x: 0, y: 0, z: 0 };
        this.linear = { x: 0, y: 0, z: 0 };
    }

    update(sample: { gyro: Vec3; accel: Vec3 }, dtSeconds: number): Quat {
        const dt = dtSeconds > 0 && dtSeconds < 0.2 ? dtSeconds : DEFAULT_TS;
        if (!this.vqf) {
            this.vqf = new VQF(dt, TRIKI_VQF_PARAMS);
            if (this.startBias) this.vqf.setBiasEstimate(this.startBias.bias, this.startBias.sigma);
        }

        const acc = [
            sample.accel.x * STANDARD_GRAVITY,
            sample.accel.y * STANDARD_GRAVITY,
            sample.accel.z * STANDARD_GRAVITY,
        ];
        this.vqf.updateGyr(
            [sample.gyro.x * DEG_TO_RAD, sample.gyro.y * DEG_TO_RAD, sample.gyro.z * DEG_TO_RAD],
            dt,
        );
        this.vqf.updateAcc(acc);
        const q = this.vqf.getQuat6D();
        this.last = q;
        this.linear = {
            x: acc[0] - 2 * (q.x * q.z - q.w * q.y) * STANDARD_GRAVITY,
            y: acc[1] - 2 * (q.w * q.x + q.y * q.z) * STANDARD_GRAVITY,
            z: acc[2] - (q.w * q.w - q.x * q.x - q.y * q.y + q.z * q.z) * STANDARD_GRAVITY,
        };
        return q;
    }
}
