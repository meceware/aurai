/** The mark: a bright core inside a soft halo — an aura around the subject. */
export function Logo({ className }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <radialGradient id="aurai-core" cx="40%" cy="36%" r="65%">
          <stop offset="0" stopColor="#e0e7ff" />
          <stop offset="0.5" stopColor="#818cf8" />
          <stop offset="1" stopColor="#4338ca" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="14" fill="none" stroke="url(#aurai-core)" strokeWidth="1.75" opacity="0.5" />
      <circle cx="16" cy="16" r="8.5" fill="url(#aurai-core)" />
    </svg>
  );
}
