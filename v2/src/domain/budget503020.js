import { BUCKETS, DEFAULT_SPLIT } from '../config/constants.js';
import { percentOf } from '../core/money.js';

// Targets always add up exactly to income: savings takes the rounding remainder.
export function bucketTargets(incomePaise, split = DEFAULT_SPLIT) {
  const needs = percentOf(incomePaise, split.needs);
  const wants = percentOf(incomePaise, split.wants);
  return { needs, wants, savings: incomePaise - needs - wants };
}

export function computeBudget({ incomePaise, spentByBucket, split = DEFAULT_SPLIT }) {
  const targets = bucketTargets(incomePaise, split);
  const buckets = {};
  let totalOutflow = 0;

  for (const bucket of BUCKETS) {
    const actual = spentByBucket?.[bucket] || 0;
    const target = targets[bucket];
    totalOutflow += actual;
    const usedPct = target > 0 ? Math.round((actual / target) * 100) : (actual > 0 ? 100 : 0);
    let status;
    if (bucket === 'savings') status = actual >= target ? 'ahead' : 'behind';
    else if (actual > target) status = 'over';
    else if (actual > 0 && actual * 10 >= target * 9) status = 'warn';
    else status = 'ok';
    buckets[bucket] = {
      targetPaise: target,
      actualPaise: actual,
      remainingPaise: target - actual,
      usedPct,
      status,
    };
  }

  return { buckets, unallocatedPaise: incomePaise - totalOutflow };
}
