/** Pure group union shared by server serialization and the administrator's preview. */
export function resolveGroupAccess({ groups = [], groupIds = [], moduleIds = [], capabilityIds = [], privileged = false, active = true } = {}) {
  const selected = groups.filter((group) => groupIds.includes(group.id));
  const permissions = Object.fromEntries(moduleIds.map((id) => [id, id === 'report_archive' ? 'none' : false]));
  const capabilities = Object.fromEntries(capabilityIds.map((id) => [id, false]));
  const grant_sources = {};
  const source = (id, group) => { (grant_sources[id] ||= []).push({ id: group.id, label: group.label }); };
  if (active) {
    for (const group of selected) {
      for (const id of moduleIds) {
        const value = group.permissions?.[id];
        if (id === 'report_archive') {
          const level = value === true || value === 'full' ? 'full' : value === 'read' ? 'read' : 'none';
          if (level !== 'none') source(id, group);
          if (level === 'full' || (level === 'read' && permissions[id] === 'none')) permissions[id] = level;
        } else if (value === true) { permissions[id] = true; source(id, group); }
      }
      for (const id of capabilityIds) if (group.capabilities?.[id] === true) { capabilities[id] = true; source(id, group); }
    }
    if (privileged) {
      for (const id of Object.keys(grant_sources)) delete grant_sources[id];
      const roleSource = { id: 'organizational_role', label: 'Privileged organizational role' };
      for (const id of moduleIds) { permissions[id] = id === 'report_archive' ? 'full' : true; source(id, roleSource); }
      for (const id of capabilityIds) { capabilities[id] = true; source(id, roleSource); }
    }
  }
  return { permissions, capabilities, grant_sources, groups: selected.map(({ id, label }) => ({ id, label })), group_ids: selected.map(({ id }) => id), privileged_access: privileged && active };
}
