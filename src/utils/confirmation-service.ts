import { execFile } from "child_process";
import { promisify } from "util";
import { EventEmitter } from "events";

const execFileAsync = promisify(execFile);

export interface ConfirmationOptions {
  operation: string;
  filename: string;
  showVSCodeOpen?: boolean;
  content?: string; // Content to show in confirmation dialog
}

export interface ConfirmationResult {
  confirmed: boolean;
  dontAskAgain?: boolean;
  feedback?: string;
}

export class ConfirmationService extends EventEmitter {
  private static instance: ConfirmationService;
  private skipConfirmationThisSession = false;
  private pendingConfirmation: Promise<ConfirmationResult> | null = null;
  private resolveConfirmation: ((result: ConfirmationResult) => void) | null =
    null;

  // Session flags for different operation types
  private sessionFlags = {
    fileOperations: false,
    bashCommands: false,
    allOperations: false,
  };

  static getInstance(): ConfirmationService {
    if (!ConfirmationService.instance) {
      ConfirmationService.instance = new ConfirmationService();
    }
    return ConfirmationService.instance;
  }

  constructor() {
    super();
  }

  async requestConfirmation(
    options: ConfirmationOptions,
    operationType: "file" | "bash" = "file"
  ): Promise<ConfirmationResult> {
    // Check session flags
    if (
      this.sessionFlags.allOperations ||
      (operationType === "file" && this.sessionFlags.fileOperations) ||
      (operationType === "bash" && this.sessionFlags.bashCommands)
    ) {
      return { confirmed: true };
    }

    // If VS Code should be opened, try to open it
    if (options.showVSCodeOpen) {
      try {
        await this.openInVSCode(options.filename);
      } catch {
        // If VS Code opening fails, continue without it
        options.showVSCodeOpen = false;
      }
    }

    // Create a promise that will be resolved by the UI component
    this.pendingConfirmation = new Promise<ConfirmationResult>((resolve) => {
      this.resolveConfirmation = resolve;
    });

    // Emit custom event that the UI can listen to (using setImmediate to ensure the UI updates)
    setImmediate(() => {
      this.emit("confirmation-requested", options);
    });

    const result = await this.pendingConfirmation;

    if (result.dontAskAgain) {
      // Set the appropriate session flag based on operation type
      if (operationType === "file") {
        this.sessionFlags.fileOperations = true;
      } else if (operationType === "bash") {
        this.sessionFlags.bashCommands = true;
      }
      // Could also set allOperations for global skip
    }

    return result;
  }

  confirmOperation(confirmed: boolean, dontAskAgain?: boolean): void {
    if (this.resolveConfirmation) {
      this.resolveConfirmation({ confirmed, dontAskAgain });
      this.resolveConfirmation = null;
      this.pendingConfirmation = null;
    }
  }

  rejectOperation(feedback?: string): void {
    if (this.resolveConfirmation) {
      this.resolveConfirmation({ confirmed: false, feedback });
      this.resolveConfirmation = null;
      this.pendingConfirmation = null;
    }
  }

  private async openInVSCode(filename: string): Promise<void> {
    // Try different VS Code commands
    const commands = ["code", "code-insiders", "codium"];
    const isWindows = process.platform === "win32";

    for (const cmd of commands) {
      try {
        // On Windows, `which` is usually unavailable; `where` is the native equivalent.
await execFileAsync(isWindows ? "where" : "which", [cmd], isWindows ? { windowsHide: true } : undefined);
        await execFileAsync(cmd, [filename], isWindows ? { windowsHide: true } : undefined);
        return;
      } catch {
        // Continue to next command
        continue;
      }
    }

    throw new Error("VS Code not found");
  }

  isPending(): boolean {
    return this.pendingConfirmation !== null;
  }

  resetSession(): void {
    this.sessionFlags = {
      fileOperations: false,
      bashCommands: false,
      allOperations: false,
    };
  }

  getSessionFlags() {
    return { ...this.sessionFlags };
  }

  setSessionFlag(
    flagType: "fileOperations" | "bashCommands" | "allOperations",
    value: boolean
  ) {
    this.sessionFlags[flagType] = value;
  }
}

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/utils/confirmation-service.ts"
//   "update_script": "adm.exe"
//   "backup_path": "D:\\zPython\\grok-cli\\src/utils/confirmation-service.ts.backup_20260216T192954_900675"
//   "created_at": "2026-02-16T11:29:54.906657+00:00"
//   "backup_hash": "704a179486dedc17a921f772eab8931c"
//   "new_hash": "704a179486dedc17a921f772eab8931c"
//   "goal_id": "confirmation_service_launch_call_single_line"
//   "semantics": "Collapse launch execFileAsync() call to a single properly-indented line."
//   "update_attrs": {"relative_path": "src/utils/confirmation-service.ts", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "await execFileAsync(\n  cmd,\n  [filename],\n  isWindows ? { windowsHide: true } : undefined\n);", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/utils/confirmation-service.ts\""
// }
