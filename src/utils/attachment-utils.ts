import { promises as fs } from "fs";
import path from "path";
import type { UserContent, UserContentPart } from "../grok/client.js";

export const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;
export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
export const IMAGE_URL_REGEX =
  /https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s]*)?/gi;

export interface PendingImageAttachment {
  imageUrl: string;
  label: string;
}

/**
 * Extract image URLs from text and return them plus cleaned text (URLs removed).
 */
export function parseImageUrlsFromText(
  inputText: string
): { imageUrls: string[]; cleanedText: string } {
  const matches = inputText.match(IMAGE_URL_REGEX) || [];
  const cleanedText = inputText
    .replace(IMAGE_URL_REGEX, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { imageUrls: [...new Set(matches)], cleanedText };
}

/**
 * Build UserContent from user input and pending attachments (images first, then text).
 */
export function buildUserContent(
  userInput: string,
  pendingImageAttachments: PendingImageAttachment[]
): UserContent {
  const { imageUrls, cleanedText } = parseImageUrlsFromText(userInput);
  const parts: UserContentPart[] = [
    ...pendingImageAttachments.map((attachment) => ({
      type: "input_image" as const,
      image_url: attachment.imageUrl,
      detail: "high" as const,
    })),
    ...imageUrls.map((url) => ({
      type: "input_image" as const,
      image_url: url,
      detail: "high" as const,
    })),
  ];

  if (parts.length === 0) {
    return userInput;
  }

  if (cleanedText.length > 0) {
    parts.push({ type: "input_text", text: cleanedText });
  }

  return parts;
}

/**
 * Read a local image file and return a data URL attachment. Validates extension and size.
 */
export async function readLocalImageAsDataUrl(
  filePathArg: string
): Promise<PendingImageAttachment> {
  const unquotedPath = filePathArg.replace(/^["']|["']$/g, "");
  const absolutePath = path.isAbsolute(unquotedPath)
    ? unquotedPath
    : path.resolve(process.cwd(), unquotedPath);
  const extension = path.extname(absolutePath).toLowerCase();

  if (!IMAGE_EXTENSIONS.has(extension)) {
    throw new Error("Only .png, .jpg, and .jpeg files are supported");
  }

  const stats = await fs.stat(absolutePath);
  if (stats.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error("Image must be 20MiB or smaller");
  }

  const imageBuffer = await fs.readFile(absolutePath);
  const mimeType = extension === ".png" ? "image/png" : "image/jpeg";
  const imageUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

  return {
    imageUrl,
    label: path.basename(absolutePath),
  };
}
