begin;

create index if not exists buyer_invoice_payment_reminder_operations_actor_idx
on public.buyer_invoice_payment_reminder_operations(actor_user_id)
where actor_user_id is not null;

commit;
