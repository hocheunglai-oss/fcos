import { useAuth } from '@/lib/AuthContext';
import { moduleLabel } from '@/lib/authModules';
import AccessDenied from '@/components/AccessDenied';

export default function ModuleGateAny({ moduleIds = [], children }) {
  const { hasModuleAccess } = useAuth();
  if (!moduleIds.some((moduleId) => hasModuleAccess(moduleId))) {
    return <AccessDenied moduleName={moduleIds.map(moduleLabel).join(' or ')} />;
  }
  return children;
}
