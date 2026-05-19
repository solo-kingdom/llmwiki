# Source Processing Enhancement Roadmap (Post-V1)

This document captures the forward enhancement path for source processing beyond the first release baseline tiers.

## Current V1 Baseline (Tier A/B/C)

| Tier | Description | File Types |
|------|-------------|------------|
| **A** | Built-in text extraction | `.md`, `.txt` |
| **B** | Optional system dependency | `.pdf` (pdftotext), `.docx/.pptx/.xlsx` (LibreOffice) |
| **C** | Degraded fallback | Recognized but unavailable formats |

## Planned Enhancements

### Phase 2: Improved PDF Processing

- **OCR support**: Integrate Tesseract OCR for scanned PDFs
  - Dependency: `tesseract-ocr` system package
  - New tier: Tier B+ (pdftotext + OCR fallback)
  - Impact: Enables extraction from image-based PDFs
- **PDF table extraction**: Use `camelot` or `tabula-py` for structured table extraction
  - Dependency: Python 3 + camelot/tabula
  - New tier: Tier B+ with table awareness

### Phase 3: Office Document Fidelity

- **PPTX native parsing**: Parse PowerPoint XML directly without LibreOffice conversion
  - Removes optional system dependency for .pptx
  - Enables slide-level extraction and metadata
- **XLSX native parsing**: Parse Excel XML for structured data extraction
  - Row/column aware chunking for spreadsheet data
- **DOCX native parsing**: Direct XML extraction for Word documents
  - Preserves headings, styles, and document structure

### Phase 4: Rich Media Processing

- **Image OCR**: Tesseract or cloud OCR for image files (.png, .jpg, .tiff)
- **Audio transcription**: Whisper-based transcription for audio sources
- **Video frame extraction**: Key frame extraction with OCR for presentation videos

### Phase 5: Cloud-Enhanced Processing

- **Cloud Vision API**: For high-fidelity OCR at scale
- **Cloud document conversion**: For format-agnostic processing
- **LLM-based extraction**: Use LLM to extract structured knowledge from complex documents

## Extension Points

The `SourceProcessor` in `internal/engine/processor.go` is designed for extensibility:

1. **New file types**: Add entries to `capabilityForExt()` and `ProcessSource()`
2. **New tiers**: Define new `ProcessingTier` constants between B and C
3. **New dependencies**: Add probes in `probeAll()` and handlers in `processTierB()`
4. **Degradation hints**: Update `Remediation` field in `ProcessingCapability`

## Monitoring

Current processing tier is exposed via:
- **API**: `GET /api/v1/capabilities` returns tier status per file type
- **Logs**: Startup log shows `[source-processing]` entries for each file type and dependency status
- **Structured fallback**: When degradation occurs, response payloads include `missing_deps` and `remediation` fields
