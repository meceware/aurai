import { KeyBanner } from '@/components/key-banner';

/** The landing state of a tool: what it does, and the drop target once a key is set. */
export function EmptyHero({ icon: Icon, title, description, hasKey, children }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 p-4 md:p-8">
      {hasKey ? null : <KeyBanner />}
      <div className="space-y-2 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl border bg-card">
          <Icon className="size-5 text-brand" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-balance">{title}</h2>
        <p className="mx-auto max-w-lg text-sm text-balance text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}
