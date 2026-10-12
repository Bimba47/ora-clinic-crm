-- 0007: אופרטורים לסינון תאריך: מ (gte), עד (lte), שווה ל, שונה מ, ריק, לא ריק
-- (בלי "אחרי"/"לפני"). מספרים וסכומים נשארים עם כל אופרטורי ההשוואה.
-- אותה טבלה כמו operatorsFor ב-src/lib/views.ts.

create or replace function private.operator_allowed(p_type public.field_type, p_op public.filter_operator)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when p_type in ('text', 'long_text', 'email', 'phone')
      then p_op in ('eq', 'neq', 'contains', 'not_contains', 'is_empty', 'is_not_empty')
    when p_type in ('number', 'money')
      then p_op in ('eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty')
    when p_type in ('date', 'datetime')
      then p_op in ('gte', 'lte', 'eq', 'neq', 'is_empty', 'is_not_empty')
    when p_type = 'boolean'
      then p_op in ('eq', 'neq')
    else p_op in ('eq', 'neq', 'is_empty', 'is_not_empty')
  end
$$;
