import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ProcessingTier = "A" | "B" | "C";

export interface ProcessingCapability {
  file_type: string;
  tier: ProcessingTier;
  can_extract: boolean;
  can_chunk: boolean;
  missing_deps?: string[];
  remediation?: string;
}

export class SourceProcessor {
  private readonly dependencies = new Map<string, boolean>();

  constructor() {
    this.probeAll();
  }

  private probeAll(): void {
    this.checkDependency("pdftotext");
    this.checkDependency("libreoffice");
    this.checkDependency("soffice");
  }

  private checkDependency(name: string): boolean {
    const cached = this.dependencies.get(name);
    if (cached !== undefined) return cached;
    const found = lookPath(name);
    this.dependencies.set(name, found);
    return found;
  }

  private hasLibreOffice(): boolean {
    return Boolean(this.dependencies.get("libreoffice") || this.dependencies.get("soffice"));
  }

  getCapabilities(): ProcessingCapability[] {
    return [".md", ".txt", ".pdf", ".docx", ".pptx", ".xlsx"].map((ext) =>
      this.capabilityForExt(ext),
    );
  }

  capabilityForExt(ext: string): ProcessingCapability {
    switch (ext) {
      case ".md":
      case ".txt":
        return { file_type: ext, tier: "A", can_extract: true, can_chunk: true };
      case ".pdf":
        if (this.checkDependency("pdftotext")) {
          return { file_type: ext, tier: "B", can_extract: true, can_chunk: true };
        }
        return {
          file_type: ext,
          tier: "C",
          can_extract: false,
          can_chunk: false,
          missing_deps: ["pdftotext"],
          remediation:
            "Install poppler-utils: apt-get install poppler-utils (Debian/Ubuntu) or brew install poppler (macOS)",
        };
      case ".docx":
      case ".pptx":
      case ".xlsx":
        if (this.hasLibreOffice()) {
          return { file_type: ext, tier: "B", can_extract: true, can_chunk: true };
        }
        return {
          file_type: ext,
          tier: "C",
          can_extract: false,
          can_chunk: false,
          missing_deps: ["libreoffice"],
          remediation:
            "Install LibreOffice: apt-get install libreoffice (Debian/Ubuntu) or brew install libreoffice (macOS)",
        };
      default:
        return {
          file_type: ext,
          tier: "C",
          can_extract: false,
          can_chunk: false,
          remediation: `File type ${ext} is not supported for text extraction`,
        };
    }
  }

  async processSource(filePath: string): Promise<{ content: string; capability: ProcessingCapability }> {
    const ext = path.extname(filePath).toLowerCase();
    const capability = this.capabilityForExt(ext);

    if (capability.tier === "A") {
      const data = await readFile(filePath);
      return { content: data.toString("utf8"), capability };
    }
    if (capability.tier === "B") {
      if (ext === ".pdf") {
        return { content: await this.extractPDF(filePath), capability };
      }
      if (ext === ".docx" || ext === ".pptx" || ext === ".xlsx") {
        return { content: await this.extractOffice(filePath, ext), capability };
      }
      throw new Error(`unsupported tier B file type: ${ext}`);
    }
    return { content: "", capability };
  }

  private async extractPDF(filePath: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync("pdftotext", ["-layout", filePath, "-"]);
      return stdout.trim();
    } catch (error) {
      throw new Error(`pdftotext failed: ${errorMessage(error)}`);
    }
  }

  private async extractOffice(filePath: string, ext: string): Promise<string> {
    const convertTo = ext === ".pptx" ? "html:HTML" : "txt:Text";
    const tempDir = await mkdtemp(path.join(tmpdir(), "llmwiki-office-"));

    try {
      const binary = this.dependencies.get("soffice") && !this.dependencies.get("libreoffice")
        ? "soffice"
        : "libreoffice";
      try {
        await execFileAsync(binary, ["--headless", "--convert-to", convertTo, "--outdir", tempDir, filePath]);
      } catch (error) {
        throw new Error(`libreoffice conversion failed: ${errorMessage(error)}`);
      }

      const base = path.basename(filePath).replace(new RegExp(`${escapeRegExp(ext)}$`), "");
      const outPath = path.join(tempDir, ext === ".pptx" ? `${base}.html` : `${base}.txt`);
      try {
        return (await readFile(outPath, "utf8")).trim();
      } catch (error) {
        throw new Error(`read converted output: ${errorMessage(error)}`);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

function lookPath(name: string): boolean {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    try {
      accessSync(path.join(dir, name), constants.X_OK);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
