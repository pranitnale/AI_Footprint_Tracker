# Frontend dependency inventory

Verified against the official npm registry metadata on 10 September 2026.

| Package | Pinned version | Use | Registry status checked |
| --- | --- | --- | --- |
| React | 19.3.0 | Website and extension interface | Latest, metadata updated 9 September 2026 |
| React DOM | 19.3.0 | Browser and server-rendered component checks | Latest, metadata updated 9 September 2026 |
| Vite | 8.2.2 | Static website development and build | Latest, metadata updated 7 September 2026; Node `^20.19.0 || >=22.12.0` |
| Testing Library React | 16.3.3 | User-level DOM interaction tests | Latest, metadata updated 27 August 2026; React 18 or 19 |
| Testing Library DOM | 10.4.1 | Accessible DOM queries | Latest, metadata updated 7 August 2026; Node 18 or newer |
| Testing Library user-event | 14.6.7 | Keyboard and form interaction tests | Latest, metadata updated 2 September 2026 |
| jsdom | 29.1.1 | DOM runtime for component tests | Latest release compatible with the workspace's current Node 24.12; jsdom 30 requires Node 24.15 or newer |
| jsdom types | 30.0.0 | Type declarations for the DOM test runtime | Latest, metadata updated 7 August 2026 |
| TypeScript | 5.9.3 | Existing workspace compiler | Retained to avoid a project-wide compiler upgrade during the UI implementation; npm latest was 7.0.2 |
| tsx | 4.23.13 | Existing workspace TypeScript test runner | Retained workspace pin |
| Prettier | 3.9.6 | Reproducible TypeScript, TSX, CSS and JSON formatting | Latest, metadata updated 21 July 2026; Node 14 or newer |

The website does not load external fonts, images, analytics or client libraries at runtime. Vite's React plugin is not needed for the production build because this app does not depend on Fast Refresh or plugin transforms.
