import { useMemo } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Settings2, SlidersHorizontal } from 'lucide-react';

export default function WorkspaceCommandPalette({ open, onOpenChange, groups, onNavigate, onCustomizeNavigation }) {
  const items = useMemo(() => groups.flatMap((group) => group.items.map((item) => ({ ...item, groupLabel: group.label }))), [groups]);
  const choose = (action) => {
    onOpenChange(false);
    window.requestAnimationFrame(action);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="workspace-command-palette top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 sm:rounded-[18px]" aria-describedby="workspace-command-description">
        <DialogTitle className="sr-only">FCOS command palette</DialogTitle>
        <DialogDescription id="workspace-command-description" className="sr-only">Search accessible workspaces and FCOS actions.</DialogDescription>
        <Command className="bg-transparent">
          <CommandInput autoFocus placeholder="Search workspaces and actions…" />
          <CommandList className="max-h-[min(60vh,30rem)]">
            <CommandEmpty>No accessible command found.</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.id} heading={group.label}>
                {items.filter((item) => item.groupLabel === group.label).map((item) => {
                  const Icon = item.icon;
                  return <CommandItem key={item.id} value={`${item.label} ${group.label}`} onSelect={() => choose(() => onNavigate(item.to))}><Icon className="mr-2 h-4 w-4" />{item.label}</CommandItem>;
                })}
              </CommandGroup>
            ))}
            <CommandSeparator />
            <CommandGroup heading="Workspace">
              <CommandItem onSelect={() => choose(() => onNavigate('/settings'))}><Settings2 className="mr-2 h-4 w-4" />My Settings<CommandShortcut>⌘,</CommandShortcut></CommandItem>
              <CommandItem onSelect={() => choose(onCustomizeNavigation)}><SlidersHorizontal className="mr-2 h-4 w-4" />Customize Dock</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
