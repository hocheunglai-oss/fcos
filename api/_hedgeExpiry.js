import { paperHedgeExpiryStatus } from '../src/hedge/lib/domain.js'

function expiryError(message, statusCode = 502) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

export async function reconcilePaperHedgeExpiry(client, { now = new Date(), dryRun = false, profile = null } = {}) {
  const [swapsResult, mopsResult] = await Promise.all([
    client.from('hedge_swap_hedges').select('*').eq('is_expired', false).limit(5000),
    client.from('hedge_market_prices').select('*').order('price_date', { ascending: true }).limit(10000),
  ])
  const databaseError = swapsResult.error || mopsResult.error
  if (databaseError) throw expiryError(`Paper-hedge expiry could not be evaluated: ${databaseError.message}`)

  const candidates = (swapsResult.data || []).map((swap) => ({
    swap,
    status: paperHedgeExpiryStatus(swap, mopsResult.data || [], now),
  })).filter((item) => item.status.ready)

  if (dryRun) {
    return {
      checked: (swapsResult.data || []).length,
      expired: 0,
      wouldExpire: candidates.map(({ swap, status }) => ({ id: swap.id, months: status.months.map((month) => month.month) })),
    }
  }

  const expired = []
  const conflicts = []
  for (const { swap, status } of candidates) {
    const update = await client.rpc('expire_paper_hedge_with_audit', {
      p_hedge_id: swap.id,
      p_expected_revision: swap.revision,
      p_actor_user_id: profile?.id || null,
      p_actor_email: String(profile?.email || 'system').toLowerCase(),
      p_metadata: {
        contractMonths: status.months.map((month) => month.month),
        lastTradingDays: status.months.map((month) => month.lastTradingDay),
        verificationRecordCount: status.months.reduce((sum, month) => sum + month.verified, 0),
      },
    })
    if (update.error) throw expiryError(`Paper hedge ${swap.id} could not be expired automatically: ${update.error.message}`)
    if (update.data?.expired !== true) {
      conflicts.push(swap.id)
      continue
    }
    expired.push(swap.id)
  }

  return { checked: (swapsResult.data || []).length, expired: expired.length, expiredIds: expired, conflicts }
}
