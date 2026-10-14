-- ביטול 0031: החזרת הלוגו הקודם (שהועלה ל-branding ב"פרטי המערכת")
update public.app_settings
   set value = to_jsonb('https://wzcycscbelrcwbjbhsvt.supabase.co/storage/v1/object/public/branding/logo-1791801451698.jpeg'::text)
 where key = 'logo_url';
