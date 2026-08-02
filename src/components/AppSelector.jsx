import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Boxes,
  Check,
  ChevronsUpDown,
  ExternalLink,
  LayoutDashboard,
  Loader2,
  Mail,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { ToastAction } from '@/components/ui/toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const APPLICATION_ICONS = {
  fcos: LayoutDashboard,
  mail: Mail,
};

export default function AppSelector({ confirmPortalNavigation }) {
  const navigate = useNavigate();
  const { applications, launchApplication } = useAuth();
  const { toast } = useToast();
  const [launchingId, setLaunchingId] = useState(null);

  const openApplication = async (application) => {
    if (application.kind === 'internal') {
      if (!confirmPortalNavigation?.()) return;
      navigate(application.launchPath || '/');
      return;
    }
    setLaunchingId(application.id);
    try {
      const result = await launchApplication(application);
      if (result?.popupBlocked && result.launchUrl) {
        toast({
          title: 'New tab blocked',
          description: `Allow pop-ups to open ${application.name}.`,
          action: (
            <ToastAction
              altText={`Open ${application.name}`}
              onClick={() => window.open(result.launchUrl, '_blank', 'noopener,noreferrer')}
            >
              Open
            </ToastAction>
          ),
        });
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: `${application.name} could not be opened`,
        description: error.message || 'Secure launch failed.',
      });
    } finally {
      setLaunchingId(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-11 w-full items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 text-left outline-none transition-colors hover:border-slate-300 hover:bg-white focus:ring-2 focus:ring-blue-100"
          aria-label="Switch application"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-blue-600 text-white">
            <LayoutDashboard className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-slate-950">FCOS</span>
            <span className="block truncate text-[10px] text-slate-500">Switch application</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-[248px] p-1.5">
        <DropdownMenuLabel className="px-2 py-2 text-xs text-slate-500">Applications</DropdownMenuLabel>
        <DropdownMenuItem
          className="min-h-10"
          onSelect={() => {
            if (!confirmPortalNavigation?.()) return;
            navigate('/apps');
          }}
        >
          <Boxes className="h-4 w-4" />
          <span className="flex-1">All applications</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {applications.map((application) => {
          const Icon = APPLICATION_ICONS[application.iconKey] || Boxes;
          const current = application.id === 'fcos';
          const launching = launchingId === application.id;
          return (
            <DropdownMenuItem
              key={application.id}
              className="min-h-11"
              disabled={!application.available || launching}
              title={application.blockingReason || undefined}
              onSelect={() => openApplication(application)}
            >
              <span className={`grid h-7 w-7 place-items-center rounded-md ${application.kind === 'external' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{application.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {application.available ? (application.roleLabel || 'Member') : application.blockingReason}
                </span>
              </span>
              {launching
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : current
                  ? <Check className="h-4 w-4 text-blue-600" />
                  : <ExternalLink className="h-3.5 w-3.5 text-slate-400" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
