# CALL-E Code Commander

> An on-call escalation commander that phones your engineers, explains the incident in conversation, and returns their spoken decision as typed JSON.

Production breaks at 03:00. Your alerting tool fires a push notification into a silenced phone, then another, then a robocall that reads an error code at a person who is not yet awake enough to parse it. Nothing moves until somebody eventually opens a laptop and starts reading dashboards.

CALL-E Code Commander replaces that with a phone call that can actually hold a conversation. It rings the primary on-call, explains what broke and who is affected, answers the questions the engineer asks back, and leaves the call with one explicit authorised action. If nobody picks up, it climbs the rota and tells the next person why they are being woken instead of the primary.

The decision extracted from that conversation is the only thing in the system that can change production.

---

## Why this is phone work

Three properties of an incident page make it a phone problem rather than a notification problem, and all three are things a chat message cannot do.

**It has to wake someone up.** A ringing phone is the only channel that reliably interrupts a sleeping human, which is why every serious on-call rota still ends in a phone call.

**It has to answer questions.** The first thing a woken engineer says is "how bad is it?" A recorded announcement cannot answer that. CALL-E is given the incident facts and answers from them, and says plainly when it does not know something rather than inventing an answer.

**It has to produce an accountable decision.** "Did anyone approve this deploy?" is the question every post-incident review asks. Here the answer is a structured record: who was reached, on which number, what they authorised, in their own words, and how confident the extraction was.

---

## How it works

```text
 Production alert
        │
        ▼
 ┌──────────────────────────────────────────────┐
 │  Investigation council (runs unattended)     │
 │   1. Triage        2. Root cause             │
 │   3. Patch         4. Sandbox verification   │
 └──────────────────────────────────────────────┘
        │  patch staged, production UNCHANGED
        ▼
 ┌──────────────────────────────────────────────┐
 │  5. HUMAN AUTHORISATION GATE                 │
 │     the pipeline stops here                  │
 └──────────────────────────────────────────────┘
        │
        ▼
 CALL-E escalation ladder
   rung 1  primary on-call  ──answered & authorised──┐
     │ no answer / no decision                       │
   rung 2  backup on-call   ──answered & authorised──┤
     │ no answer / no decision                       │
   rung 3  engineering manager ─────────────────────┤
     │ rota exhausted                                │
     ▼                                               ▼
  deploy BLOCKED                          deploy / rollback / hold
```

The council can investigate, write a patch, and prove it green in a sandbox on its own. It cannot ship. Step 5 is a hard stop, and the only key that opens it is a decision spoken by a human on a CALL-E call.

---

## CALL-E platform usage

| Capability | Where it is used |
| --- | --- |
| `calls.create` | Places each rung of the escalation ladder |
| `recipient_result_schema` | Extracts the spoken decision as typed JSON |
| `Idempotency-Key` | Derived from incident and contact, so a retry never double-dials |
| `metadata` | Carries incident ID, service, severity, and rung through to webhooks |
| `calls.get` | Drives live rung state: queued, dialling, in progress, completed |
| `calls.listEvents` | Streams developer events into the incident timeline |
| `completion_confidence` | A low-confidence extraction escalates instead of shipping code |
| `transcript_turns` | Mirrored into the transcript pane and the post-mortem |
| `evidence` | Attached to the post-incident review |
| `region` / `locale` | Resolved from published coverage, so routing is not left to chance |
| Stable error codes | Branching on `unsupported_region`, `insufficient_balance`, and the rest, not on HTTP status |

### The decision schema

This is the contract that turns a conversation into an action. It lives in `src/agents/calleService.js`.

```js
{
  type: 'object',
  required: ['answered_by', 'decision'],
  additionalProperties: false,
  properties: {
    answered_by:           { type: 'string', enum: [
                               'named_engineer', 'different_person',
                               'voicemail_or_ivr', 'no_answer', 'unknown' ] },
    decision:              { type: 'string', enum: [
                               'deploy_hotfix', 'hold_for_review',
                               'rollback_release', 'escalate_to_backup',
                               'no_decision' ] },
    reason:                { type: 'string' },
    acknowledged_severity: { type: 'string', enum: ['yes', 'no', 'unknown'] },
    callback_minutes:      { type: 'integer' },
    questions_asked:       { type: 'array', items: { type: 'string' } }
  }
}
```

`answered_by` is an enum rather than a boolean, following CALL-E's own schema
guidance to prefer string enums with an explicit `unknown` value for judgements
that may be unclear. It matters here more than anywhere else: only
`named_engineer` can authorise a deploy. A voicemail greeting, an automated
menu, a colleague who picked up the on-call phone, and an answer the extraction
model could not classify all fail closed and climb the ladder instead.

---

## Safety rules

These are enforced in code, not just described.

**Nothing ships without the named engineer.** `interpretDecision` grants authorisation only when `answered_by` is `named_engineer` and the decision is one that authorises a change. Voicemail, a different person, and an unclassifiable answer all escalate instead.

**Coverage is checked before a credit is committed.** A valid E.164 number does not establish that its destination is supported, so every rung is resolved against CALL-E's published regions first, and the recipient's `region` and `locale` are set from that table. An uncovered destination is refused in the dialog rather than failing as `unsupported_region` after the call is accepted.

**Completion confidence corroborates, it never authorises.** CALL-E documents `completion_confidence` as confidence in its own task-completion judgment, explicitly not in the business answer, and states that a high score does not establish that a person answered. So the authorisation comes from `answered_by` and `decision` in the structured result. Confidence and `task_completed` can withhold a deploy, never grant one.

**An unanswered rota fails closed.** Exhausting the ladder blocks the deploy. Silence is never read as consent.

**A ringing phone is not shown as a person on the line.** The Calls API reports an attempt as `in_progress` from the moment it starts dialling, so that status alone never turns a rung green. The connected state waits for a transcript turn spoken by the recipient, which is the earliest evidence that anybody is actually talking.

**A rung that was never dialled is not recorded as unanswered.** When CALL-E refuses to place a call, no phone rang, and the post-mortem says so rather than reporting an unanswered rota. The deploy stays blocked either way.

**A failed call is recorded for what it was.** `failure_code` has no published enum and the platform warns against reading a decline or a no-answer out of it, so it is preserved for support and never interpreted. The structured result is separate evidence, so when a failed call still carries a schema-valid `answered_by`, that is what the audit trail records. A failed call can never authorise anything regardless of what it says.

**A human hold stops the ladder.** If the primary says "hold it, I want to read the diff", the backup is not woken.

**The call never asks for credentials.** The task prompt forbids requesting passwords, tokens, or one-time codes, and instructs CALL-E to end the call without giving incident detail if anyone other than the named contact answers.

**Retries do not re-dial.** The idempotency key is derived from the incident and contact IDs, never from a timestamp.

---

## Running it

### Requirements

Node.js 18 or newer.

### Install and test

```bash
npm install
npm test        # 35 tests, no network or credits required
npm run dev     # http://localhost:5173
```

### The custom code playground

Pick the custom incident from the feed and paste your own broken code. A static
scanner runs over it and reports what it actually matched, with real line numbers
and the matched text as evidence, at a stated confidence per rule.

It does not generate a patch, and the panes that would show one say so. Putting a
confident, wrong diff in front of an engineer during an incident is worse than
showing nothing, so the scanner reports findings and hands the judgement back.
When nothing matches, it says nothing matched.

### Simulation mode

Leave the API key blank and page the rota. The ladder runs as a clearly labelled simulation: rung 1 does not answer, rung 2 answers and authorises. No phone rings and no credits are spent. Every surface that shows a simulated result says so.

### Live mode

CALL-E's SDK is a server SDK and its guidance is that keys must not be sent to
browser code, so there is no key field in the app at all. The key is read from
the server environment and never reaches the page.

Create a `.env` file in the project root:

```bash
CALLE_API_KEY=iams_live_your_key_here

# Optional, and the rota can also just be typed into the dialog.
CALLE_ROTA_PRIMARY_NAME=Priya Raman
CALLE_ROTA_PRIMARY_PHONE=+919876543210
CALLE_ROTA_BACKUP_NAME=Sam Okoro
CALLE_ROTA_BACKUP_PHONE=+14155552671
```

The rota is read on the server and prefilled into the dialog, where it can be
changed before anything is dialled. It is kept in `.env` rather than in source
for the same reason a rota is not usually checked in: those are real people's
mobile numbers, and this repository is public. A fresh clone starts with empty
fields. Anything already typed into the dialog in this browser wins over the
seed, because replacing a number that is about to be dialled would be worse
than showing none.

Then start the app normally:

```bash
npm run dev
```

The dev server prints which mode it is in at startup and exposes a small proxy
at `/api/calle` that attaches the Authorization header on the way out. The
page asks the server which mode it is in and shows a banner saying whether a
real phone can ring. Requests leaving the browser carry no credential.

With no key configured the app runs a clearly labelled simulation instead. No
phone rings, no credits are spent, and nothing has to be typed into the page.

`.env` is gitignored. `.env.example` shows the expected shape.

Get a key from the [CALL-E dashboard](https://dashboard.heycall-e.com/account/api-keys).
Production keys start with `iams_live_`. Verify the whole loop from the
terminal before you rely on it:

```bash
node scripts/verifyLiveCall.js +14155552671 iams_live_...
```

That places one real call, prints the resolved region, the structured decision
it extracted, and a coverage table of which API fields CALL-E returned. It exits
non-zero if no structured decision came back.

The script reads the same `.env`, so once the file exists both arguments can be
dropped. With none, it dials the seeded rung 1 contact by name, which is the
destination the web app would dial first:

```bash
node scripts/verifyLiveCall.js
```

### Deploying it

A production build is static files, so a plain static host has no server to hold
the key and the page falls back to a labelled simulation. That is safe, but a
reviewer opening the link never sees a phone ring.

`api/calle/` holds the same proxy as a pair of serverless functions, so a
deployed copy behaves like a local one. On Vercel, import the repository, set
`CALLE_API_KEY` in the project's environment variables, and deploy. Add the
`CALLE_ROTA_*` variables if you want the hosted rota prefilled too.

The key lives in the hosting provider's environment and is never in the bundle.
Confirm which mode a deployment is in by opening `/api/calle/mode`: it reports
whether a server key is present, and never returns the key itself.

---

## Project layout

```text
src/
  agents/
    calleService.js       CALL-E integration, decision schema, interpretation
    escalationLadder.js   The rota walk and its stopping rules
    agentMesh.js          Investigation council and the authorisation gate
    codeScanner.js        Static scan for pasted code, findings only
    regions.js            Published CALL-E coverage, region and locale resolution
  config/
    rota.js               Seeded on-call rota, read from the server environment
  ui/                     Rota dialog, diff viewer, terminal, post-mortem
  audio/, canvas/         Browser voice simulation and the reactive orb
vite.config.js            Dev server plus the server-side CALL-E proxy
api/calle/                Same proxy as serverless functions, for a deployed build
scripts/
  verifyLiveCall.js       One real call, end to end, from the terminal
test/
  calle.test.js           35 tests covering validation, decisions, escalation, scanning, coverage
```

---

## Limitations

The three built-in incident scenarios carry authored root causes and patches. They are fixtures standing in for the upstream tooling an incident feed would provide, not live analysis of your repository.

The custom code path is different: it runs a real scan and reports only what it found. It is a pattern scanner, so it recognises a fixed set of fault classes and will miss anything outside them. Every finding states its own confidence, and the low-confidence heuristics say so.

Everything downstream of the authorisation gate is real: the call, the conversation, the structured extraction, the escalation, and the refusal to deploy without a human.

## License

MIT
