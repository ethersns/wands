<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## WANDS RULE 001 — FULL-STACK FEATURE VISIBILITY

A feature is not complete because the backend implements it. A capability that a
customer cannot find, open and use does not exist as far as the product is
concerned, and a capability the website describes but the software does not
deliver is a false claim.

Every customer-facing feature must have all five of these before it is called
shipped:

1. **Implemented, tested backend capability.** Real code, real tests, no
   fixtures standing in for production data.
2. **A functioning, discoverable member interface.** A route under `app/app/`
   that a signed-in member can reach, plus an entry in
   `components/member/member-shell.tsx` when it is a top-level destination.
3. **Accurate public representation** where the marketing site mentions it.
4. **A truthful availability status** — see the states below. Never describe a
   planned, disabled or operator-only capability as generally available.
5. **End-to-end verification against the actual implementation**, not against a
   mock.

### Required report for every feature

- Backend implementation path
- API route or data contract
- Frontend route and navigation entry
- Public website location, if relevant
- Availability status
- Test coverage
- Remaining blockers

### Availability states

Use exactly one of these, and base it on code and verification, never on
marketing copy:

| State | Meaning |
| --- | --- |
| `production-verified` | Deployed, reachable, exercised against real data |
| `local-verified` | Implemented and passing tests locally; not deployed |
| `missing-frontend` | Backend works; no member route or no navigation entry |
| `partial` | Some of the capability is implemented |
| `planned` | Designed, not implemented |
| `blocked` | Cannot proceed without data, infrastructure or a credential |

### Exceptions

Internal security, administration and infrastructure components are exempt from
public marketing visibility, but still need operator-facing observability. Do
not publish implementation details, security controls or operator-only
functionality.

### Where this is maintained

`docs/feature-inventory.md` holds the current inventory and the completion
checklist. Update it in the same change that adds or alters a customer-facing
capability. A backend-only change that adds a member capability is not finished
until the inventory row and the member route both exist.

### Do not

- Claim a backend-only feature is fully shipped.
- Populate research metrics with fabricated or illustrative events.
- Add a member route that reaches an operator endpoint, or borrow the operator
  token for a member request.
- Present a `null` as `0`, or an ingestion outage as "no activity".
