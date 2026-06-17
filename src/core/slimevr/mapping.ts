import { Quaternion } from "@slimevr/common";
import type { Quat } from "../triki/fusion.js";

export interface AxisMap {
    x: { axis: "x" | "y" | "z"; sign: 1 | -1 };
    y: { axis: "x" | "y" | "z"; sign: 1 | -1 };
    z: { axis: "x" | "y" | "z"; sign: 1 | -1 };
}

export const IDENTITY_AXIS_MAP: AxisMap = {
    x: { axis: "x", sign: 1 },
    y: { axis: "y", sign: 1 },
    z: { axis: "z", sign: 1 },
};

function pick(q: Quat, sel: { axis: "x" | "y" | "z"; sign: 1 | -1 }): number {
    return q[sel.axis] * sel.sign;
}

export function toSlimeVRQuaternion(q: Quat, map: AxisMap = IDENTITY_AXIS_MAP): Quaternion {
    return new Quaternion(pick(q, map.x), pick(q, map.y), pick(q, map.z), q.w);
}
