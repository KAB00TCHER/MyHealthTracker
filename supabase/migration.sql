-- Миграция для зашифрованных полей дневника.
-- Старые answers/note не удаляются и не используются новым приложением.
-- Сначала выполните этот SQL в Supabase SQL Editor.

alter table public.daily_entries
  add column if not exists answers_encrypted jsonb;

alter table public.state_events
  add column if not exists note_encrypted jsonb;

-- Проверка: новые колонки должны существовать.
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('daily_entries', 'state_events')
  and column_name in ('answers_encrypted', 'note_encrypted')
order by table_name, column_name;
