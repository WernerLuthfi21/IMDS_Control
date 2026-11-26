# Tracker Stage 9A review

Implementation under test is `77e53667a1b44c1ab9d8f59b0877c36cb8e89b48`. All captures use synthetic records. The source contains 10 rows and produces 7 active parts after classification and deduplication. Four submitted parts produce 57% progress.

| View | Legacy Light | React Light | Legacy Dark | React Dark |
| --- | --- | --- | --- | --- |
| Overview | [Screenshot](legacy-overview-light.png) | [Screenshot](react-overview-light.png) | [Screenshot](legacy-overview-dark.png) | [Screenshot](react-overview-dark.png) |
| Model Tracker | [Screenshot](legacy-models-light.png) | [Screenshot](react-models-light.png) | [Screenshot](legacy-models-dark.png) | [Screenshot](react-models-dark.png) |

| Additional captures | Light | Dark |
| --- | --- | --- |
| Model Tracker at 390px | [Screenshot](react-models-light-mobile.png) | [Screenshot](react-models-dark-mobile.png) |
| Authenticated viewer | [Screenshot](authenticated-viewer-light.png) | [Screenshot](authenticated-viewer-dark.png) |
| Authenticated preparer | [Screenshot](authenticated-preparer-light.png) | [Screenshot](authenticated-preparer-dark.png) |

The Chromium parity tests compare KPI text, model order, priority suppliers and scoped supplier breakdown between both renderers. They check text contrast in both themes, page overflow at 768px and 390px, and scoped legacy handoffs. A separate local read-only HTTP fixture exercised the protected routes on a production build. Signed-out requests redirected and the data API returned 401. A supplier reached Self-check and received 403 from the data API. Viewer and preparer sessions returned 200 and then 304 on a conditional read and displayed the same 57% result in both interfaces.

See the [per-view register and cutover gates](../../TRACKER-MIGRATION-FOUNDATION.md).
