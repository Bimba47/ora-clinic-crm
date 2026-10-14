-- 0031: הלוגו של המערכת הוא הסמל מעיצוב מסך הכניסה ב-Claude Design (קשתות ועלה), בצבעי האפיון (החלטת ענבל).
-- הקובץ באפליקציה עצמה: public/brand/ora-logo.svg. זו עדיין הגדרה רגילה (logo_url):
-- אפשר להחליף או להסיר מ"פרטי המערכת" בלי קוד. הלוגו הקודם נשאר באחסון (branding), ו-_down.sql מחזיר אותו.
update public.app_settings set value = to_jsonb('/brand/ora-logo.svg'::text) where key = 'logo_url';
