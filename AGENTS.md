# Working Agreement

This repository is the Spatio HRMS phase-1 work-tracking and leave portal.

Before changing code:

1. Read `README.md` and `docs/PHASE_1.md`.
2. Inspect the current git status and preserve unrelated work.
3. Ground the task in the matching issue from the [issue tracker](https://docs.google.com/spreadsheets/d/1LZCCncJ7yVvNWi6MN-k5rkCAItkkmtV6_76l7hVnFnE/edit?gid=0#gid=0).

Implementation rules:

- Work only on the issue the user selected and its necessary dependencies.
- Do not introduce phase-2 or full time-tracking-suite features.
- Preserve old phase-2 source files unless deletion is explicitly requested; keep them unmounted and unroutable.
- Enforce permissions in Supabase RLS, not only in React.
- Never add plaintext credentials, real environment values, or service-role keys to the repository.
- Add focused tests for business rules as the test setup becomes available.
- Verify acceptance criteria before changing an issue to Done.

Current security blockers are `HRMS-003` and `HRMS-004`. The application is not production-safe until they are complete.
