# Approved job fixtures

Approved job vacancies for ingestion, grounding career guidance, and testing
status filtering (T3-019-A).

## Included fixtures

- `demo-va-specialist.json`: an active, open administrative position located in Addis Ababa (`job-va-specialist-01`).
- `demo-expired-data-clerk.json`: an expired position with `expiresAt` in the past (`job-data-clerk-02`), used to verify that expired vacancies are not presented as active.

## Usage

```sh
pnpm db:migrate
pnpm jobs:import               # imports every .json file in this directory
pnpm jobs:import path/to/file  # imports specific job file(s)
```
