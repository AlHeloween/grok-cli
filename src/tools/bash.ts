import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolResult } from '../types/index.js';
import { ConfirmationService } from '../utils/confirmation-service.js';

const execAsync = promisify(exec);

export class BashTool {
  private currentDirectory: string = process.cwd();
  private confirmationService = ConfirmationService.getInstance();

  private static readonly DEFAULT_MAX_BUFFER = 32 * 1024 * 1024;

  async execute(command: string, timeout: number = 30000): Promise<ToolResult> {
    try {
      // Check if user has already accepted bash commands for this session
      const sessionFlags = this.confirmationService.getSessionFlags();
      if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
        // Request confirmation showing the command
        const confirmationResult = await this.confirmationService.requestConfirmation({
          operation: 'Run bash command',
          filename: command,
          showVSCodeOpen: false,
          content: `Command: ${command}\nWorking directory: ${this.currentDirectory}`
        }, 'bash');

        if (!confirmationResult.confirmed) {
          return {
            success: false,
            error: confirmationResult.feedback || 'Command execution cancelled by user'
          };
        }
      }

      if (command.startsWith('cd ')) {
        const newDir = command.substring(3).trim();
        try {
          process.chdir(newDir);
          this.currentDirectory = process.cwd();
          return {
            success: true,
            output: `Changed directory to: ${this.currentDirectory}`
          };
        } catch (error: any) {
          return {
            success: false,
            error: `Cannot change directory: ${error.message}`
          };
        }
      }

      const { stdout, stderr } = await execAsync(command, {
        cwd: this.currentDirectory,
        timeout,
        maxBuffer: BashTool.DEFAULT_MAX_BUFFER,
      });

      const output = stdout + (stderr ? `\nSTDERR: ${stderr}` : '');
      
      return {
        success: true,
        output: output.trim() || 'Command executed successfully (no output)'
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Command failed: ${error.message}`
      };
    }
  }

  getCurrentDirectory(): string {
    return this.currentDirectory;
  }

  async listFiles(directory: string = '.'): Promise<ToolResult> {
    if (process.platform === "win32") {
      // `dir` is a cmd.exe built-in; exec() runs through the shell on Windows.
      return this.execute(`dir /a "${directory}"`);
    }
    return this.execute(`ls -la "${directory}"`);
  }

  async findFiles(pattern: string, directory: string = '.'): Promise<ToolResult> {
    if (process.platform === "win32") {
      // Use `dir` recursion; pattern can be like *.ts
      const target = `${directory}\\${pattern}`;
      return this.execute(`dir /s /b "${target}"`);
    }
    return this.execute(`find "${directory}" -name "${pattern}" -type f`);
  }

  async grep(pattern: string, files: string = '.'): Promise<ToolResult> {
    if (process.platform === "win32") {
      // Basic recursive search; callers should prefer the dedicated `search` tool for richer behavior.
      const target =
        files === "." ? "*.*" : files;
      return this.execute(`findstr /s /n /i /c:"${pattern}" "${target}"`);
    }
    return this.execute(`grep -r "${pattern}" "${files}"`);
  }
}
