## 1. Backend: public read-only wiki boundary

- [x] 1.1 Add a server-level public wiki configuration flag, defaulting to disabled.
- [x] 1.2 Add `/api/public/wiki/documents` for listing public wiki documents with a safe response model.
- [x] 1.3 Add `/api/public/wiki/documents/{id}` for reading a single public wiki document with content.
- [x] 1.4 Add `/api/public/wiki/search` if existing Wiki search is available in the reader UI.
- [x] 1.5 Update auth middleware or route mounting so public wiki endpoints can be reached without management token only when public wiki is enabled.
- [x] 1.6 Add backend tests covering public disabled, public enabled, and private management API still protected by token.

## 2. Frontend: separate reader and workbench shells

- [x] 2.1 Split the current `App.tsx` composition into a Wiki reader layout and a management workbench layout.
- [x] 2.2 Route `/wiki` and supported Wiki document URLs to the reader layout.
- [x] 2.3 Keep `Ingest`, `Jobs`, and `Settings` inside the workbench layout; expose Wiki as a reader link rather than a peer management tab.
- [x] 2.4 Ensure the Wiki reader can load documents through public read-only API when public mode is used.
- [x] 2.5 Preserve existing management-page behavior for ingest chat, jobs, and settings.

## 3. Frontend: mdserve-inspired reader UI polish

- [x] 3.1 Update Wiki reader header to use the compact rounded card style inspired by `mdserve`.
- [x] 3.2 Convert Wiki content area to a card-based three-column layout: file tree, document card, outline.
- [x] 3.3 Add desktop collapse/expand affordances for the file tree and outline panels.
- [x] 3.4 Add mobile affordances for opening file tree and outline without compressing the article.
- [x] 3.5 Add a document info bar using point color for path/type/page count/update time/tags.
- [x] 3.6 Add Markdown and scrollbar CSS polish based on `mdserve` patterns while preserving existing Tailwind/shadcn tokens.
- [x] 3.7 Ensure wikilinks and heading anchors still work after layout and scroll-container changes.

## 4. Tests and validation

- [x] 4.1 Update or add frontend tests for navigation shell separation and Wiki reader rendering.
- [x] 4.2 Update integration tests that assumed Wiki was a top-level management tab.
- [x] 4.3 Run Go tests for API/auth behavior.
- [x] 4.4 Run frontend lint/build/tests.
- [x] 4.5 Manually verify private mode, public mode, desktop layout, and mobile layout.
