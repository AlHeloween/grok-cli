import { execSync } from "child_process";
import { platform } from "os";
import { tmpdir } from "os";
import { join } from "path";
import { readFileSync, existsSync, unlinkSync, writeFileSync } from "fs";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

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
