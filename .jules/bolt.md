## 2024-05-20 - Sequential Promise Resolution in Series Download Queues
**Learning:** The previous implementation used a sequential `for...of` loop with `await` to fetch episodes for multiple seasons. This was an obvious N+1 API request bottleneck that scaled poorly as the number of seasons requested increased. Using `Promise.all` dramatically decreases the blocking time for queuing downloads when many seasons exist.
**Action:** Always verify if iterative HTTP requests in webhook pipelines or APIs can be batched or executed concurrently with `Promise.all` to avoid N+1 blocking behavior.

## 2024-05-24 - Missing SQLite Indexes for Webhook Queries
**Learning:** The database uses `seerr_request_id` as the primary lookup mechanism for webhook events (checking if a request exists, updating its status, or deleting it). Without an index on `seerr_request_id`, these queries require full table scans on the `requests` table, which can become a bottleneck as the table grows over time. Adding a simple `CREATE INDEX` sped up simulated lookups by ~5-6x in tests.
**Action:** Always verify that frequently queried fields (especially those used in `WHERE` clauses for `SELECT`, `UPDATE`, or `DELETE`) have appropriate database indexes, even in lightweight SQLite environments.
