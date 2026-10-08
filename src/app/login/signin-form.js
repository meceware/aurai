'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { Logo } from '@/components/logo';
import { Turnstile } from '@/components/turnstile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { sendSignInEmail, verifySignInCode } from './actions';

const RESEND_AFTER = 60;

function Resend({ email, onResult }) {
  const [remaining, setRemaining] = useState(RESEND_AFTER);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (remaining <= 0) return undefined;
    const timer = setInterval(() => setRemaining((current) => current - 1), 1000);
    return () => clearInterval(timer);
  }, [remaining]);

  if (remaining > 0) {
    return <p className="text-center text-xs text-muted-foreground">You can request another email in {remaining}s.</p>;
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="w-full"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          // Re-sends the magic link, never the code endpoint on its own — that one is
          // deliberately silent, so asking it directly would send nothing.
          const result = await sendSignInEmail(email);
          onResult(result?.error ?? null);
          setRemaining(RESEND_AFTER);
        })
      }
    >
      Send another email
    </Button>
  );
}

export function SignInForm({ next, siteKey, initialProblem, initialNotice }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState(null);
  const [code, setCode] = useState('');
  const [token, setToken] = useState(null);
  const [problem, setProblem] = useState(initialProblem);
  const [pending, startTransition] = useTransition();
  const codeInput = useRef(null);

  // autoFocus alone misses: the code field mounts while the send is still pending, so it is
  // disabled at that moment. Focus once it's enabled — also after a rejected code.
  useEffect(() => {
    if (sentTo && !pending) codeInput.current?.focus();
  }, [sentTo, pending]);

  const submitEmail = (event) => {
    event.preventDefault();
    setProblem(null);
    startTransition(async () => {
      const result = await sendSignInEmail(email, token);
      if (result?.error) setProblem(result.error);
      else setSentTo(result.email);
    });
  };

  const submitCode = (value) => {
    setProblem(null);
    startTransition(async () => {
      const result = await verifySignInCode(sentTo, value);
      if (result?.error) {
        setProblem(result.error);
        setCode('');
        return;
      }
      router.push(result.isNew ? '/settings?welcome=1' : next);
      router.refresh();
    });
  };

  return (
    <div className="relative w-full max-w-sm">
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <Logo className="size-12" />
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{sentTo ? 'Check your email' : 'Welcome to Aurai'}</h1>
          <p className="text-sm text-balance text-muted-foreground">
            {sentTo
              ? `If ${sentTo} can sign in, a link and a 6-digit code are on their way.`
              : 'True colors for your photos. No password — we email you a link and a code.'}
          </p>
        </div>
      </div>

      <div className="rounded-xl border bg-card/80 p-6 shadow-sm backdrop-blur">
        {initialNotice && !sentTo ? <p className="mb-4 rounded-md bg-muted p-3 text-center text-sm text-muted-foreground">{initialNotice}</p> : null}
        {problem ? (
          <p role="alert" className="mb-4 rounded-md bg-destructive/10 p-3 text-center text-sm text-destructive">
            {problem}
          </p>
        ) : null}

        {sentTo ? (
          <div className="space-y-5">
            <div className="flex justify-center">
              <InputOTP
                ref={codeInput}
                maxLength={6}
                value={code}
                onChange={setCode}
                onComplete={submitCode}
                disabled={pending}
                aria-label="Six-digit code"
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((index) => (
                    <InputOTPSlot key={index} index={index} className="size-11 text-lg" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            <p className="text-center text-sm text-muted-foreground">
              {pending ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Signing in…
                </span>
              ) : (
                'Enter the code, or open the link on this device.'
              )}
            </p>
            <Resend email={sentTo} onResult={setProblem} />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={() => {
                setSentTo(null);
                setCode('');
                setProblem(null);
              }}
            >
              <ArrowLeft className="size-4" />
              Use a different email
            </Button>
          </div>
        ) : (
          <form onSubmit={submitEmail} className="space-y-4">
            <Input
              type="email"
              name="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              aria-label="Email address"
              autoComplete="email"
              className="h-11"
              autoFocus
              required
            />
            {siteKey ? <Turnstile siteKey={siteKey} onToken={setToken} /> : null}
            <Button type="submit" className="h-11 w-full" disabled={pending || (siteKey && !token)}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Continue with email
              {pending ? null : <ArrowRight className="size-4" />}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
