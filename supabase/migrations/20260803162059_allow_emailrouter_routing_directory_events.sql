begin;

alter table emailrouter.events
  drop constraint if exists events_entity_type_check;

alter table emailrouter.events
  add constraint events_entity_type_check
  check (
    entity_type in (
      'mailbox',
      'message',
      'destination',
      'group',
      'preset',
      'setting',
      'mail_action',
      'subscription',
      'alert',
      'ai_usage',
      'routing_directory'
    )
  );

comment on constraint events_entity_type_check on emailrouter.events is
  'Allowlisted Email Router audit entity types, including whole-directory ordering changes.';

commit;
