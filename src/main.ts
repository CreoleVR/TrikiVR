import { fileURLToPath } from "url";
import path from "path";
import { app, BrowserWindow, ipcMain } from "electron";

import { TrackingService } from "./core/TrackingService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
const service = new TrackingService();

function log(message: string): void {
    mainWindow?.webContents.send("log", message);
}

process.on("uncaughtException", (err) => log(`Uncaught exception: ${err.message}`));
process.on("unhandledRejection", (reason) => log(`Unhandled rejection: ${String(reason)}`));

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 960,
        height: 720,
        minWidth: 560,
        minHeight: 480,
        title: "TrikiVR",
        backgroundColor: "#15171c",
        webPreferences: {
            preload: path.join(__dirname, "preload.mjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    void mainWindow.loadFile(path.join(__dirname, "static/html/index.html"));
}

service.on("discover", (d) => {
    log(`Discovered "${d.name}" (${d.address}, ${d.rssi} dBm)`);
    mainWindow?.webContents.send("discover", d);
});
service.on("connected", (info) => {
    log(`Connected "${info.name}"`);
    mainWindow?.webContents.send("connected", info);
});
service.on("disconnected", (id) => {
    log(`Disconnected ${id}`);
    mainWindow?.webContents.send("disconnected", id);
});
service.on("battery", (info) => mainWindow?.webContents.send("battery", info));
service.on("deviceData", (data) => mainWindow?.webContents.send("device:data", data));
service.on("scanStart", () => {
    log("Scanning started");
    mainWindow?.webContents.send("scan:start");
});
service.on("scanStop", () => {
    log("Scanning stopped");
    mainWindow?.webContents.send("scan:stop");
});
service.on("adapterIssue", (issue) => {
    log(`Bluetooth unavailable (${issue.state})`);
    mainWindow?.webContents.send("adapter:issue", issue);
});
service.on("log", (msg) => log(msg));
service.on("error", (msg) => {
    log(`Error: ${msg}`);
    mainWindow?.webContents.send("error", msg);
});

ipcMain.handle("scan:start", async () => {
    try {
        await service.startScanning();
    } catch (err) {
        mainWindow?.webContents.send("error", (err as Error).message);
    }
});
ipcMain.handle("scan:stop", () => service.stopScanning());
ipcMain.handle("device:connect", async (_e, id: string) => {
    try {
        await service.connect(id);
    } catch (err) {
        mainWindow?.webContents.send("error", (err as Error).message);
    }
});
ipcMain.handle("device:disconnect", (_e, id: string) => service.disconnect(id));

app.whenReady().then(() => {
    createWindow();
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", async () => {
    await service.shutdown();
    if (process.platform !== "darwin") app.quit();
});
