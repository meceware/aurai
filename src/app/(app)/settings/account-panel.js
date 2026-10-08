'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Laptop, Loader2, LogOut, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/responsive-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { signOut } from '@/app/login/actions';
import { removeAccount, signOutDevice, signOutOtherDevices } from './actions';

const WHEN = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
function ago(time) {
  const minutes = Math.round((time - Date.now()) / 60000);
  if (Math.abs(minutes) < 60) return WHEN.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return WHEN.format(hours, 'hour');
  return WHEN.format(Math.round(hours / 24), 'day');
}

export function AccountPanel({ email, devices }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmation, setConfirmation] = useState('');
  const others = devices.filter((device) => !device.current);

  const run = (action, message) =>
    startTransition(async () => {
      const result = await action();
      if (result?.error) return toast.error(result.error);
      if (message) toast(message);
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>You sign in with a link or code sent to your email.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Email</p>
            <p className="font-medium">{email}</p>
          </div>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await signOut();
                router.push('/login');
                router.refresh();
              })
            }
          >
            <LogOut className="size-4" />
            Sign out
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Signed-in devices</CardTitle>
          <CardDescription>Sign out anywhere you no longer use.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="divide-y rounded-lg border">
            {devices.map((device) => (
              <li key={device.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <Laptop className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium">
                    {device.device}
                    {device.current ? <Badge variant="secondary">This device</Badge> : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {device.ip ? `${device.ip} · ` : ''}active {ago(device.lastActive)}
                  </p>
                </div>
                {device.current ? null : (
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => signOutDevice(device.id), 'Device signed out')}>
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {others.length ? (
            <Button variant="outline" size="sm" disabled={pending} onClick={() => run(signOutOtherDevices, 'Signed out everywhere else')}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
              Sign out all other devices
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle>Delete account</CardTitle>
          <CardDescription>Removes your account, your OpenRouter key, every photo, every result and every file. This cannot be undone.</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveDialog>
            <ResponsiveDialogTrigger asChild>
              <Button variant="outline" className="text-destructive hover:text-destructive">
                <Trash2 className="size-4" />
                Delete my account
              </Button>
            </ResponsiveDialogTrigger>
            <ResponsiveDialogContent>
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>Delete your account?</ResponsiveDialogTitle>
                <ResponsiveDialogDescription>
                  Everything is removed from this server right away. Your OpenRouter account itself is not affected. Type <strong>{email}</strong> to
                  confirm.
                </ResponsiveDialogDescription>
              </ResponsiveDialogHeader>
              <Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={email} aria-label="Type your email to confirm" autoFocus />
              <ResponsiveDialogFooter>
                <ResponsiveDialogClose asChild>
                  <Button variant="outline" disabled={pending}>Cancel</Button>
                </ResponsiveDialogClose>
                <Button
                  className="bg-destructive text-white hover:bg-destructive/90"
                  disabled={pending || confirmation.trim().toLowerCase() !== email.toLowerCase()}
                  onClick={(event) => {
                    event.preventDefault();
                    startTransition(async () => {
                      const result = await removeAccount(confirmation);
                      if (result?.error) toast.error(result.error);
                    });
                  }}
                >
                  {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                  Delete account
                </Button>
              </ResponsiveDialogFooter>
            </ResponsiveDialogContent>
          </ResponsiveDialog>
        </CardContent>
      </Card>
    </div>
  );
}
