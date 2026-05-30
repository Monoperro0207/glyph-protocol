import type { AuditReport } from './index.js'

/**
 * Declarative policy that decides whether the autonomous layer may promote an
 * audited tool update on its own (re-pin to the new card) without a human.
 *
 * The default — an empty policy `{}` — is conservative: it promotes nothing.
 * Each flag opens a specific door. "Autonomous-with-policy" means even a
 * breaking change can be auto-promoted, but only when the operator has
 * explicitly allowed that class of change. A failed audit is never promotable
 * regardless of policy.
 */
export interface AutoPromotionPolicy {
  /** Require a valid signed update manifest describing the change. Default false. */
  requireManifest?: boolean
  /** Require a valid attestation on the new card. Default false. */
  requireAttestation?: boolean
  /** Allow promoting a change the diff marks as breaking. Default false. */
  allowBreaking?: boolean
  /** Allow a riskTier escalation (e.g. safe → caution → danger). Default false. */
  allowRiskEscalation?: boolean
  /** Allow a signing-key change. Default false. */
  allowKeyChange?: boolean
}

/** The outcome of evaluating one audited update against the promotion policy. */
export interface AuditDecision {
  report: AuditReport
  /** Whether the update was promoted (re-pinned) to the new card. */
  promoted: boolean
  /** Reasons promotion was withheld — empty when promoted. */
  reasons: string[]
}

const RISK_ORDER: Record<string, number> = { safe: 0, caution: 1, danger: 2 }

/** True when the riskTier change moves to a strictly higher tier. */
function isRiskEscalation(before: unknown, after: unknown): boolean {
  const b = RISK_ORDER[String(before)] ?? 0
  const a = RISK_ORDER[String(after)] ?? 0
  return a > b
}

/**
 * Pure decision function: given an audit report and a policy, returns whether
 * the update may be auto-promoted and, if not, the reasons. Never promotes an
 * update whose audit did not pass — that gate is unconditional.
 */
export function evaluatePromotion(
  report: AuditReport,
  policy: AutoPromotionPolicy,
): { promote: boolean; reasons: string[] } {
  const reasons: string[] = []

  // Unconditional gates — a failed audit is never auto-promotable.
  if (!report.signatureValid) reasons.push('card signature invalid')
  if (!report.ok) reasons.push('audit did not pass')

  // Policy-gated requirements.
  if (policy.requireManifest && report.manifest !== 'valid') {
    reasons.push('policy requires a valid signed manifest')
  }
  if (policy.requireAttestation && report.attestation !== 'valid') {
    reasons.push('policy requires a valid attestation')
  }

  // Change-class gates.
  const diff = report.diff
  if (diff.requiresApproval && !policy.allowBreaking) {
    reasons.push('breaking change not allowed by policy')
  }
  if (diff.keyChanged && !policy.allowKeyChange) {
    reasons.push('signing-key change not allowed by policy')
  }
  const riskChange = diff.changes.find((c) => c.field === 'cost.riskTier')
  if (
    riskChange &&
    isRiskEscalation(riskChange.before, riskChange.after) &&
    !policy.allowRiskEscalation
  ) {
    reasons.push('risk escalation not allowed by policy')
  }

  return { promote: reasons.length === 0, reasons }
}
