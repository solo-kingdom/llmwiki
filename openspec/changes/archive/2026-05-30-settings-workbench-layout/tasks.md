## 1. Layout and Test Baseline

- [x] 1.1 Add or update tests that assert the management workbench shell uses the centered workbench content column for header and page content.
- [x] 1.2 Add or update tests that assert the Wiki reader header and main layout are not constrained to the workbench `max-w-5xl` column.
- [x] 1.3 Add Settings page tests for grouped sections, localized labels, unsaved state, and save feedback.

## 2. Settings Information Architecture

- [x] 2.1 Reorganize Settings content into user-oriented groups for common settings, model/provider connections, workspace rules and MCP, automation/capacity, and version control.
- [x] 2.2 Add clear group titles and descriptions so each section communicates its purpose.
- [x] 2.3 Move low-frequency or expert controls into a visually separated advanced area while keeping them discoverable.
- [x] 2.4 Ensure Provider local actions remain visually distinct from the page-level Settings save action.

## 3. Save Experience

- [x] 3.1 Track whether editable Settings fields differ from the last saved Settings state.
- [x] 3.2 Provide an easy-to-reach page-level save affordance for long Settings pages.
- [x] 3.3 Show unsaved, saving, saved, and error feedback without interfering with local Provider or connection-check actions.
- [x] 3.4 Ensure the save affordance does not obscure final form content on narrow viewports.

## 4. Copy and Responsive Polish

- [x] 4.1 Move remaining user-facing Settings strings into i18n messages.
- [x] 4.2 Replace English-only Settings labels and button text with localized strings.
- [x] 4.3 Make Settings group layouts collapse cleanly on narrow viewports.
- [x] 4.4 Ensure wide previews and JSON editors fit or scroll within the available viewport width.

## 5. Verification

- [x] 5.1 Run frontend tests for navigation, settings, and wiki reader layout.
- [x] 5.2 Run lint/typecheck or the repository's standard frontend verification command.
- [x] 5.3 Manually review Settings, management workbench navigation, and Wiki reader layout at desktop and narrow widths.
