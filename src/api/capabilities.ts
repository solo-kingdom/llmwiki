import type { Context } from "hono";
import { SourceProcessor } from "../engine/processor.js";
import { writeJson } from "./context.js";

const MIME_TYPES: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

let sourceProcessor: SourceProcessor | null = null;

function capabilities() {
  if (!sourceProcessor) sourceProcessor = new SourceProcessor();
  const procCaps = sourceProcessor.getCapabilities();
  const fileTypes = procCaps.map((cap) => ({
    extension: cap.file_type,
    mime_type: MIME_TYPES[cap.file_type] ?? "",
    tier: cap.tier,
    can_extract: cap.can_extract,
    can_chunk: cap.can_chunk,
    missing_deps: cap.missing_deps,
    remediation: cap.remediation,
  }));

  const deps = [
    { name: "pdftotext", found: false, purpose: "PDF text extraction (Tier B for .pdf)" },
    {
      name: "libreoffice",
      found: false,
      purpose: "Office document conversion (Tier B for .docx/.pptx/.xlsx)",
    },
  ];
  for (const dep of deps) {
    for (const cap of procCaps) {
      if (cap.missing_deps?.includes(dep.name)) dep.found = false;
      if (
        cap.tier === "B" &&
        ((cap.file_type === ".pdf" && dep.name === "pdftotext") ||
          (cap.file_type !== ".pdf" && dep.name === "libreoffice"))
      ) {
        dep.found = true;
      }
    }
  }

  return {
    file_types: fileTypes,
    processing_tiers: [
      { name: "A", description: "Built-in text extraction (markdown, plain text)" },
      { name: "B", description: "Optional system dependency extraction (pdftotext, LibreOffice)" },
      { name: "C", description: "Degraded fallback — file type recognized but extraction unavailable" },
    ],
    runtime_dependencies: deps,
    access_model: "rpc-first",
  };
}

export function capabilitiesApi() {
  return {
    async getCapabilities(c: Context): Promise<Response> {
      return writeJson(c, 200, capabilities());
    },
  };
}
