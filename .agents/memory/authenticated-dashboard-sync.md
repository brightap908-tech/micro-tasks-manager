---
name: Authenticated dashboard sync
description: Durable constraint for syncing authenticated, JavaScript-rendered microtask dashboards.
---

Use the same Playwright-based authenticated browser context used during login when reading a dashboard. Forwarding saved cookies through a plain HTTP client is not sufficient for pages whose values are rendered after JavaScript runs.

**Why:** A successful HTTP response can contain only the app shell, causing regex extraction to return no values while the sync flow incorrectly reports success.

**How to apply:** Capture the final browser URL and dashboard HTML, verify each metric selector, log extracted values before persistence, and treat a sync as successful only when at least one metric was extracted.