# Audiobookshelf Modern UI

`contract/api.ts` and `contract/fixtures.json` are byte-copied from podcast-sponsorblock commit `d3944b747a24a10b06ee90dbaf21a9eb8acec072`.

Standalone Modern UI for stock [Audiobookshelf](https://github.com/advplyr/audiobookshelf) 2.37.1. Derived from Audiobookshelf by advplyr and contributors; original GPL-3.0 license and history retained. Backend and Classic UI are not included.

```sh
bun install --frozen-lockfile
bun dev
```

Production: `docker build -t audiobookshelf-modern-ui .`, then run port 8080 with `ABS_UPSTREAM=https://audiobookshelf.felixfoertsch.de` and `PSB_UPSTREAM=http://podcast-sponsorblock:3000`. `EXTERNAL_SCHEME=https` is trusted deployment configuration; never derive external scheme from browser-supplied forwarded headers. Native authentication, catalog and playback belong to ABS. Analysis/feed augmentation uses same-origin `/psb`. Debug notes use `/debug-api` and SQLite at `/appdata/debug-overlay.sqlite`; mount `/appdata` writable by UID 101. Bun runs the bearer-only admin API on loopback beside nginx, validating access tokens against `http://audiobookshelf:80/api/me`. Debug backend failure does not stop nginx or playback.

Run full Playwright suite against production image plus isolated ABS/sidecar mocks: `e2e/run-container-suite.sh`. Script expects local Docker images `modern-ui-e2e:frontend`, `modern-ui-e2e:abs`, `modern-ui-e2e:psb`, and `modern-ui-e2e:runner`; CI builds these images first. Unit fixture server runs root routes. Proxy contract tests cover login/refresh cookie, Range, WebSocket, reserved namespaces, sidecar 401/503, and item ACL.
