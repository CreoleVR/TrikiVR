export interface Q {
    w: number;
    x: number;
    y: number;
    z: number;
}

const IDENTITY: Q = { w: 1, x: 0, y: 0, z: 0 };

export function normalize(q: Q): Q {
    const n = Math.hypot(q.w, q.x, q.y, q.z) || 1;
    return { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n };
}

export function conjugate(q: Q): Q {
    return { w: q.w, x: -q.x, y: -q.y, z: -q.z };
}

export function multiply(a: Q, b: Q): Q {
    return {
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    };
}

export function slerp(a: Q, b: Q, t: number): Q {
    let dot = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
    let bb = b;
    if (dot < 0) {
        bb = { w: -b.w, x: -b.x, y: -b.y, z: -b.z };
        dot = -dot;
    }
    if (dot > 0.9995) {
        return normalize({
            w: a.w + t * (bb.w - a.w),
            x: a.x + t * (bb.x - a.x),
            y: a.y + t * (bb.y - a.y),
            z: a.z + t * (bb.z - a.z),
        });
    }
    const theta0 = Math.acos(dot);
    const theta = theta0 * t;
    const sin0 = Math.sin(theta0);
    const s0 = Math.cos(theta) - (dot * Math.sin(theta)) / sin0;
    const s1 = Math.sin(theta) / sin0;
    return {
        w: a.w * s0 + bb.w * s1,
        x: a.x * s0 + bb.x * s1,
        y: a.y * s0 + bb.y * s1,
        z: a.z * s0 + bb.z * s1,
    };
}

function fromAxisAngle(ax: number, ay: number, az: number, angleRad: number): Q {
    const h = angleRad / 2;
    const s = Math.sin(h);
    return { w: Math.cos(h), x: ax * s, y: ay * s, z: az * s };
}

export interface VisualOptions {
    smoothing?: number;
    deadbandDeg?: number;
}

export class VisualOrientation {
    private offset: Q = IDENTITY;
    private smoothed: Q = IDENTITY;
    private hasOffset = false;
    private readonly smoothing: number;
    private readonly deadbandDeg: number;

    constructor(options: VisualOptions = {}) {
        this.smoothing = options.smoothing ?? 0.35;
        this.deadbandDeg = options.deadbandDeg ?? 8;
    }

    recenter(raw: Q): void {
        this.offset = conjugate(normalize(raw));
        this.hasOffset = true;
        this.smoothed = IDENTITY;
    }

    update(raw: Q): Q {
        const v = normalize(raw);
        if (!this.hasOffset) {
            this.recenter(v);
            return this.smoothed;
        }
        const target = this.applyDeadband(multiply(this.offset, v));
        this.smoothed = slerp(this.smoothed, target, this.smoothing);
        return this.smoothed;
    }

    private applyDeadband(q: Q): Q {
        if (this.deadbandDeg <= 0) return q;
        let n = normalize(q);
        if (n.w < 0) n = { w: -n.w, x: -n.x, y: -n.y, z: -n.z };
        const angle = 2 * Math.acos(Math.min(1, Math.max(-1, n.w)));
        const angleDeg = (angle * 180) / Math.PI;
        if (angleDeg <= this.deadbandDeg) return IDENTITY;
        const axisLen = Math.hypot(n.x, n.y, n.z);
        if (axisLen < 1e-9) return IDENTITY;
        const reduced = ((angleDeg - this.deadbandDeg) * Math.PI) / 180;
        return fromAxisAngle(n.x / axisLen, n.y / axisLen, n.z / axisLen, reduced);
    }
}
