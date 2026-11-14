# Database migrations

Add one `NNNN_short_description.sql` file per schema change, numbered after the last file (for example `0001_create_learners.sql`). Files run in name order, each in its own transaction, via `pnpm db:migrate` from the repository root.

Never edit a file that has been applied anywhere: the runner stores each file's checksum and refuses a changed one. Add a new migration instead. Feature issues add their own tables; there is deliberately no up-front schema.
