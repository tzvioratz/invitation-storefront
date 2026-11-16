
export function getQuantityOptions(invitation) {
  const standard = invitation.standardQuantities || [];
  const intermediate = invitation.intermediateQuantities || [];

  return [...new Set([...standard, ...intermediate])]
    .map(Number)
    .filter(q => Number.isInteger(q) && q > 0)
    .sort((a, b) => a - b);
}

export function isIntermediateQuantity(invitation, quantity) {
  return (invitation.intermediateQuantities || [])
    .map(Number)
    .includes(Number(quantity));
}

export function getAdjustedUnitPrice(invitation, selection = {}) {
  const format = Number(
    invitation.formatAdjustments?.[selection.format] ?? 0
  );

  const paper = Number(
    invitation.paperAdjustments?.[selection.paper] ?? 0
  );

  const custom = Number(
    invitation.customizationFees?.[selection.design] ?? 0
  );

  return Number(invitation.unitPrice || 0) + format + paper + custom;
}

export function calculateEstimate(invitation, selection, quantity) {
  const qty = Number(quantity);

  if (!Number.isInteger(qty) || qty <= 0) {
    return 0;
  }

  const baseCharge = Number(invitation.baseCharge || 0);
  const unitPrice = getAdjustedUnitPrice(invitation, selection);

  const premium = isIntermediateQuantity(invitation, qty)
    ? Number(invitation.intermediatePremium || 0)
    : 0;

  return Math.max(0, baseCharge + qty * unitPrice + premium);
}

export function calculateEffectiveUnitPrice(invitation, selection, quantity) {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) return 0;

  return calculateEstimate(invitation, selection, qty) / qty;
}

export function getPriceRange(invitation) {
  const quantities = getQuantityOptions(invitation);

  if (!quantities.length) return null;

  const prices = quantities.map(q =>
    calculateEffectiveUnitPrice(invitation, {}, q)
  );

  return {
    min: Math.min(...prices),
    max: Math.max(...prices)
  };
}

export function validatePricing(invitation) {
  const standard = (invitation.standardQuantities || []).map(Number).sort((a, b) => a - b);
  const intermediate = (invitation.intermediateQuantities || []).map(Number);
  const unitPrice = Number(invitation.unitPrice || 0);
  const premium = Number(invitation.intermediatePremium || 0);

  if (!standard.length) {
    throw new Error("At least one standard quantity is required.");
  }

  if (standard.some(q => !Number.isInteger(q) || q <= 0)) {
    throw new Error("Standard quantities must be positive whole numbers.");
  }

  if (intermediate.some(q => !Number.isInteger(q) || q <= 0)) {
    throw new Error("Intermediate quantities must be positive whole numbers.");
  }

  if (new Set([...standard, ...intermediate]).size !== standard.length + intermediate.length) {
    throw new Error("Quantity values cannot be duplicated.");
  }

  for (const q of intermediate) {
    const nextStandard = standard.find(s => s > q);

    if (!nextStandard) {
      throw new Error(`Intermediate quantity ${q} needs a higher standard quantity.`);
    }

    if (premium >= (nextStandard - q) * unitPrice) {
      throw new Error(
        `The intermediate price for ${q} invitations must be less than the price at ${nextStandard}.`
      );
    }
  }

  return true;
}

export function money(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(n) || 0);
}
