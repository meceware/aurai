'use client';

import { createContext, useContext } from 'react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { useMediaQuery } from '@/lib/hooks';
import { cn } from '@/lib/utils';

// shadcn's responsive dialog: a centred dialog on wider screens, a sheet from the bottom on a
// phone, where it is easier to reach and to swipe away. Same parts, same props, either way.

const Wide = createContext(true);
const useWide = () => useContext(Wide);

export function ResponsiveDialog({ children, ...props }) {
  const wide = useMediaQuery('(min-width: 768px)');
  const Root = wide ? Dialog : Drawer;
  return (
    <Wide.Provider value={wide}>
      <Root {...props}>{children}</Root>
    </Wide.Provider>
  );
}

export function ResponsiveDialogTrigger(props) {
  const Trigger = useWide() ? DialogTrigger : DrawerTrigger;
  return <Trigger {...props} />;
}

export function ResponsiveDialogClose(props) {
  const Close = useWide() ? DialogClose : DrawerClose;
  return <Close {...props} />;
}

export function ResponsiveDialogContent({ className, children, ...props }) {
  if (useWide()) {
    return (
      <DialogContent className={className} {...props}>
        {children}
      </DialogContent>
    );
  }
  return (
    <DrawerContent className="max-h-[92dvh]" {...props}>
      <div className={cn('flex flex-col gap-4 overflow-y-auto px-4 pb-6', className?.replace(/\bsm:max-w-\S+/g, ''))}>{children}</div>
    </DrawerContent>
  );
}

export function ResponsiveDialogHeader({ className, ...props }) {
  return useWide() ? <DialogHeader className={className} {...props} /> : <DrawerHeader className={cn('px-0 pb-0 text-left', className)} {...props} />;
}

export function ResponsiveDialogFooter({ className, ...props }) {
  return useWide() ? <DialogFooter className={className} {...props} /> : <DrawerFooter className={cn('px-0 pb-0', className)} {...props} />;
}

export function ResponsiveDialogTitle(props) {
  const Title = useWide() ? DialogTitle : DrawerTitle;
  return <Title {...props} />;
}

export function ResponsiveDialogDescription(props) {
  const Description = useWide() ? DialogDescription : DrawerDescription;
  return <Description {...props} />;
}
