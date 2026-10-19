import { Quaternion } from "@slimevr/common";
import type { Quat, Vec3 } from "../triki/fusion.js";

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

function pick(v: { x: number; y: number; z: number }, sel: { axis: "x" | "y" | "z"; sign: 1 | -1 }): number {
    return v[sel.axis] * sel.sign;
}

export function toSlimeVRQuaternion(q: Quat, map: AxisMap = IDENTITY_AXIS_MAP): Quaternion {
    return new Quaternion(pick(q, map.x), pick(q, map.y), pick(q, map.z), q.w);
}

export function toSlimeVRVector(v: Vec3, map: AxisMap = IDENTITY_AXIS_MAP): Vec3 {
    return { x: pick(v, map.x), y: pick(v, map.y), z: pick(v, map.z) };
}

export function toLegacyAccelFrame(v: Vec3): Vec3 {
    return { x: -v.y, y: v.x, z: v.z };
}
