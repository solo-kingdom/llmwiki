## FAQ

**Q: Where is my data stored?**  
A: Pages, history and search indexes live in PostgreSQL. Use `llmwiki export` for a Markdown copy, or point `init` at a workspace directory to import one.

**Q: Are UI language and generated doc language the same?**  
A: Not necessarily. **Settings** → `ui_language` vs `doc_language`.

**Q: PDF / Office extraction fails?**  
A: Check **Settings** or `GET /api/v1/capabilities` for processing tier; Tier B may need `pdftotext` or LibreOffice.

**Q: Chinese search broken after upgrade?**  
A: Run `llmwiki reindex` once after pulling CJK search improvements.

**Q: Where do Web-submitted materials go?**  
A: Persisted under `raw/sources/web-ingest/` before entering the ingest pipeline.
