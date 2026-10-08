export const formatDuration = (seconds) => (seconds < 60 ? `~${seconds} s` : `~${Math.round(seconds / 6) / 10} min`);

/** Dollars with enough digits to tell cheap models apart. */
export const formatPrice = (usd) => `$${usd.toFixed(usd < 0.1 ? 3 : 2)}`;

/** When something was marked as done, as the page header shows it ("8 Oct"); null when it is not. */
export const doneOn = (time) => (time ? new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null);

/** A model's price for one run, as the pickers show it. */
export function priceLabel(option) {
  if (option.cost === 0 && option.basis === 'free') return 'Free';
  if (typeof option.cost !== 'number') return option.basis === 'tokens' ? 'Per token' : 'Price unknown';
  return `${option.approximate ? '≈ ' : ''}${formatPrice(option.cost)}`;
}

/** Where that price comes from. */
export function priceSource(option) {
  if (option.basis === 'runs') return `${option.approximate ? 'From' : 'Median of'} ${option.runs} past run${option.runs === 1 ? '' : 's'}${option.approximate ? ' at another size' : ''}`;
  if (option.basis === 'price') return option.approximate ? "OpenRouter's price, for an assumed size" : "OpenRouter's price";
  if (option.basis === 'tokens') return 'Billed per token: known after a first run';
  return 'OpenRouter has not published a price';
}
