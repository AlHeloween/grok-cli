import * as fs from "fs";
import * as path from "path";
import { PDFParse } from "pdf-parse";
import * as mammoth from "mammoth";
import * as XLSX from "xlsx";
import * as cheerio from "cheerio";
// xml2js not used yet, keep for future

export async function extractText(
  filePath: string,
  maxBytes?: number
): Promise<string | null> {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = await fs.promises.readFile(filePath);
  // Apply maxBytes limit
  let data = buffer;
  if (maxBytes && data.length > maxBytes) {
    data = data.subarray(0, maxBytes);
  }

  try {
    switch (ext) {
      case ".pdf":
        return await extractPdf(data);
      case ".docx":
        return await extractDocx(data);
      case ".xlsx":
      case ".xls":
        return await extractExcel(data);
      case ".pptx":
      case ".ppt":
        // PowerPoint not yet supported; fallback to null
        return null;
      case ".html":
      case ".htm":
        return extractHtml(data);
      case ".xml":
        return extractXml(data);
      default:
        // For plain text files, decode as UTF-8 with fallback
        return decodeText(data);
    }
  } catch (error) {
    console.warn(`[RAG extractor] Failed to extract ${filePath}:`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function extractPdf(data: Buffer): Promise<string> {
  const parser = new PDFParse({ data });
  const result = await parser.getText();
  return result.text;
}

async function extractDocx(data: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: data });
  return result.value;
}

async function extractExcel(data: Buffer): Promise<string> {
  const workbook = XLSX.read(data, { type: "buffer" });
  let text = "";
  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const sheetText = XLSX.utils.sheet_to_csv(worksheet, { FS: " ", RS: "\n" });
    text += sheetText + "\n";
  });
  return text.trim();
}

function extractHtml(data: Buffer): string {
  const html = decodeText(data);
  const $ = cheerio.load(html);
  // Remove script and style tags
  $("script, style").remove();
  return $("body").text() || $.text();
}

function extractXml(data: Buffer): string {
  const xml = decodeText(data);
  // Simple stripping of tags; could be improved with xml2js
  // For now, just strip tags and return text content
  return xml.replace(/<[^>]*>/g, " ");
}

function decodeText(data: Buffer): string {
  // Try UTF-8, fallback to latin1
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return data.toString("latin1");
  }
}

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/rag/extractors.ts"
//   "update_script": "adm.exe"
//   "backup_path": "D:\\zPython\\grok-cli\\src/rag/extractors.ts.backup_20260227T211414_561347"
//   "created_at": "2026-02-27T13:14:14.571795+00:00"
//   "backup_hash": "790bdf38b1bf87fba10ebe3ac9ea9714"
//   "new_hash": "c3d96937d7f0b27365f17fbb99355b42"
//   "goal_id": "update_extract_pdf_function"
//   "semantics": "Update extractPdf to use PDFParse class with getText method."
//   "update_attrs": {"relative_path": "src/rag/extractors.ts", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "async function extractPdf(data: Buffer): Promise<string> {\n  const pdfData = await pdfParse(data);\n  return pdfData.text;\n}", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/rag/extractors.ts\""
// }
