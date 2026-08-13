# P4-SESSIONS-DOMAINS

Status: **READY**  
Class: **implementation-ready**  
Phase: **4**

## Goal

Finish the exact inventory and bounded repository/importer/shadow work for sessions and other remaining transactional domain state required by ADR-0003.

## Owns

- exact remaining-domain inventory
- current reader/writer/transaction-boundary map
- domain repository interfaces/implementations where prerequisites are already stable
- legacy compatibility/import fixtures
- shadow comparison fixtures where appropriate
- proposed schema additions documented for integration

## Required output

For every domain considered, report:

- why it is domain state or why it is intentionally filesystem/runtime state;
- current readers/writers;
- required transaction boundary;
- compatibility/import rules;
- repository/shadow coverage;
- shared schema requirement;
- residual work.

## Does not own

- global SQLite schema/version ordering
- central helper/CLI composition
- process/runtime ownership state that ADR-0003 intentionally keeps on the filesystem
- canonical roadmap/registry/progress/handoff

## Required verification

- domain-specific import/repository/shadow tests
- transaction/idempotency cases
- architecture/type/lint/format gates relevant to touched code
- exact-head hosted Verify before recommending integration

## Return to orchestrator

Report exact base/head, draft PR, final domain inventory, changed paths, proposed shared-schema additions, invariant review, verification, and any domain that should be split into another workstream.
