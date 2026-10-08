'use client';

import { useEffect, useRef } from 'react';

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function loadScript() {
  // Inserted from a nonce-trusted script, so 'strict-dynamic' lets it run without its own nonce.
  window.__turnstileLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return window.__turnstileLoading;
}

export function Turnstile({ siteKey, onToken }) {
  const container = useRef(null);
  const callback = useRef(onToken);

  useEffect(() => {
    callback.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let widget;
    let cancelled = false;
    loadScript().then(() => {
      if (cancelled || !container.current) return;
      widget = window.turnstile.render(container.current, {
        sitekey: siteKey,
        theme: 'auto',
        callback: (token) => callback.current(token),
        'expired-callback': () => callback.current(null),
        'error-callback': () => callback.current(null),
      });
    });
    return () => {
      cancelled = true;
      if (widget !== undefined) window.turnstile?.remove(widget);
    };
  }, [siteKey]);

  return <div ref={container} className="flex min-h-[65px] justify-center" />;
}
