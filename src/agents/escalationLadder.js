/**
 * On-Call Escalation Ladder
 *
 * The problem this solves is the one every on-call rota actually has: the page
 * fires, the primary does not pick up, and nothing happens until somebody
 * notices twenty minutes later. Existing tools redial the same person or send
 * another push notification into a silent phone.
 *
 * Here, each rung of the ladder is a real CALL-E conversation. If the primary
 * is not reached, or is reached but cannot commit to an action, the ladder
 * walks to the next person and tells them why they are being woken up. The
 * ladder stops the moment a human authorises an action, and every rung is
 * recorded for the post-incident review.
 */

import { CalleIncidentCommander } from './calleService.js';

/**
 * How long to wait for one rung before giving up and climbing.
 *
 * This has to cover more than the conversation. A call stays `in_progress`
 * through post-call result finalisation, so the budget is dialling time, plus
 * the three-minute cap the task prompt asks for, plus extraction. Cutting this
 * too close makes a call that actually succeeded look like no answer, which
 * wakes the next person for nothing.
 */
const DEFAULT_RUNG_TIMEOUT_MS = 420000;

/** Gap between status polls while a call is live. */
const POLL_INTERVAL_MS = 3000;

/**
 * How many consecutive failed reads before a rung is abandoned as unreadable.
 * Three at the poll interval is about ten seconds, long enough to ride out a
 * blip and short enough that a revoked key does not look like a ringing phone.
 */
const MAX_CONSECUTIVE_POLL_ERRORS = 3;

/**
 * The default rota. Phone numbers are supplied by the operator at dial time.
 *
 * region and locale are deliberately absent. They are resolved from CALL-E's
 * published coverage for whatever number is entered, and an explicit value here
 * would override that resolution and force the wrong routing hint.
 */
export const DEFAULT_ROTA = [
  { id: 'primary', name: 'Primary On-Call', role: 'primary on-call engineer', phone: '' },
  { id: 'backup', name: 'Backup On-Call', role: 'backup on-call engineer', phone: '' },
  { id: 'manager', name: 'Engineering Manager', role: 'engineering manager and incident owner', phone: '' }
];

export class EscalationLadder {
  /**
   * @param {object} options
   * @param {CalleIncidentCommander} options.service CALL-E integration to dial through.
   * @param {(event: object) => void} [options.onEvent] Receives every ladder state change.
   */
  constructor(options = {}) {
    this.service = options.service;
    this.onEvent = options.onEvent || (() => {});
    this.rungTimeoutMs = options.rungTimeoutMs || DEFAULT_RUNG_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs || POLL_INTERVAL_MS;
    this.abort = false;
    this.rungs = [];
  }

  emit(type, payload = {}) {
    this.onEvent({ type, at: new Date().toISOString(), ...payload });
  }

  cancel() {
    this.abort = true;
  }

  /**
   * Walks the ladder until somebody authorises an action or the rota runs out.
   *
   * @param {object} input
   * @param {object} input.scenario The incident being escalated.
   * @param {Array} input.contacts Ordered rota. Contacts without a phone number are skipped.
   * @param {string} input.incidentId Stable incident identifier, used for idempotency.
   * @returns {Promise<object>} The ladder outcome, including every rung attempted.
   */
  async run({ scenario, contacts, incidentId }) {
    this.abort = false;
    this.rungs = [];

    const rota = (contacts || []).filter((c) => c && c.phone && c.phone.trim());
    if (rota.length === 0) {
      const outcome = {
        resolved: false,
        authorised: false,
        decision: 'no_decision',
        reason: 'No contact on the rota has a phone number configured.',
        rungs: []
      };
      this.emit('ladder:exhausted', outcome);
      return outcome;
    }

    this.emit('ladder:start', { incidentId, rotaSize: rota.length });

    for (let index = 0; index < rota.length; index++) {
      if (this.abort) break;

      const contact = rota[index];
      const escalatedFrom = index > 0 ? (rota[index - 1].displayName || rota[index - 1].name) : null;

      this.emit('rung:dialing', { index, contact, escalatedFrom });

      const rung = await this.dialRung({ scenario, contact, incidentId, escalatedFrom, index });
      this.rungs.push(rung);

      if (rung.outcome.authorised) {
        const outcome = {
          resolved: true,
          authorised: true,
          decision: rung.outcome.decision,
          reason: rung.outcome.reason,
          decidedBy: contact,
          confidence: rung.outcome.confidence,
          rungs: this.rungs
        };
        this.emit('ladder:resolved', outcome);
        return outcome;
      }

      // A held decision is still a human decision. It stops the ladder even
      // though it does not authorise a production change.
      if (rung.outcome.reachedEngineer && rung.outcome.decision === 'hold_for_review') {
        const outcome = {
          resolved: true,
          authorised: false,
          decision: 'hold_for_review',
          reason: rung.outcome.reason,
          decidedBy: contact,
          confidence: rung.outcome.confidence,
          rungs: this.rungs
        };
        this.emit('ladder:resolved', outcome);
        return outcome;
      }

      this.emit('rung:escalating', {
        index,
        contact,
        reason: rung.outcome.reason,
        hasNext: index < rota.length - 1
      });
    }

    // A rung that never got a call placed is not a rung that went unanswered.
    // Saying the rota "was dialled" when the account refused every attempt
    // would put an unanswered phone call into the post-mortem that never rang.
    const dialled = this.rungs.filter((rung) => rung.outcome?.callPlaced !== false).length;

    const outcome = {
      resolved: false,
      authorised: false,
      decision: 'no_decision',
      reason: dialled === 0
        ? 'No rung could be dialled at all, so nobody was reached and the deploy stays blocked.'
        : `${dialled} of ${this.rungs.length} rung(s) were dialled and nobody authorised an action.`,
      dialledCount: dialled,
      rungs: this.rungs
    };
    this.emit('ladder:exhausted', outcome);
    return outcome;
  }

  /**
   * Dials one contact and waits for that call to reach a terminal state.
   */
  async dialRung({ scenario, contact, incidentId, escalatedFrom, index }) {
    const placement = await this.service.placeIncidentCall({ scenario, contact, incidentId, escalatedFrom });

    if (placement.mode === 'error') {
      const outcome = {
        decision: 'no_decision',
        // Nothing was dialled, so there is no endpoint to classify. Recording
        // this as an unclassified answer would put a phone call in the audit
        // trail that never happened.
        answeredBy: 'unknown',
        callPlaced: false,
        reachedEngineer: false,
        authorised: false,
        shouldEscalate: true,
        reason: placement.error,
        confidence: null
      };
      this.emit('rung:failed', { index, contact, error: placement.error });
      return { index, contact, mode: 'error', callId: null, outcome, transcript: [], error: placement.error };
    }

    if (placement.mode === 'simulated') {
      const simulated = this.simulateRung(contact, index);
      this.emit('rung:simulated', { index, contact, outcome: simulated.outcome });
      return { index, contact, mode: 'simulated', callId: null, ...simulated };
    }

    this.emit('rung:placed', { index, contact, callId: placement.callId, idempotencyKey: placement.idempotencyKey });

    const snapshot = await this.awaitTerminal(placement.callId, contact, index);
    const outcome = this.service.interpretDecision(snapshot);

    this.emit('rung:completed', { index, contact, callId: placement.callId, outcome, snapshot });

    return {
      index,
      contact,
      mode: 'live',
      callId: placement.callId,
      outcome,
      snapshot,
      transcript: snapshot?.transcript || []
    };
  }

  /**
   * Polls a live call until it stops changing, surfacing every intermediate
   * state so the incident timeline moves while the phone is ringing.
   */
  async awaitTerminal(callId, contact, index) {
    const deadline = Date.now() + this.rungTimeoutMs;
    let last = null;
    let consecutiveErrors = 0;

    while (Date.now() < deadline && !this.abort) {
      const snapshot = await this.service.pollCall(callId, contact);

      if (snapshot?.error) {
        // A revoked key or a dropped connection should surface quickly rather
        // than looking like a call that is still ringing for seven minutes.
        consecutiveErrors++;
        this.emit('rung:progress', { index, contact, callId, snapshot });
        if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          this.emit('rung:unreadable', { index, contact, callId, error: snapshot.error });
          return last;
        }
      } else if (snapshot) {
        consecutiveErrors = 0;
        last = snapshot;
        this.emit('rung:progress', { index, contact, callId, snapshot });
        if (snapshot.isTerminal) return snapshot;
      }

      await sleep(this.pollIntervalMs);
    }

    this.emit('rung:timeout', { index, contact, callId });
    return last;
  }

  /**
   * Produces a clearly-labelled synthetic rung for demos without call credits.
   *
   * The primary contact deliberately does not answer so that the escalation
   * path is visible, which is the behaviour worth demonstrating. Nothing here
   * is ever presented to the user as a real call.
   */
  simulateRung(contact, index) {
    if (index === 0) {
      return {
        outcome: {
          decision: 'no_decision',
          answeredBy: 'voicemail_or_ivr',
          reachedEngineer: false,
          authorised: false,
          shouldEscalate: true,
          reason: 'Simulated: voicemail picked up, so no incident detail was given and no decision was recorded.',
          confidence: null,
          simulated: true
        },
        transcript: [{ speaker: 'CALL-E', text: 'Dialling primary on-call. Voicemail greeting detected, ending call without leaving incident detail.' }]
      };
    }

    return {
      outcome: {
        decision: 'deploy_hotfix',
        answeredBy: 'named_engineer',
        reachedEngineer: true,
        authorised: true,
        shouldEscalate: false,
        reason: 'Simulated: backup on-call reviewed the sandbox result and authorised the hotfix.',
        confidence: 0.9,
        acknowledgedSeverity: true,
        callbackMinutes: 0,
        questionsAsked: ['How many customers were double charged?', 'Did the regression suite actually pass?'],
        simulated: true
      },
      transcript: [
        { speaker: 'CALL-E', text: `This is an automated page for a live production incident. Am I speaking to ${contact.name}?` },
        { speaker: contact.name, text: 'Yes, go ahead.' },
        { speaker: 'CALL-E', text: 'A concurrency fault in the payment worker is double charging customers. A hotfix passes in the sandbox but is not in production.' },
        { speaker: contact.name, text: 'How many customers were affected?' },
        { speaker: 'CALL-E', text: 'Four thousand one hundred and twenty so far, and the rate is climbing.' },
        { speaker: contact.name, text: 'Deploy the hotfix now.' },
        { speaker: 'CALL-E', text: 'Confirming: deploy the hotfix now. Recorded and authorised.' }
      ]
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
