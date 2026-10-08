'use client';

import { ChevronsUpDown, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Link from 'next/link';
import { formatDuration, priceLabel } from '@/lib/format';

/**
 * Model choice as a menu of described options rather than a bare select: what one run costs at
 * this photo's size, how long it takes, and any caveat — enough to choose without a manual. The
 * list is the person's own, from Settings.
 */
export function ModelPicker({ options, value, onChange, side = 'top', disabled }) {
  const current = options.find((option) => option.id === value) ?? options[0];
  if (!current) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" aria-label={`Model: ${current.label}`}>
          <span className="max-w-40 truncate">{current.label}</span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align="start" sideOffset={8} className="w-[min(22rem,calc(100vw-2rem))] p-1.5">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Model · runs on your OpenRouter key</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current.id} onValueChange={onChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id} className="items-start rounded-lg py-2.5">
              {/* grid-cols-1 (a minmax(0, 1fr) column) and min-w-0 let a long name shorten to "…"
                  instead of widening the row and pushing the price out of view. */}
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 truncate font-medium" title={option.label}>
                    {option.label}
                  </span>
                  {option.badge ? (
                    <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[11px] font-medium">
                      {option.badge}
                    </Badge>
                  ) : null}
                  <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{priceLabel(option)}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {[option.provider, option.resolution, option.quality && option.quality !== 'auto' ? `${option.quality} quality` : null, option.seconds ? formatDuration(option.seconds) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {option.caveat ? (
                  <span className="flex items-center gap-1 text-xs text-warning">
                    <TriangleAlert className="size-3" />
                    {option.caveat}
                  </span>
                ) : null}
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="text-xs text-muted-foreground">
          <Link href="/settings?tab=models">Choose models in Settings</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
