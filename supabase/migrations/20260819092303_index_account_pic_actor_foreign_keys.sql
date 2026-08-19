create index if not exists account_pic_directories_updated_by_idx
  on public.account_pic_directories(updated_by)
  where updated_by is not null;

create index if not exists account_pic_directory_operations_actor_idx
  on public.account_pic_directory_operations(actor_user_id)
  where actor_user_id is not null;
