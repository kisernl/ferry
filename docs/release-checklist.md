# Release checklist — real AWS verification

Run through this before tagging a release. Requires an AWS sandbox account and
a GitHub org/repo you control.

## Deploy

- [ ] `docker compose up` on a fresh VM with Caddy → HTTPS works, `/api/healthz` 200
- [ ] `PUBLIC_URL` mismatch → app refuses to start with readable error
- [ ] Plain `PUBLIC_URL=http://...` (non-localhost) → refused at startup
- [ ] Healthcheck passes; `/data` volume retains SQLite across restarts

## First-run setup

- [ ] Login page renders; GitHub OAuth round-trip succeeds for allowlisted user
- [ ] Non-allowlisted user gets a denied screen + `login.denied` audit entry
- [ ] Setup screen: every check row passes with a scoped IAM policy attached
- [ ] Setup screen: remove IAM permission → corresponding row fails

## Core flows

- [ ] Create project `itproj` + env `staging`; Rescan finds CLI-created keys
- [ ] Paste a 50-line `.env` → preview correct (new/changed/unchanged) → applies < 30s
- [ ] Reveal shows value, auto-hides at 30s, copy button works
- [ ] Download `.env` → re-parses to identical key/value pairs
- [ ] `aws ssm put-parameter` a new key → Rescan picks it up
- [ ] Diff two envs shows statuses only; "reveal both" works for editors
- [ ] History drawer shows versions; restore creates a new version
- [ ] Copy env: keys+values copies fully; keys-only lands as unsaved draft

## Roles & safety

- [ ] Viewer: no reveal button, download/write return 403
- [ ] Restricted editor: writes/reveals to protected env return 403
- [ ] Production write without confirmation → `428`/`X-Confirm` required
- [ ] Delete protected env requires typed confirmation; force-delete removes params
- [ ] Edit with stale version → `409 VERSION_CONFLICT`

## Audit & leaks

- [ ] Reveals, exports, writes, logins appear in audit log; CSV export downloads
- [ ] `grep -r "KNOWN_TEST_VALUE" /data/ferry.db` → no match
- [ ] App logs contain no secret values (`docker logs | grep KNOWN_TEST_VALUE`)
- [ ] CloudTrail shows every SSM call from the instance role/user

## GitHub Actions OIDC

- [ ] All-repos mode: run generated script → workflow job reads secrets from env-scoped role
- [ ] Job on a non-matching branch/environment → AWS denies (`environment:` subject)
- [ ] Selected repos mode: role works for assigned repo, denied for unassigned repo
- [ ] Check endpoint reports pass for each generated role
- [ ] Mode switch generates exactly the needed trust entries — no extras

## Release

- [ ] Tag `vX.Y.Z` → release workflow pushes signed image + SBOM to GHCR
- [ ] `cosign verify ghcr.io/<owner>/ferry:vX.Y.Z` succeeds
- [ ] Fresh `docker run` of the tagged image passes this checklist
