# Submission package — CALL-E Code Commander

Target track: **Most Practical Use Case ($4,000)**. Deadline: **14 September 2026, 11:45 pm SGT**.

Everything below is ready to paste. Work top to bottom.

---

## Before you submit

First, confirm `.env` at the project root has your key and your rota:

```bash
CALLE_API_KEY=iams_live_...
CALLE_ROTA_PRIMARY_NAME=Ajay Mishra
CALLE_ROTA_PRIMARY_PHONE=+918319348794
```

`.env` is gitignored, so neither the key nor the number is committed or shipped in the pull request. `.env.example` carries placeholders only, and `npm test` and `npm run sync` both fail if a live key ever appears in a committed file.

Then run these four commands. Do not record the video until all four pass.

```bash
npm test                          # 35 tests, no credits
node scripts/verifyLiveCall.js    # one real call to +918319348794
npm run dev                       # reads .env, prints mode and seeded rota
npm run sync                      # refresh the PR directory, run this last
```

With no arguments the verification script reads the key and the rung 1 contact from `.env`, so it dials the same destination the app would. It exits non-zero if CALL-E did not return a structured decision. If that happens, the demo will fail too, so fix it first.

Give the backup rung a second number you control before recording the escalation part of the video. Either add `CALLE_ROTA_BACKUP_PHONE` to `.env` or type it into the dialog.

---

## 1. The pull request

**Fork** `https://github.com/CALLE-AI/awesome-phone-call-agents`, then copy `apps/typescript/call-e-code-commander/` from this project into the same path in your fork. Running `npm run sync` regenerates that directory from the working tree, so run it last.

**Add to the root `README.md`** under `### Apps`:

```markdown
- [CALL-E Code Commander](apps/typescript/call-e-code-commander/) - On-call escalation commander that phones engineers, explains the incident conversationally, and returns their spoken decision as typed JSON that gates the deploy.
```

**PR title:**

```text
Add CALL-E Code Commander: on-call escalation with structured spoken authorisation
```

**PR description:**

```markdown
### Summary

Adds **CALL-E Code Commander**, an on-call escalation commander for production incidents.

When a service breaks, an automated council investigates, stages a hotfix, and proves it green in a sandbox. Then it stops. Nothing reaches production until CALL-E has phoned a human, explained the incident in conversation, answered their questions, and extracted an explicit spoken decision as typed JSON.

If the primary on-call does not answer, the ladder climbs to the backup and then the manager, telling each person why they are being woken instead of the previous rung.

### Contribution area

- `apps/typescript/call-e-code-commander`

### CALL-E platform usage

| Capability | Use |
| --- | --- |
| `calls.create` | Places each rung of the escalation ladder |
| `recipient_result_schema` | Extracts the engineer's decision as typed JSON |
| `Idempotency-Key` | Derived from incident and contact IDs, so a retry never double-dials |
| `metadata` | Carries incident ID, service, severity, and rung |
| `calls.get` | Drives live rung state through the attempt lifecycle |
| `calls.listEvents` | Streams developer events into the incident timeline |
| `completion_confidence` | Below 0.5, the decision escalates instead of shipping code |
| `additionalProperties: false` | Strict extraction, so an off-schema result returns null and fails closed |
| `transcript_turns` | Mirrored into the live transcript and the post-mortem |
| `evidence` | Attached to the post-incident review |
| `region` / `locale` | Resolved from the published regions table before dialling |
| Stable error codes | Branching on `unsupported_region`, `insufficient_balance`, `account_concurrency_exceeded`, `idempotency_conflict` and the rest. A concurrency limit and a rate limit both arrive as HTTP 429 and need different responses, which is why the code is what gets read |
| Server-side proxy | Key read from `.env` on the server, never sent to the browser |

The decision schema follows CALL-E's own guidance to prefer string enums with an explicit `unknown` value over booleans for judgements that may be unclear. `answered_by` distinguishes `named_engineer`, `different_person`, `voicemail_or_ivr`, `no_answer`, and `unknown`, and only the first can authorise a deploy. Voicemail greetings and a colleague picking up the on-call phone both produce text that reads like approval, so this is the field that has to be precise.

### Safety

- Nothing deploys without the named engineer on the line and a sufficiently confident extraction.
- An unanswered rota fails closed. Silence is never read as consent.
- Coverage is resolved before a credit is committed. A valid E.164 number does not establish that its destination is supported, so an uncovered rung is refused in the dialog rather than failing as `unsupported_region` after acceptance.
- `completion_confidence` corroborates but never authorises. The platform documents it as confidence in CALL-E's task-completion judgment, not in the business answer, so it can withhold a deploy and never grant one.
- `failure_code` is preserved for support but never interpreted. It has no published enum, and the platform warns against inferring a decline or a no-answer from it. A failed call can still carry a schema-valid structured result, which is separate evidence and is what the audit trail records, but it can never authorise anything.
- A human "hold for review" stops the ladder rather than waking the next person.
- A ringing phone is never displayed as a person on the line. `in_progress` covers dialling, so the connected state waits for a transcript turn spoken by the recipient.
- The call task prompt forbids asking for passwords, tokens, or one-time codes.
- There is no API key field in the app. The key is read from the server environment only, per CALL-E's server-only guidance, and never reaches the browser.
- The on-call rota is server configuration too. Real names and mobile numbers are read from `.env` and never written into source, so nothing in this repository identifies anyone. A test and the sync script both fail if a live key reaches a committed file.
- Simulation mode runs when no server key is configured, and every simulated surface is labelled as simulated.
- The custom code path runs a real static scan and reports findings only. It never generates a patch, because a confident wrong diff during an incident is worse than no diff.

### Verification

- 35 tests covering phone validation, region coverage, key sanitisation, idempotency, decision interpretation, escalation stopping rules, the static scanner, rota configuration, error-code branching, and a check that no live API key is committed. No network or credits needed: `npm test`.
- `scripts/verifyLiveCall.js` places one real call and prints the structured decision end to end.

MIT licensed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## 2. Devpost form

**Project title**

```text
CALL-E Code Commander
```

**Elevator pitch**

```text
Your alerting tool sends a notification into a silenced phone. CALL-E calls your on-call engineer, explains what broke, answers their questions, and returns their spoken decision as typed JSON that gates the deploy.
```

**Built with:** `typescript`, `javascript`, `call-e`, `vite`, `web-audio-api`, `web-speech-api`, `canvas`

**About the project**

```markdown
## The problem

Production breaks at 03:00. Your alerting tool fires a push notification into a
silenced phone, then another, then a robocall that reads an error code at someone
who is not yet awake enough to parse it. Nothing moves until an engineer eventually
opens a laptop and starts reading dashboards.

Three things make an incident page a phone problem rather than a notification
problem, and a chat message cannot do any of them.

It has to wake someone up. A ringing phone is the only channel that reliably
interrupts a sleeping human, which is why serious rotas still end in a phone call.

It has to answer questions. The first thing a woken engineer says is "how bad is
it?" A recorded announcement cannot answer that.

It has to produce an accountable decision. "Did anyone approve this deploy?" is the
question every post-incident review asks.

## What it does

CALL-E Code Commander is an on-call escalation commander.

An automated council triages the incident, isolates a root cause, stages a hotfix,
and proves it green in an isolated sandbox. Then it stops. The patch is staged and
production is unchanged.

At that point CALL-E phones the primary on-call. It explains what broke and who is
affected, answers the questions the engineer asks back, and asks for one explicit
action: deploy the hotfix, hold it for review, roll back the last release, or wake
the backup. It repeats the chosen action back for confirmation before hanging up.

That conversation is returned as typed JSON through recipient_result_schema, and
that JSON is the only thing in the system that can change production.

If nobody answers, the ladder climbs. The backup is told why they are being woken
instead of the primary. If the whole rota is exhausted, the deploy is blocked.

## How we built it

The integration is deliberately deep rather than a single API call.

Each rung is a calls.create with a recipient_result_schema describing the decision
we need back, an Idempotency-Key derived from the incident and contact IDs so a
retry never double-dials a sleeping engineer, and metadata carrying the incident
correlation IDs. Live state comes from calls.get across the attempt lifecycle, and
calls.listEvents streams developer events into the incident timeline. Transcript
turns are mirrored into the UI and the post-mortem as they arrive.

The interesting engineering is in what the system refuses to do.

answered_by is an enum, not a boolean, following CALL-E's guidance to prefer
string enums with an explicit unknown value for judgements that may be unclear.
It separates the named engineer from a colleague who picked up their phone, from
voicemail, from an answer the model could not classify. Only the named engineer
can authorise a deploy. Voicemail greetings and a helpful colleague both produce
transcript text that reads like approval, which is exactly why this field cannot
be a boolean.

completion_confidence corroborates the decision but never grants it. The docs are
precise that it scores CALL-E's own task-completion judgment and not the business
answer, and that a high score does not establish that a person answered. So it can
withhold a deploy and never authorise one. Below 0.5 the ladder escalates, because waking one more person
costs less than deploying on a misheard word.

An unanswered rota fails closed. Silence is never read as consent.

Two platform rules shaped the rest. A valid E.164 number does not establish that
its destination is supported, so every rung is resolved against the published
regions table first and the recipient region and locale are set from it, rather
than discovering unsupported_region after the credit is committed. And the SDK is
a server SDK whose guidance is that keys must not reach browser code, so the app
ships a small server-side proxy: set CALLE_API_KEY in the environment and the page
routes through it and never handles a credential.

We applied the same rule to the code side. Paste your own broken code and a static
scanner reports what it actually matched, with real line numbers and the matched
text, at a stated confidence per rule. It does not generate a patch. During an
incident, a confident wrong diff is worse than no diff, so it reports findings and
hands the judgement back to the engineer. When nothing matches, it says so.

## What we learned

The hard part of a voice agent is not making it talk. It is deciding when to
distrust what it heard. Most of our test suite is about refusing to act: voicemail
that sounds like a yes, a colleague who is not the on-call, a low-confidence
extraction, a carrier failure, an exhausted rota. Getting the refusals right is
what makes the approvals worth anything.

## What is next

Webhook delivery instead of polling, so the ladder survives a closed browser tab.
Real repository analysis in place of the scripted incident scenarios. Rota import
from PagerDuty and Opsgenie.
```

**Try it out links:** your deployed URL, and the pull request URL.

Deploy on Vercel and set `CALLE_API_KEY` in the project's environment variables,
so the hosted link runs in live mode rather than simulation. The serverless proxy
in `api/calle/` is what makes that work. Check it by opening `/api/calle/mode` on
the deployed URL and confirming it reports `"serverKey": true`. Without that, a
judge who clicks your link sees a simulation and your best feature never rings.

---

## 3. Demo video (under 3 minutes)

Record live mode. The whole point is that a real phone rings.

**0:00–0:20 — the problem.** On the dashboard. "Production just broke. Your alerting tool would send a push notification into a silenced phone. Watch what this does instead."

**0:20–0:45 — the council stops.** Trigger the incident. Let the four agents run. Land on step 5 and say it out loud: "The patch is staged and the sandbox is green. It has not touched production, and it will not, until a human says so on the phone."

**0:45–1:40 — the call.** Open the rota. Rung 1 is already filled in with your name and +918319348794 from `.env`, so there is nothing to type on camera. Page it, and hold your phone to the camera as it rings. Answer on speaker. Ask CALL-E a real question, something like "how many customers are affected?" Let it answer. Then say "hold it for review" rather than approving, and show the deploy being blocked. This is the moment that separates the project from a robocall: it heard you, and it declined to ship.

**1:40–2:05 — escalation and authorisation.** Page again with rung 1 changed to a number that will not answer and rung 2 set to +918319348794. Show rung 1 going to no answer and rung 2 being dialled. Answer the backup number and authorise the deploy. Show the canary rollout in the terminal.

**2:05–2:25 — your own code.** Paste a snippet of genuinely broken code into the
custom incident box. Show the scanner naming the real line and the real fault
class, and point out that the patched pane says no patch was generated. "It tells
you what it found and what it is not sure about. It does not invent a fix."

**2:25–2:45 — the audit trail.** Open the post-mortem export. Point at the authorisation trail: who was reached, what they authorised, in their own words, at what confidence, and every rung that was dialled first.

Close on the line the judges should remember: nothing here ships without a human on the phone.

---

## 4. Checklist

- [ ] `npm test` passes, 35 of 35
- [ ] `node scripts/verifyLiveCall.js` rang +918319348794 and printed a structured decision
- [ ] `.env` holds the key and the rota; `.env.example` holds placeholders only
- [ ] `npm run sync` run last, so the PR directory matches the working tree
- [ ] PR opened against `CALLE-AI/awesome-phone-call-agents` with the root README entry added
- [ ] Video under 3 minutes, publicly hosted, recorded in live mode
- [ ] Devpost form has the PR URL and the CALL-E account email
