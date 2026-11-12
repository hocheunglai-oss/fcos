export async function setManagedUserActivation(client, body, actor, {
  appError, fcunoFederationConfig, assertAdministratorContinuity, writeAdminAudit,
}) {
  if (body.activationOnly !== true || typeof body.id !== 'string' || !body.id.trim()
    || typeof body.active !== 'boolean' || Object.keys(body).some(key => !['id', 'active', 'activationOnly'].includes(key))
    || !fcunoFederationConfig().federationEnabled) {
    throw appError('Specify an existing FCUNO user and the intended FCOS activation state.', 400, 'FCOS_APPLICATION_ACCESS_INVALID');
  }
  const columns = 'id,email,full_name,user_type,active,use_type_defaults';
  const { data: profile, error } = await client.from('user_profiles')
    .select(columns).eq('id', body.id).maybeSingle();
  if (error) throw error;
  if (!profile) throw appError('User not found.', 404);
  const { id, email, user_type: userType, active } = profile;
  if (active !== body.active) {
    await assertAdministratorContinuity(client, { userId: id, nextActive: body.active, nextUserType: userType });
    await writeAdminAudit(client, actor, 'fcos_application_access_authorized', id, email, {
      previous_active: active === true, active: body.active, user_type: userType,
      identity_authority: 'fcuno', activation_authority: 'fcos',
    }, { required: true });
    const { data: updated, error: updateError } = await client.from('user_profiles')
      .update({ active: body.active, updated_at: new Date().toISOString() })
      .eq('id', id).eq('user_type', userType).eq('active', active).select(columns).maybeSingle();
    if (updateError) throw updateError;
    if (!updated) throw appError('FCOS authorization changed while this user was being saved. Reload the user and try again.', 409, 'FCOS_AUTHORIZATION_CONFLICT');
    return updated;
  }
  return profile;
}
