import { exec, spawn } from "child_process";
import { promisify } from "util";
import fs from "fs-extra";
import * as path from "path";
import { ToolResult } from "../types/index.js";
import { ConfirmationService } from "../utils/confirmation-service.js";

const execAsync = promisify(exec);

export class BashTool {
  private currentDirectory: string = process.cwd();
  private confirmationService = ConfirmationService.getInstance();

  private static readonly DEFAULT_MAX_BUFFER = 32 * 1024 * 1024;

  async execute(command: string, timeout: number = 30000): Promise<ToolResult> {
    try {
      // Keep directory aligned with the actual process cwd (e.g. if other code calls process.chdir()).
      this.currentDirectory = process.cwd();

      const sessionFlags = this.confirmationService.getSessionFlags();
      if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
        const confirmationResult =
          await this.confirmationService.requestConfirmation(
            {
              operation: "Run bash command",
              filename: command,
              showVSCodeOpen: false,
              content: `Command: ${command}\nWorking directory: ${this.currentDirectory}`,
            },
            "bash"
          );

        if (!confirmationResult.confirmed) {
          return {
            success: false,
            error:
              confirmationResult.feedback ||
              "Command execution cancelled by user",
          };
        }
      }

      if (command.startsWith("cd ")) {
        const newDir = command.substring(3).trim();
        try {
          process.chdir(newDir);
          this.currentDirectory = process.cwd();
          return {
            success: true,
            output: `Changed directory to: ${this.currentDirectory}`,
          };
        } catch (error: unknown) {
          return {
            success: false,
            error: `Cannot change directory: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      const { stdout, stderr } = await execAsync(command, {
        cwd: this.currentDirectory,
        timeout,
        maxBuffer: BashTool.DEFAULT_MAX_BUFFER,
      });

      const output = stdout + (stderr ? `\nSTDERR: ${stderr}` : "");

      return {
        success: true,
        output: output.trim() || "Command executed successfully (no output)",
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `Command failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  getCurrentDirectory(): string {
    return this.currentDirectory;
  }

  async listFiles(directory: string = "."): Promise<ToolResult> {
    try {
      const resolved = path.resolve(this.currentDirectory, directory);
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const names = entries
        .map((e) => (e.isDirectory() ? `${e.name}${path.sep}` : e.name))
        .sort((a, b) => a.localeCompare(b));
      return {
        success: true,
        output:
          names.length > 0
            ? names.join("\n")
            : `Directory is empty: ${directory}`,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `Cannot list files: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async findFiles(pattern: string, directory: string = "."): Promise<ToolResult> {
    const maxResults = 2000;
    const wildcard = BashTool.wildcardToRegExp(pattern);
    const matches: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      if (matches.length >= maxResults) return;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (matches.length >= maxResults) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (wildcard.test(entry.name)) {
          matches.push(path.relative(this.currentDirectory, full));
        }
      }
    };

    try {
      const resolved = path.resolve(this.currentDirectory, directory);
      await walk(resolved);
      return {
        success: true,
        output:
          matches.length > 0
            ? matches.sort((a, b) => a.localeCompare(b)).join("\n")
            : `No matching files found for "${pattern}" in ${directory}`,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `Cannot find files: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async grep(pattern: string, files: string = "."): Promise<ToolResult> {
    const args = [
      "--line-number",
      "--no-heading",
      "--color=never",
      "--fixed-strings",
      pattern,
      files,
    ];

    return await new Promise<ToolResult>((resolve) => {
      const rg = spawn("rg", args, {
        cwd: this.currentDirectory,
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";

      rg.stdout.on("data", (d) => (stdout += d.toString()));
      rg.stderr.on("data", (d) => (stderr += d.toString()));

      rg.on("close", (code) => {
        if (code === 0 || code === 1) {
          resolve({
            success: true,
            output: stdout.trim() || `No matches for "${pattern}"`,
          });
          return;
        }
        resolve({
          success: false,
          error: `ripgrep failed (code ${code}): ${stderr.trim() || "unknown error"}`,
        });
      });

      rg.on("error", (error) => {
        resolve({
          success: false,
          error: `ripgrep error: ${error?.message ?? String(error)}`,
        });
      });
    });
  }

  private static wildcardToRegExp(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+^${}()|[\\]\\\\]/g, "\\\\$&");
    const rx =
      "^" + escaped.replace(/\\\\\\*/g, ".*").replace(/\\\\\\?/g, ".") + "$";
    return new RegExp(rx, "i");
  }
}

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/tools/bash.ts"
//   "update_script": "adm.exe"
//   "backup_path": "D:\\zPython\\grok-cli\\src/tools/bash.ts.backup_20260216T194243_170999"
//   "created_at": "2026-02-16T11:42:43.179364+00:00"
//   "backup_hash": "f4caddf40db2517107278e102c17c4f8"
//   "new_hash": "8d0f8fa57815f3d0fbff7013a7933216"
//   "goal_id": "bash_tool_safe_helpers_overwrite"
//   "semantics": "Full-file rewrite to avoid indentation-stripping issues in multi-line replace blocks; preserves existing execute() behavior while making list/find/grep helpers argument-based."
//   "update_attrs": {"relative_path": "src/tools/bash.ts", "update_type": "text", "mode": "overwrite", "encoding": "utf-8", "find_pattern": null, "find_text": "", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/tools/bash.ts\""
// }
