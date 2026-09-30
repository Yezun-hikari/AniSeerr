## 2026-09-28 - Database Index for Requests
**Learning:** Adding an index on `requests(timestamp DESC)` significantly improves the performance of `getRequests()` by allowing faster retrieval and sorting.
**Action:** Always check if frequently queried or sorted columns in database tables have appropriate indexes, especially in large datasets.