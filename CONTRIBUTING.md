# Contributing

Thanks for helping improve Codex Mobile.

## Local workflow

1. Use Node 22.
2. Run `npm install`.
3. Create a local config with `npm run setup:config`.
4. Run `npm run doctor` to check your environment.
5. Run `npm run dev` for local development.
6. Run `npm test` and `npm run build` before opening a PR.

## Ground rules

- Keep the app local-first.
- Do not add any flow that requires the phone browser to manage Codex auth tokens.
- Keep folder access whitelisted and explicit.
- Prefer Codex App Server when possible; keep CLI fallback graceful.
- Document security tradeoffs clearly in the README when changing auth, networking, or approvals.

## Pull requests

- Include a concise summary and testing notes.
- If the change affects pairing, approvals, project validation, or network exposure, call that out explicitly.
