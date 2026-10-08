'use client';

import { Suspense, use, useState, useTransition } from 'react';
import { CheckCircle2, ExternalLink, KeyRound, Link2, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { removeKey, saveKey, testKey } from './actions';

const money = (value) => (value === null || value === undefined ? '—' : `$${value.toFixed(2)}`);

function Details({ details }) {
  if (!details) return null;
  return (
    <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/40 p-4 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-xs text-muted-foreground">Credit balance</dt>
        <dd className="font-medium tabular-nums">{money(details.balance)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Used on this key</dt>
        <dd className="font-medium tabular-nums">{money(details.usage)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Key limit</dt>
        <dd className="font-medium tabular-nums">{details.limit === null ? 'None' : `${money(details.remaining)} of ${money(details.limit)} left`}</dd>
      </div>
    </dl>
  );
}

function DetailsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/40 p-4 sm:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-4 w-14" />
        </div>
      ))}
    </div>
  );
}

/** The balance as of page load, streamed from the server. */
function InitialDetails({ promise }) {
  const { details, error } = use(promise);
  if (error) {
    return (
      <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
        {error}
      </p>
    );
  }
  return <Details details={details} />;
}

export function OpenRouterKey({ initialLast4, detailsPromise }) {
  const [last4, setLast4] = useState(initialLast4);
  const [editing, setEditing] = useState(!initialLast4);
  const [value, setValue] = useState('');
  const [details, setDetails] = useState(null);
  const [problem, setProblem] = useState(null);
  const [pending, startTransition] = useTransition();

  const save = (event) => {
    event.preventDefault();
    setProblem(null);
    startTransition(async () => {
      const result = await saveKey(value);
      if (result.error) return setProblem(result.error);
      setLast4(result.last4);
      setDetails(result.details);
      setValue('');
      setEditing(false);
      toast.success('OpenRouter key saved');
    });
  };

  const test = () =>
    startTransition(async () => {
      setProblem(null);
      const result = await testKey();
      if (result.error) return setProblem(result.error);
      setDetails(result.details);
      toast.success('The key works');
    });

  const remove = () =>
    startTransition(async () => {
      await removeKey();
      setLast4(null);
      setDetails(null);
      setEditing(true);
      toast('Key removed');
    });

  return (
    <div className="space-y-4">
      {last4 && !editing ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
          <KeyRound className="size-5 text-brand" />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-sm">sk-or-••••••••{last4}</p>
            <p className="text-xs text-muted-foreground">Encrypted at rest. It is only ever sent to OpenRouter.</p>
          </div>
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2 className="size-3 text-success" /> Saved
          </Badge>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button variant="outline" size="sm" onClick={test} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Test
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={pending}>
              Replace
            </Button>
            <Button variant="ghost" size="sm" onClick={remove} disabled={pending} className="text-destructive hover:text-destructive">
              <Trash2 className="size-4" />
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-center">
            <div className="flex-1 text-sm">
              <p className="font-medium">Connect with OpenRouter</p>
              <p className="text-muted-foreground">Sign in on OpenRouter and approve a key for Aurai. Nothing to copy or paste.</p>
            </div>
            <Button asChild>
              {/* A full navigation, not a client transition: it leaves for openrouter.ai. */}
              <a href="/api/openrouter/connect">
                <Link2 className="size-4" />
                Connect
              </a>
            </Button>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or paste a key
            <span className="h-px flex-1 bg-border" />
          </div>
        <form onSubmit={save} className="space-y-3">
          <Label htmlFor="openrouter-key">API key</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="openrouter-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-or-v1-…"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="font-mono"
              required
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={pending || !value}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                Save key
              </Button>
              {last4 ? (
                <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Create one at{' '}
            <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-2">
              openrouter.ai/settings/keys <ExternalLink className="size-3" />
            </a>
            . Generations are billed to your OpenRouter account; setting a credit limit on the key is a good idea.
          </p>
        </form>
        </div>
      )}

      {problem ? (
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {problem}
        </p>
      ) : null}
      {details ? (
        <Details details={details} />
      ) : last4 && !editing && detailsPromise ? (
        <Suspense fallback={<DetailsSkeleton />}>
          <InitialDetails promise={detailsPromise} />
        </Suspense>
      ) : null}
    </div>
  );
}
