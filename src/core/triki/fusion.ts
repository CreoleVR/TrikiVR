import { BasicVQF, type Quat } from "./vqf.js";

export type { Quat } from "./vqf.js";

const DEG_TO_RAD = Math.PI / 180.0;
const DEFAULT_TS = 1 / 104;

export class OrientationFusion {
    private vqf: BasicVQF | null = null;
    private last: Quat = { w: 1, x: 0, y: 0, z: 0 };

    get quaternion(): Quat {
        return { ...this.last };
    }

    reset(): void {
        this.vqf?.reset();
        this.last = { w: 1, x: 0, y: 0, z: 0 };
    }

    update(
        sample: { gyro: { x: number; y: number; z: number }; accel: { x: number; y: number; z: number } },
        dtSeconds: number,
    ): Quat {
        const dt = dtSeconds > 0 && dtSeconds < 0.2 ? dtSeconds : DEFAULT_TS;
        if (!this.vqf) this.vqf = new BasicVQF(dt);

        this.vqf.updateGyr(
            [sample.gyro.x * DEG_TO_RAD, sample.gyro.y * DEG_TO_RAD, sample.gyro.z * DEG_TO_RAD],
            dt,
        );
        this.vqf.updateAcc([sample.accel.x, sample.accel.y, sample.accel.z]);
        this.last = this.vqf.getQuat6D();
        return this.last;
    }
}
