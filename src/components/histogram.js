/** RGB histogram (64 bins per channel) as overlapping translucent areas. */
export function Histogram({ histogram, className }) {
  if (!histogram?.length) return null;
  const width = 256;
  const height = 64;
  // Log scale, so a clipped spike at one end does not flatten everything else.
  const peak = Math.log1p(Math.max(...histogram.flat()));
  const path = (bins) => {
    const step = width / (bins.length - 1);
    const points = bins.map((count, i) => `${(i * step).toFixed(1)},${(height - (Math.log1p(count) / peak) * height).toFixed(1)}`);
    return `M0,${height} L${points.join(' L')} L${width},${height} Z`;
  };
  const colours = ['#ef4444', '#22c55e', '#3b82f6'];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={className} role="img" aria-label="Color histogram">
      {histogram.map((bins, channel) => (
        <path key={channel} d={path(bins)} fill={colours[channel]} fillOpacity="0.35" stroke={colours[channel]} strokeOpacity="0.8" strokeWidth="0.75" />
      ))}
    </svg>
  );
}
