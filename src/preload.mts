import { contextBridge, ipcRenderer } from "electron";

export interface DiscoveredDevice {
    id: string;
    name: string;
    address: string;
    rssi: number;
}

const api = {
    startScanning: (): Promise<void> => ipcRenderer.invoke("scan:start"),
    stopScanning: (): Promise<void> => ipcRenderer.invoke("scan:stop"),
    connect: (id: string): Promise<void> => ipcRenderer.invoke("device:connect", id),
    disconnect: (id: string): Promise<void> => ipcRenderer.invoke("device:disconnect", id),

    onDiscover: (cb: (d: DiscoveredDevice) => void) => ipcRenderer.on("discover", (_e, d) => cb(d)),
    onConnected: (cb: (info: { id: string; name: string }) => void) =>
        ipcRenderer.on("connected", (_e, info) => cb(info)),
    onDisconnected: (cb: (id: string) => void) => ipcRenderer.on("disconnected", (_e, id) => cb(id)),
    onBattery: (cb: (info: { id: string; percent: number }) => void) =>
        ipcRenderer.on("battery", (_e, info) => cb(info)),
    onDeviceData: (
        cb: (data: {
            id: string;
            hz: number;
            quaternion: { w: number; x: number; y: number; z: number };
            accel: { x: number; y: number; z: number };
        }) => void,
    ) => ipcRenderer.on("device:data", (_e, data) => cb(data)),
    onScanStart: (cb: () => void) => ipcRenderer.on("scan:start", () => cb()),
    onScanStop: (cb: () => void) => ipcRenderer.on("scan:stop", () => cb()),
    onLog: (cb: (message: string) => void) => ipcRenderer.on("log", (_e, msg) => cb(msg)),
    onAdapterIssue: (cb: (issue: { state: string; platform: string; message: string }) => void) =>
        ipcRenderer.on("adapter:issue", (_e, issue) => cb(issue)),
    onError: (cb: (message: string) => void) => ipcRenderer.on("error", (_e, msg) => cb(msg)),
};

export type TrikiVRApi = typeof api;

contextBridge.exposeInMainWorld("trikivr", api);
