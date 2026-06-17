import type { AdapterState } from "@stoprocent/noble";

export interface AdapterIssue {
    state: AdapterState;
    platform: NodeJS.Platform;
    message: string;
}

export function adapterIssueMessage(state: AdapterState, platform: NodeJS.Platform): string {
    switch (state) {
        case "unauthorized":
            if (platform === "darwin") {
                return "Bluetooth permission denied. Grant Bluetooth access in System Settings → Privacy & Security → Bluetooth, then restart TrikiVR.";
            }
            return "Bluetooth access was denied by the operating system. Grant Bluetooth permission to TrikiVR and try again.";

        case "unsupported":
            return "No Bluetooth Low Energy adapter was found. Make sure a BLE-capable adapter is connected and its drivers are installed.";

        case "poweredOff":
            return "Bluetooth is turned off. Turn Bluetooth on and press Start scanning again.";

        case "unknown":
        case "resetting":
        default:
            return permissionGuidanceByPlatform(platform);
    }
}

function permissionGuidanceByPlatform(platform: NodeJS.Platform): string {
    switch (platform) {
        case "linux":
            return (
                "Can't access the Bluetooth adapter — TrikiVR likely lacks permission to use raw BLE sockets. " +
                "Run scripts/setup-linux-ble.sh (or launch with sudo), then restart. " +
                "Also check the adapter is unblocked: rfkill list bluetooth."
            );
        case "darwin":
            return "Can't access Bluetooth. Make sure Bluetooth is on and that TrikiVR has Bluetooth permission in System Settings → Privacy & Security → Bluetooth.";
        case "win32":
            return "Can't access the Bluetooth adapter. Make sure Bluetooth is turned on and a BLE-capable adapter is present.";
        default:
            return "Can't access the Bluetooth adapter. Make sure Bluetooth is on and the app has permission to use it.";
    }
}
