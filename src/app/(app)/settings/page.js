import { CheckCircle2, CircleAlert, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { listDevices } from '@/lib/account';
import { catalogUpdatedAt, refreshIfStale } from '@/lib/catalog';
import { imageChoices, visionChoices } from '@/lib/model-options';
import { MOTION_PRESETS } from '@/lib/prompts/defaults';
import { EDIT_NEEDS_HTTPS, videoEditAvailable } from '@/lib/public-media';
import { videoChoices, videoEditChoices } from '@/lib/video-options';
import { keyDetailsFor } from '@/lib/openrouter/key-details';
import { getPrefs, getPrompts, PROMPTS } from '@/lib/preferences';
import { requireUser } from '@/lib/session';
import { getUserSettings } from '@/lib/settings';
import { spending, storageUsage } from '@/lib/usage';
import { AccountPanel } from './account-panel';
import { DefaultsForm } from './defaults-form';
import { ModelsForm } from './models-form';
import { OpenRouterKey } from './openrouter-key';
import { PromptsForm } from './prompts-form';
import { SpendingSummary } from './spending-summary';
import { StoragePanel } from './storage-panel';

export const metadata = { title: 'Settings' };

const TABS = ['openrouter', 'models', 'defaults', 'prompts', 'storage', 'account'];

const CONNECT_ERRORS = {
  denied: 'OpenRouter did not grant a key. You can try again, or paste a key instead.',
  expired: 'That connection attempt expired or did not match. Start it again from this page.',
  rejected: 'OpenRouter returned a key that does not work. Try again, or paste a key instead.',
  failed: 'Could not reach OpenRouter to finish connecting. Try again in a moment.',
};

function Notice({ tone, children }) {
  const Icon = tone === 'error' ? CircleAlert : tone === 'success' ? CheckCircle2 : Sparkles;
  return (
    <div
      className={
        tone === 'error'
          ? 'flex gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm'
          : 'flex gap-3 rounded-xl border border-brand/30 bg-brand/10 p-4 text-sm'
      }
    >
      <Icon className={tone === 'error' ? 'mt-0.5 size-5 shrink-0 text-destructive' : 'mt-0.5 size-5 shrink-0 text-brand'} />
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Section({ title, description, children }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default async function SettingsPage({ searchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const settings = getUserSettings(user.id);
  const prompts = getPrompts(user.id);
  const prefs = getPrefs(user.id);
  refreshIfStale();
  const tab = TABS.includes(params.tab) ? params.tab : 'openrouter';
  // Not awaited: the balance streams into the card while the rest of the page is already usable.
  const detailsPromise = settings.hasKey ? keyDetailsFor(user.id) : null;

  return (
    <>
      <PageHeader title="Settings" />
      <div className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-8">
        {params.welcome && !settings.hasKey ? (
          <Notice>
            <p className="font-medium">Welcome to Aurai</p>
            <p className="text-muted-foreground">Aurai runs on your own OpenRouter account. Connect it below to start restoring photos.</p>
          </Notice>
        ) : null}
        {params.connected ? (
          <Notice tone="success">
            <p className="font-medium">Connected to OpenRouter</p>
            <p className="text-muted-foreground">Your new key is saved. You can start enhancing photos.</p>
          </Notice>
        ) : null}
        {CONNECT_ERRORS[params.connect_error] ? <Notice tone="error">{CONNECT_ERRORS[params.connect_error]}</Notice> : null}

        <Tabs defaultValue={tab}>
          <TabsList className="w-full justify-start overflow-x-auto overflow-y-hidden [scrollbar-width:none] sm:w-fit">
            <TabsTrigger value="openrouter">OpenRouter</TabsTrigger>
            <TabsTrigger value="models">Models</TabsTrigger>
            <TabsTrigger value="defaults">Defaults</TabsTrigger>
            <TabsTrigger value="prompts">Prompts</TabsTrigger>
            <TabsTrigger value="storage">Storage</TabsTrigger>
            <TabsTrigger value="account">Account</TabsTrigger>
          </TabsList>

          <TabsContent value="openrouter" className="mt-4 space-y-4">
            <Section title="OpenRouter account" description="Every model in Aurai is called through OpenRouter, on your own account.">
              <OpenRouterKey initialLast4={settings.keyLast4} detailsPromise={detailsPromise} />
            </Section>
            <Section title="Spent in Aurai" description="What your runs cost, as reported by OpenRouter.">
              <SpendingSummary spending={spending(user.id)} />
            </Section>
          </TabsContent>

          <TabsContent value="models" className="mt-4">
            <Section title="Models" description="Which models you can pick from, what each tool starts with, and how big the AI redraw is.">
              <ModelsForm prefs={prefs} images={imageChoices(prefs)} vision={visionChoices(prefs)} videos={videoChoices(prefs)} edits={videoEditChoices(prefs)} editNotice={videoEditAvailable() ? null : EDIT_NEEDS_HTTPS} updatedAt={catalogUpdatedAt()} />
            </Section>
          </TabsContent>

          <TabsContent value="defaults" className="mt-4">
            <Section title="Defaults" description="How runs behave unless you change them.">
              <DefaultsForm prefs={prefs} presets={Object.fromEntries(Object.entries(MOTION_PRESETS).map(([key, preset]) => [key, { label: preset.label }]))} />
            </Section>
          </TabsContent>

          <TabsContent value="prompts" className="mt-4">
            <Section title="Prompts" description="The instructions sent to the models. Edit them to change how Aurai asks; reset any time.">
              <PromptsForm
                prompts={Object.entries(PROMPTS).map(([key, prompt]) => ({
                  key,
                  label: prompt.label,
                  description: prompt.description,
                  placeholders: prompt.placeholders,
                  text: prompts[key].text,
                  custom: prompts[key].custom,
                  defaultText: prompt.default,
                }))}
              />
            </Section>
          </TabsContent>

          <TabsContent value="storage" className="mt-4">
            <Section title="Storage" description="Your photos and every result made from them, stored on this server.">
              <StoragePanel usage={storageUsage(user.id)} />
            </Section>
          </TabsContent>

          <TabsContent value="account" className="mt-4">
            <AccountPanel email={user.email} devices={await listDevices(user.id)} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
