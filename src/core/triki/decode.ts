import {
    ACCEL_SCALE,
    FRAME_HEADER_0,
    FRAME_HEADER_1,
    FRAME_LENGTH,
    GYRO_SCALE,
} from "./constants.js";

export interface ImuSample {
    gyro: { x: number; y: number; z: number };
    accel: { x: number; y: number; z: number };
    raw: {
        gyro: { x: number; y: number; z: number };
        accel: { x: number; y: number; z: number };
    };
}

export function decodeFrame(frame: Buffer): ImuSample {
    const rawGyroX = frame.readInt16LE(2);
    const rawGyroY = frame.readInt16LE(4);
    const rawGyroZ = frame.readInt16LE(6);
    const rawAccelX = frame.readInt16LE(8);
    const rawAccelY = frame.readInt16LE(10);
    const rawAccelZ = frame.readInt16LE(12);

    return {
        gyro: { x: rawGyroX / GYRO_SCALE, y: rawGyroY / GYRO_SCALE, z: rawGyroZ / GYRO_SCALE },
        accel: { x: rawAccelX / ACCEL_SCALE, y: rawAccelY / ACCEL_SCALE, z: rawAccelZ / ACCEL_SCALE },
        raw: {
            gyro: { x: rawGyroX, y: rawGyroY, z: rawGyroZ },
            accel: { x: rawAccelX, y: rawAccelY, z: rawAccelZ },
        },
    };
}

export class FrameParser {
    private buffer: Buffer = Buffer.alloc(0);
    public droppedBytes = 0;

    push(bytes: Buffer): ImuSample[] {
        this.buffer = this.buffer.length === 0 ? Buffer.from(bytes) : Buffer.concat([this.buffer, bytes]);
        const samples: ImuSample[] = [];

        while (true) {
            const headerIndex = this.findHeader();
            if (headerIndex < 0) {
                if (this.buffer.length > 0) {
                    const keepTrailing = this.buffer[this.buffer.length - 1] === FRAME_HEADER_0;
                    const dropCount = keepTrailing ? this.buffer.length - 1 : this.buffer.length;
                    this.droppedBytes += dropCount;
                    this.buffer = keepTrailing
                        ? this.buffer.subarray(this.buffer.length - 1)
                        : Buffer.alloc(0);
                }
                break;
            }

            if (headerIndex > 0) {
                this.droppedBytes += headerIndex;
                this.buffer = this.buffer.subarray(headerIndex);
            }

            if (this.buffer.length < FRAME_LENGTH) break;

            samples.push(decodeFrame(this.buffer.subarray(0, FRAME_LENGTH)));
            this.buffer = this.buffer.subarray(FRAME_LENGTH);
        }

        return samples;
    }

    private findHeader(): number {
        for (let i = 0; i < this.buffer.length - 1; i++) {
            if (this.buffer[i] === FRAME_HEADER_0 && this.buffer[i + 1] === FRAME_HEADER_1) {
                return i;
            }
        }
        return -1;
    }
}
