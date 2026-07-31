# P0-05 Barback Outbox No-Silent-Loss Local Validation

## Summary

- Finding: P0-05
- Branch: `fix/p0-barback-outbox-no-silent-loss-v1`
- Starting commit: `7ccb87e9290cc9bb3d18c754f59c7ee65f077d0e`
- Result: PASS for scoped local implementation and tests
- Production commands: none
- Database, migration, Edge Function, iOS, and BARINV.ca changes: none

## Root Cause

`Outbox.save()` caught a `localStorage` write failure, retried with only the
newest half of the queue, and returned no failure result. Callers therefore
continued as if the full queue was durable. Depending on the caller, the page
could report an Event as queued, remove its Review draft, or report a queue
edit/delete as successful after persistence had failed.

Review drafts had the same false-success shape: their storage helper logged a
write failure but returned no result, so Add to Review could clear the form even
though the draft was not durable.

## Implementation

`barback.html` now:

- writes and reads back the complete serialized queue before reporting success;
- never truncates, evicts, or purges queue entries to recover storage space;
- leaves the previously durable queue byte-for-byte unchanged after a failed
  write;
- keeps the first failed new outbox or Review-draft row in memory so it remains
  visible and exportable while the page stays open;
- blocks further additions while an in-memory-only row exists;
- shows a persistent blocking banner and one alert instructing the operator not
  to close/reload, to take a screenshot, download Queue Backup, and call the
  manager;
- removes a Review draft only after the complete outbox write is verified;
- stops queue/draft edit, delete, undo, and sync cleanup success paths when their
  persistence write fails;
- records Recent QUEUED state only after verified outbox persistence;
- moves stale rows only after the complete quarantine copy and reduced outbox
  are both verified, and alerts the operator when that move occurs;
- includes Review drafts and stale quarantine entries in Queue Backup.

Login, logout, session restore, and session refresh do not clear the outbox.
The explicit operator-confirmed queue delete behavior remains available.

## Files

- `barback.html`
- `tests/barback-outbox-durability.test.cjs`
- `docs/P0_05_BARBACK_OUTBOX_NO_SILENT_LOSS_LOCAL_VALIDATION_20260730.md`

No migration or rollback file was created or modified.

## Focused Test Matrix

Command:

```text
node --test tests/barback-outbox-durability.test.cjs
```

Result: 11 passed, 0 failed.

Covered:

1. Normal complete queue persistence and readback.
2. Quota failure preserves durable rows and the failed addition in memory.
3. Failed queue edit/delete preserves row identity and values.
4. Storage recovery persists the complete in-memory queue.
5. Review-draft quota failure is blocking and preserves the failed draft.
6. Submit All persists outbox before removing a draft.
7. Submit All retains the draft and does not sync after outbox failure.
8. Login/logout/session restore do not purge the queue.
9. Failed stale-quarantine write preserves every active row.
10. Successful stale quarantine keeps a complete verified copy and alerts.
11. No truncation fallback remains and recovery UI/backup fields exist.

## Syntax And Regression Results

- `barback.html` inline JavaScript syntax: PASS, one inline script compiled.
- Focused P0-05 tests: PASS, 11/11.
- Relevant Barback regression set excluding the stale migration-count assertion:
  PASS, 106/106.
- Full `tests/barback-*.test.cjs` run: 140 passed, 1 failed.

The single failure is unrelated to P0-05:
`tests/barback-scope-session-security.test.cjs` test 33 hard-codes an expected
migration count of 89. The current committed starting HEAD already contains 95
migrations. P0-05 changes no migration files. All functional Barback tests in
that run passed.

## Safety And Residual Limitation

When browser storage is unavailable, no web page can guarantee persistence
across a browser/process termination. This fix retains the first failed row in
memory, makes the failure blocking and visible, prevents further additions, and
provides an immediate backup export path. The operator must keep the page open
until the queue syncs, persistence recovers, or a Queue Backup is downloaded.

Manual mobile quota-pressure QA on iPhone Safari and Android Chrome remains a
release verification step. No Production Event was created or changed.

## Conclusion

P0-05 is ready for owner review and local commit approval. A later web release
would require separate explicit approval for push and deployment.
