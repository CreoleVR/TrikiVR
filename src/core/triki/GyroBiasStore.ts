import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import type { Vec3 } from "./fusion.js";

const MIN_CHANGE_DEG_PER_SEC = 0.05;

export class GyroBiasStore {
    private readonly entries = new Map<string, Vec3>();

    constructor(private readonly file: string) {
        let data: unknown;
        try {
            data = JSON.parse(readFileSync(file, "utf8"));
        } catch {
            return;
        }
        if (typeof data !== "object" || data === null) return;
        for (const [key, value] of Object.entries(data)) {
            const v = value as Partial<Vec3>;
            if ([v.x, v.y, v.z].every((n) => typeof n === "number" && Number.isFinite(n))) {
                this.entries.set(key, { x: v.x!, y: v.y!, z: v.z! });
            }
        }
    }

    get(key: string): Vec3 | undefined {
        return this.entries.get(key);
    }

    set(key: string, bias: Vec3): boolean {
        const old = this.entries.get(key);
        if (
            old &&
            Math.abs(old.x - bias.x) < MIN_CHANGE_DEG_PER_SEC &&
            Math.abs(old.y - bias.y) < MIN_CHANGE_DEG_PER_SEC &&
            Math.abs(old.z - bias.z) < MIN_CHANGE_DEG_PER_SEC
        ) {
            return false;
        }
        this.entries.set(key, { x: bias.x, y: bias.y, z: bias.z });
        mkdirSync(path.dirname(this.file), { recursive: true });
        writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.entries), null, 2) + "\n");
        return true;
    }
}
