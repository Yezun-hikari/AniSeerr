## 2024-05-20 - Sequential Promise Resolution in Series Download Queues
**Learning:** The previous implementation used a sequential `for...of` loop with `await` to fetch episodes for multiple seasons. This was an obvious N+1 API request bottleneck that scaled poorly as the number of seasons requested increased. Using `Promise.all` dramatically decreases the blocking time for queuing downloads when many seasons exist.
**Action:** Always verify if iterative HTTP requests in webhook pipelines or APIs can be batched or executed concurrently with `Promise.all` to avoid N+1 blocking behavior.
