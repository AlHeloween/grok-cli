import { execFile, execSync } from "child_process";
import { platform } from "os";
import { tmpdir } from "os";
import { join } from "path";
import { readFileSync, existsSync, unlinkSync, writeFileSync } from "fs";
import { promises as fsp } from "fs";
import { promisify } from "util";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const execFileAsync = promisify(execFile);

/** Result of reading an image from the clipboard (MIME type and base64 data). */
export interface ClipboardImageResult {
  mimeType: string;
  base64: string;
}

/**
 * Synchronously read an image from the system clipboard, if present.
 * Returns null when clipboard has no image, platform is unsupported, or size exceeds 20MiB.
 * On Linux, image paste may require xclip (X11) or wl-paste (Wayland).
 */
export function getClipboardImageSync(): ClipboardImageResult | null {
  try {
    const plat = platform();
    if (plat === "win32") {
      return getClipboardImageWindows();
    }
    if (plat === "darwin") {
      return getClipboardImageMacOS();
    }
    if (plat === "linux") {
      return getClipboardImageLinux();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Asynchronously read an image from the system clipboard, if present.
 * Resolves with null when clipboard has no image, platform is unsupported, or size exceeds 20MiB.
 * Use this to avoid blocking the main thread on paste (e.g. only swallow paste when an image is found).
 *
 * IMPORTANT: This is a real async implementation (child process + async fs). It should never throw;
 * failures/timeouts resolve to null so callers can fall back to treating paste as text.
 */
export function getClipboardImage(): Promise<ClipboardImageResult | null> {
  return getClipboardImageAsync().catch(() => null);
}

function getClipboardImageWindows(): ClipboardImageResult | null {
  const scriptPath = join(tmpdir(), `grok-clipboard-${Date.now()}.ps1`);
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$img = [System.Windows.Forms.Clipboard]::GetImage()",
    "if (-not $img) { exit 1 }",
    "$ms = New-Object System.IO.MemoryStream",
    "$img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)",
    "$bytes = $ms.ToArray()",
    "$ms.Dispose()",
    "[Convert]::ToBase64String($bytes)",
  ].join("\n");
  try {
    writeFileSync(scriptPath, script, "utf-8");
    const out = execSync(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ${JSON.stringify(scriptPath)}`,
      {
      encoding: "utf-8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 10000,
      }
    );
    let base64 = (out || "").trim();
    if (base64 && base64.charCodeAt(0) === 0xfeff) base64 = base64.slice(1);
    if (!base64) return null;
    const sizeBytes = Math.ceil((base64.length * 3) / 4);
    if (sizeBytes > MAX_IMAGE_BYTES) return null;
    return { mimeType: "image/png", base64 };
  } catch {
    return null;
  } finally {
    try {
      if (existsSync(scriptPath)) unlinkSync(scriptPath);
    } catch {}
  }
}

async function getClipboardImageAsync(): Promise<ClipboardImageResult | null> {
  try {
    const plat = platform();
    if (plat === "win32") {
      return await getClipboardImageWindowsAsync();
    }
    if (plat === "darwin") {
      return await getClipboardImageMacOSAsync();
    }
    if (plat === "linux") {
      return await getClipboardImageLinuxAsync();
    }
    return null;
  } catch {
    return null;
  }
}

async function getClipboardImageWindowsAsync(): Promise<ClipboardImageResult | null> {
  const scriptPath = join(tmpdir(), `grok-clipboard-${Date.now()}.ps1`);
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$img = [System.Windows.Forms.Clipboard]::GetImage()",
    "if (-not $img) { exit 1 }",
    "$ms = New-Object System.IO.MemoryStream",
    "$img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)",
    "$bytes = $ms.ToArray()",
    "$ms.Dispose()",
    "[Convert]::ToBase64String($bytes)",
  ].join("\n");

  try {
    await fsp.writeFile(scriptPath, script, "utf-8");

    const { stdout } = await execFileAsync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-STA",
        "-File",
        scriptPath,
      ],
      {
        encoding: "utf-8",
        maxBuffer: 48 * 1024 * 1024,
        timeout: 10_000,
        windowsHide: true,
      }
    );

    let base64 = (stdout || "").trim();
    if (base64 && base64.charCodeAt(0) === 0xfeff) base64 = base64.slice(1);
    if (!base64) return null;
    const sizeBytes = Math.ceil((base64.length * 3) / 4);
    if (sizeBytes > MAX_IMAGE_BYTES) return null;
    return { mimeType: "image/png", base64 };
  } catch {
    return null;
  } finally {
    try {
      await fsp.unlink(scriptPath);
    } catch {}
  }
}

async function getClipboardImageMacOSAsync(): Promise<ClipboardImageResult | null> {
  const tmpFile = join(tmpdir(), `grok-clipboard-${Date.now()}.png`);
  const pathArg = JSON.stringify(tmpFile);
  const script = `set p to ${pathArg}
set f to open for access POSIX file p with write permission
try
  write (the clipboard as «class PNGf») to f
end try
close access f`;

  try {
    // Ensure the file path is writable/created.
    await fsp.writeFile(tmpFile, Buffer.alloc(0));

    await execFileAsync("osascript", ["-e", script], {
      encoding: "utf-8",
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    });

    const stat = await fsp.stat(tmpFile).catch(() => null);
    if (!stat || stat.size === 0 || stat.size > MAX_IMAGE_BYTES) return null;
    const buf = await fsp.readFile(tmpFile);
    return { mimeType: "image/png", base64: buf.toString("base64") };
  } catch {
    return null;
  } finally {
    try {
      await fsp.unlink(tmpFile);
    } catch {}
  }
}

async function getClipboardImageLinuxAsync(): Promise<ClipboardImageResult | null> {
  const opts = {
    encoding: "buffer" as const,
    maxBuffer: MAX_IMAGE_BYTES + 1024,
    timeout: 5_000,
    windowsHide: true,
  };

  const tryExec = async (
    cmd: string,
    args: string[],
    mimeType: "image/png" | "image/jpeg"
  ): Promise<ClipboardImageResult | null> => {
    try {
      const { stdout } = await execFileAsync(cmd, args, opts as any);
      const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout as any);
      if (!buf || buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
      return { mimeType, base64: buf.toString("base64") };
    } catch {
      return null;
    }
  };

  return (
    (await tryExec("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"], "image/png")) ??
    (await tryExec("xclip", ["-selection", "clipboard", "-t", "image/jpeg", "-o"], "image/jpeg")) ??
    (await tryExec("wl-paste", ["-t", "image/png"], "image/png")) ??
    (await tryExec("wl-paste", ["-t", "image/jpeg"], "image/jpeg")) ??
    null
  );
}

function getClipboardImageMacOS(): ClipboardImageResult | null {
  const tmpFile = join(tmpdir(), `grok-clipboard-${Date.now()}.png`);
  writeFileSync(tmpFile, Buffer.alloc(0));
  const pathArg = JSON.stringify(tmpFile);
  const script = `set p to ${pathArg}
set f to open for access POSIX file p with write permission
try
  write (the clipboard as «class PNGf») to f
end try
close access f`;
  try {
    execSync(`osascript -e ${JSON.stringify(script)}`, {
      encoding: "utf-8",
      timeout: 5000,
    });
    if (!existsSync(tmpFile)) return null;
    const buf = readFileSync(tmpFile);
    unlinkSync(tmpFile);
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
    return { mimeType: "image/png", base64: buf.toString("base64") };
  } catch {
    try {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    } catch {}
    return null;
  }
}

function getClipboardImageLinux(): ClipboardImageResult | null {
  const opts = {
    encoding: "buffer" as const,
    maxBuffer: MAX_IMAGE_BYTES + 1024,
    timeout: 5000,
  };

  const tryXclip = (mimeType: "image/png" | "image/jpeg"): ClipboardImageResult | null => {
    try {
      const out = execSync(
        `xclip -selection clipboard -t ${mimeType} -o 2>/dev/null`,
        opts
      );
      const buf = Buffer.isBuffer(out) ? out : Buffer.from(out);
      if (!buf || buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
      return { mimeType, base64: buf.toString("base64") };
    } catch {
      return null;
    }
  };

  const tryWlPaste = (mimeType: "image/png" | "image/jpeg"): ClipboardImageResult | null => {
    try {
      const out = execSync(`wl-paste -t ${mimeType} 2>/dev/null`, opts);
      const buf = Buffer.isBuffer(out) ? out : Buffer.from(out);
      if (!buf || buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
      return { mimeType, base64: buf.toString("base64") };
    } catch {
      return null;
    }
  };

  return (
    tryXclip("image/png") ??
    tryXclip("image/jpeg") ??
    tryWlPaste("image/png") ??
    tryWlPaste("image/jpeg") ??
    null
  );
}
