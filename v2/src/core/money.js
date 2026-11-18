// All money is handled as integer paise to avoid floating point drift.

export function toPaise(value) {
  const text = String(value ?? '').replace(/[,\s₹]/g, '');
  if (text === '' || !/^-?\d*\.?\d+$/.test(text)) {
    throw new RangeError('Invalid amount');
  }
  // The exponent trick rounds decimal strings exactly (1.005 -> 101 paise).
  return Math.round(Number(`${text}e2`));
}

export function fromPaise(paise) {
  return (Number(paise) || 0) / 100;
}

export function formatINR(paise) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(fromPaise(paise));
}

// Whole rupees, for tight spaces such as summary tiles.
export function formatINRShort(paise) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.round(fromPaise(paise)));
}

export function sumPaise(items, key = 'amount_paise') {
  return (items || []).reduce((total, item) => total + (Number(item[key]) || 0), 0);
}

export function percentOf(paise, pct) {
  return Math.round((paise * pct) / 100);
}
