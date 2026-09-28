## 2024-05-20 - Sequential Promise Resolution in Series Download Queues
**Learning:** The previous implementation used a sequential `for...of` loop with `await` to fetch episodes for multiple seasons. This was an obvious N+1 API request bottleneck that scaled poorly as the number of seasons requested increased. Using `Promise.all` dramatically decreases the blocking time for queuing downloads when many seasons exist.
**Action:** Always verify if iterative HTTP requests in webhook pipelines or APIs can be batched or executed concurrently with `Promise.all` to avoid N+1 blocking behavior.

## 2024-05-24 - Missing SQLite Indexes for Webhook Queries
**Learning:** The database uses `seerr_request_id` as the primary lookup mechanism for webhook events (checking if a request exists, updating its status, or deleting it). Without an index on `seerr_request_id`, these queries require full table scans on the `requests` table, which can become a bottleneck as the table grows over time. Adding a simple `CREATE INDEX` sped up simulated lookups by ~5-6x in tests.
**Action:** Always verify that frequently queried fields (especially those used in `WHERE` clauses for `SELECT`, `UPDATE`, or `DELETE`) have appropriate database indexes, even in lightweight SQLite environments.

## 2024-05-20 - API Client Memoization & Connection Pooling
**Learning:** In Node.js applications making multiple sequential requests to the same external API (e.g., searching, fetching episodes, queuing downloads), creating a new Axios instance for every webhook without Keep-Alive discards connection pools. This causes costly TCP/TLS handshakes for every single request, significantly slowing down webhook processing. Additionally, frequently accessed single-row configurations like `settings` cause redundant database I/O.
**Action:** Memoize the Axios client instance based on connection settings, explicitly configure `httpAgent` and `httpsAgent` with `keepAlive: true` to reuse connections, and cache frequently read database configuration in memory.

## 2024-05-24 - Database I/O Overhead in Settings Lookups
**Learning:** In Node.js applications using SQLite, querying the same table repeatedly for configuration data (like `getSettings()`) introduces unnecessary I/O overhead. This is especially true when settings are read frequently but updated rarely.
**Action:** Always consider memoizing or caching database queries for application-wide configuration data to improve performance, ensuring proper cache invalidation on updates.
