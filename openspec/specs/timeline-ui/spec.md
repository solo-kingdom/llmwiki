# timeline-ui

## Purpose

Expose revision history in the web UI.

## Requirements

### Requirement: History list

The timeline page SHALL list change sets from `GET /api/v1/history`, showing kind, summary, page count and timestamp. Selecting a change set SHALL load `GET /api/v1/history/{id}` and render its diff from `GET /api/v1/history/{id}/diff`.

### Requirement: Rollback action

The page SHALL offer rollback via `POST /api/v1/history/{id}/rollback` and show the queued job id. Git terminology (commit, remote, push, backup) SHALL NOT appear.

### Requirement: Route parameter

Deep links SHALL use `?change=<change_set_id>`; the legacy `?commit=` parameter SHALL NOT be produced.
