
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

function adjustmentBounds(map) {
  const values = Object.values(map || {})
    .map(Number)
    .filter(Number.isFinite);

  // 0 covers options that have no entry in the map
  return {
    min: Math.min(0, ...values),
    max: Math.max(0, ...values)
  };
}

export function getPriceRange(invitation) {
  const quantities = getQuantityOptions(invitation);
  if (!quantities.length) return null;

  const f = adjustmentBounds(invitation.formatAdjustments);
  const p = adjustmentBounds(invitation.paperAdjustments);
  const c = adjustmentBounds(invitation.customizationFees);

  const base = Number(invitation.baseCharge || 0);
  const unit = Number(invitation.unitPrice || 0);
  const premium = Number(invitation.intermediatePremium || 0);

  const perInvitation = (q, adj) => {
    const extra = isIntermediateQuantity(invitation, q) ? premium : 0;
    return Math.max(0, base + q * (unit + adj) + extra) / q;
  };

  const minAdj = f.min + p.min + c.min;
  const maxAdj = f.max + p.max + c.max;

  return {
    min: Math.min(...quantities.map(q => perInvitation(q, minAdj))),
    max: Math.max(...quantities.map(q => perInvitation(q, maxAdj)))
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

/**
 * Gets the per-unit price for an add-on at a given quantity.
 *
 * quantityPricing example:
 * [
 *   { min: 1, max: 50, unitPrice: 0.50 },
 *   { min: 51, max: 100, unitPrice: 0.40 },
 *   { min: 101, max: null, unitPrice: 0.35 }
 * ]
 */
export function getAddOnUnitPrice(addOn, quantity) {
  const qty = Number(quantity);

  if (!Number.isInteger(qty) || qty <= 0) return 0;

  const pricing = Array.isArray(addOn.quantityPricing)
    ? addOn.quantityPricing
    : [];

  const tier = pricing.find(tier => {
    const min = Number(tier.min);
    const max = tier.max === "" || tier.max == null
      ? Infinity
      : Number(tier.max);

    return qty >= min && qty <= max;
  });

  return Number(tier?.unitPrice ?? 0);
}


/**
 * Calculates the price of one selected add-on.
 */
export function calculateAddOnTotal(addOn, design, quantity) {
  const qty = Number(quantity);

  if (!Number.isInteger(qty) || qty <= 0) return 0;

  // Fixed charge for selecting the add-on.
  const baseCharge = Number(addOn.baseCharge || 0);

  // Quantity-based price.
  const unitPrice = getAddOnUnitPrice(addOn, qty);
  const quantityTotal = unitPrice * qty;

  // Selected design adjustment.
  const adjustment = Number(design?.priceAdjustment || 0);

  let designTotal = 0;

  if (design?.priceAdjustmentType === "perUnit") {
    designTotal = adjustment * qty;
  } else if (design?.priceAdjustmentType === "perOrder") {
    designTotal = adjustment;
  }

  return Math.max(0, baseCharge + quantityTotal + designTotal);
}


/**
 * Calculates the combined total of all enabled add-ons.
 */
export function calculateAllAddOnsTotal(addOns, selectedAddOns) {
  let total = 0;

  for (const addOn of addOns) {
    const state = selectedAddOns[addOn.id];

    if (!state?.enabled) continue;

    const design = addOn.designs?.find(
      design => design.id === state.design
    );

    total += calculateAddOnTotal(
      addOn,
      design,
      state.quantity
    );
  }

  return total;
}
