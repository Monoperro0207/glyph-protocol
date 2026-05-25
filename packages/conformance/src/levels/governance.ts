import type { CheckResult, LevelRunner } from '../types.js'

/**
 * Governance level — manifest endpoint, key registry endpoint (when present),
 * and cards that survive a depth round-trip without changing identity.
 *
 * Most checks here are optional: a minimal server can pass `discovery +
 * execution + security` without ever publishing a manifest or registry.
 */
export const governanceLevel: LevelRunner = async (ctx) => {
  const checks: CheckResult[] = []
  const add = (name: string, status: 'passed' | 'failed' | 'skipped', detail: string) =>
    checks.push({ name, level: 'governance', status, detail })

  // 1. Card depth round-trip — `id` must persist across every depth so a
  //    consumer that fetched a `minimal` card later can match it against the
  //    `rich` form. (Signature only ships at depth=rich; that is intentional —
  //    the verifier asks for `rich` when it needs to verify.)
  const name = ctx.lexiconNames[0]
  if (!name) {
    add('governance.card.depthIdentity', 'skipped', 'no glyphs advertised')
  } else {
    try {
      const minimal = await ctx.http('GET', `/glyphs/${encodeURIComponent(name)}?depth=minimal`)
      const standard = await ctx.http('GET', `/glyphs/${encodeURIComponent(name)}?depth=standard`)
      const rich = await ctx.http('GET', `/glyphs/${encodeURIComponent(name)}?depth=rich`)
      const ok =
        minimal.status === 200 &&
        standard.status === 200 &&
        rich.status === 200 &&
        typeof rich.json?.id === 'string' &&
        minimal.json?.id === rich.json.id &&
        standard.json?.id === rich.json.id
      add(
        'governance.card.depthIdentity',
        ok ? 'passed' : 'failed',
        ok ? `'${name}' id identical across depths` : 'id drifted with depth',
      )
    } catch (e) {
      add('governance.card.depthIdentity', 'failed', errMsg(e))
    }
  }

  // 2. Manifest endpoint — optional. 404 is acceptable; if 200, it must be
  //    a valid UpdateManifest.
  if (!name) {
    add('governance.manifest', 'skipped', 'no glyphs advertised')
  } else {
    try {
      const { status, json } = await ctx.http('GET', `/glyphs/${encodeURIComponent(name)}/manifest`)
      if (status === 404) {
        add('governance.manifest', 'skipped', 'no manifest published for this glyph')
      } else {
        const ok = status === 200 && ctx.validators.updateManifest(json) === true
        add(
          'governance.manifest',
          ok ? 'passed' : 'failed',
          ok
            ? 'manifest is a valid UpdateManifest'
            : `expected 200 + UpdateManifest, got ${status}`,
        )
      }
    } catch (e) {
      add('governance.manifest', 'failed', errMsg(e))
    }
  }

  // 3. Key registry — optional GET /keys (Glyph protocol 1.0).
  //    When present, the body must list at least the server's active key.
  try {
    const { status, json } = await ctx.http('GET', '/keys')
    if (status === 404) {
      add('governance.keyRegistry', 'skipped', 'server does not publish /keys yet')
    } else {
      const ok =
        status === 200 &&
        Array.isArray(json?.keys) &&
        json.keys.length > 0 &&
        json.keys.every(
          (k: any) => typeof k.fingerprint === 'string' && typeof k.publicKey === 'string',
        )
      add(
        'governance.keyRegistry',
        ok ? 'passed' : 'failed',
        ok
          ? `${json.keys.length} key${json.keys.length === 1 ? '' : 's'} published`
          : `expected 200 + KeyRegistry, got ${status}`,
      )
    }
  } catch (e) {
    add('governance.keyRegistry', 'failed', errMsg(e))
  }

  return checks
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
