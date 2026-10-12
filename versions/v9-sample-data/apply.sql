-- v9.1: התאמת הדאטה לדוגמה לאפיון
-- צוות: רק רותם (מנהלת), ליאת (מטפלת, לייזר ופנים), נטע (מטפלת, בוטוקס, חומצה והתייעצויות).
-- מחירון: רק 7 הטיפולים מהאפיון.
-- הגיבוי של המצב הקודם: backup.json באותה תיקייה.
-- רץ כטרנזקציה אחת. בלי שינוי במבנה המסד.

begin;

create temp table _ids on commit drop as select
  'b01aa816-1973-4872-87f8-d79731a2b1a6'::uuid as r,   -- רותם
  'a77dad4e-1ffc-4e1c-b6c6-a372ee6adce1'::uuid as l,   -- ליאת
  'a0a4cb0f-d5dd-4920-8548-09207a27f58e'::uuid as n;   -- נטע

-- מי שיוצאת -> מי מחליפה אותה בשדות "נוצרה/נקבע/נפתחה על ידי"
create temp table _creator_map (old_id uuid primary key, new_id uuid) on commit drop;
insert into _creator_map values
  ('7b038946-2426-476a-9c7d-a383878e86c3', 'b01aa816-1973-4872-87f8-d79731a2b1a6'),  -- שירן -> רותם
  ('2f73e41f-bbb8-469e-a82a-2c24624a7ac6', 'a77dad4e-1ffc-4e1c-b6c6-a372ee6adce1'),  -- מורן -> ליאת
  ('171c7ab5-b857-485b-9455-aa60208aea22', 'a77dad4e-1ffc-4e1c-b6c6-a372ee6adce1'),  -- יעל -> ליאת
  ('85347a3a-b33e-4ddd-ad0d-5921f01e2358', 'a0a4cb0f-d5dd-4920-8548-09207a27f58e'),  -- הדס -> נטע
  ('afc03195-1647-4d63-9eca-de4fd69408f8', 'a0a4cb0f-d5dd-4920-8548-09207a27f58e');  -- גלית -> נטע

update clients c set created_by = m.new_id from _creator_map m where c.created_by = m.old_id;
update appointments a set created_by = m.new_id from _creator_map m where a.created_by = m.old_id;
update service_requests s set created_by = m.new_id from _creator_map m where s.created_by = m.old_id;

-- ===== תורים: מטפלת וטיפול לפי האפיון. מחיר ומשך מועתקים מהטיפול החדש =====
create temp table _appt (id uuid primary key, therapist uuid, treatment uuid, starts timestamptz) on commit drop;
insert into _appt values
  ('d1a98971-f3c0-457f-86a1-fbc152a27c26', (select l from _ids), '8b042fab-ae00-4586-9f25-687bfe69be4b', null),  -- אקנה -> פנים קלאסי, ליאת
  ('421776fe-6815-43d0-9a93-253333718d2a', (select l from _ids), '8b042fab-ae00-4586-9f25-687bfe69be4b', null),  -- היידרה-פייס -> פנים קלאסי, ליאת
  ('bb884603-3365-4d65-8b57-042bb5eab914', (select l from _ids), '34a4ec20-3a09-4d5f-a18d-b63983c5cb93',
     '2026-10-09 11:30 Asia/Jerusalem'),                                                                          -- הסרת שיער -> לייזר פנים, ליאת. מוקדם בשעה כדי לסיים עד 13:00 בשישי
  ('d9734457-c8e0-4451-af0e-194f1a46ba39', (select l from _ids), '8a3d0b7a-afb1-44a9-a9fc-620a2bd25195', null),  -- פילינג -> ניקוי פנים עמוק, ליאת
  ('0d7e35c3-9ec5-42ef-af86-8068540efe1b', (select l from _ids), null, null),                                     -- פנים קלאסי (בוטל), מורן -> ליאת
  ('faab3111-1417-4158-976c-7132de2acb24', (select l from _ids), null, null),                                     -- ניקוי עמוק, מורן -> ליאת
  ('df8ef47f-d063-41e7-a8c8-b927b17e4f80', (select n from _ids), null, null),                                     -- התייעצות, מורן -> נטע
  ('39f2749d-cb3e-43ed-aeec-2cc41bacb2d4', (select n from _ids), null, null),                                     -- התייעצות (בוטל), מורן -> נטע
  ('29f33eef-a702-4b0c-b461-eb27c3962ef1', (select n from _ids), null, null),                                     -- התייעצות, הדס -> נטע
  ('b2a0428f-9e5f-4081-ba02-7b73b5d9a600', null, 'e95ffc35-bb93-4b98-ae42-e15e230ad7cf', null),                   -- בוטוקס 3 אזורים -> אזור בודד
  ('11de97fc-7427-455f-b4a3-0fcecb3c1795', null, '179f2772-bc70-4099-96df-9bb082c58dc3', null);                   -- חומצה לשפתיים -> מילוי

update appointments a set
  therapist_id     = coalesce(x.therapist, a.therapist_id),
  treatment_id     = coalesce(x.treatment, a.treatment_id),
  starts_at        = coalesce(x.starts, a.starts_at),
  price            = coalesce(t.price, a.price),
  duration_minutes = coalesce(t.duration_minutes, a.duration_minutes)
from _appt x left join treatments t on t.id = x.treatment
where a.id = x.id;

-- ===== קריאות שירות: אחראית =====
update service_requests s set assigned_to = x.who from (values
  ('2e87ce0a-38a0-4e4c-9f9e-e5066303d12c'::uuid, (select n from _ids)),  -- תלונה על המתנה (גלית)
  ('3e898fc5-9184-4966-b4a8-b594dbd9edaf'::uuid, (select l from _ids)),  -- שובר מתנה (שירן)
  ('81c712a1-48bf-4630-837f-212bc91535cf'::uuid, (select l from _ids)),  -- חשבונית (שויכה לרותם ע"י שירן)
  ('dec1c89e-d48a-44a9-8ac6-504677b09935'::uuid, (select l from _ids)),  -- עור רגיש (הדס)
  ('51667ec5-9148-4372-b253-ca79cf4ef355'::uuid, (select l from _ids)),  -- מועד חלופי (מורן)
  ('2d5a56c4-fce0-4bdf-99a8-bc9eb8aa7482'::uuid, (select n from _ids)),  -- מחירון חומצה (שירן)
  ('09b9a04c-c9fd-43cf-85c4-d7d38d113af3'::uuid, (select l from _ids)),  -- שיחה חוזרת (מורן)
  ('6121cf44-851e-4a9a-8312-b9700f05b6e0'::uuid, (select l from _ids)),  -- צעיף (יעל)
  ('432e1cbd-fc6b-44fe-a2f5-ee4ae1c0d2d5'::uuid, (select r from _ids))   -- הנחה לסטודנטיות (עדי)
) as x(id, who) where s.id = x.id;

-- ===== התראות: נמענת ונוסח. רק רותם משייכת למישהי אחרת (מטפלת משייכת רק לעצמה) =====
update notifications set message = replace(message, 'שירן שייכה', 'רותם שייכה') where message like 'שירן שייכה%';
update notifications set message = replace(message, 'ליאת שייכה', 'רותם שייכה') where message like 'ליאת שייכה%';
update notifications o set recipient_id = x.who from (values
  ('1eb3961e-71c8-4bc2-977e-a69443de03c1'::uuid, (select n from _ids)),
  ('d231b660-d116-4e4e-adbf-3d8e56e3ed12'::uuid, (select l from _ids)),
  ('ae7c1ef5-0fee-4767-9b00-669148c3df8e'::uuid, (select l from _ids)),
  ('835e1730-505e-44b0-bb2f-2d6fc98fe2e9'::uuid, (select l from _ids)),
  ('2dfe690e-ac73-4ad5-a3f8-9bc7dd1f99e2'::uuid, (select l from _ids)),
  ('c7e0f316-7e1d-4197-93e1-7e5091806289'::uuid, (select n from _ids)),
  ('69c8cc99-41ec-420e-a7ee-c967c42aea63'::uuid, (select n from _ids)),
  ('4333fbf3-f30f-41bc-b829-71c2a00831e7'::uuid, (select l from _ids)),
  ('5a5d5b58-930b-4ae4-b0f1-042e8e36dbdc'::uuid, (select n from _ids))
) as x(id, who) where o.id = x.id;

-- ===== מחירון: רק 7 הטיפולים מהאפיון =====
delete from treatments where name not in (
  'התייעצות / טיפול ניסיון', 'טיפול פנים קלאסי', 'ניקוי פנים עמוק',
  'בוטוקס (אזור בודד)', 'חומצה היאלורונית (מילוי)',
  'טיפול לייזר (פנים מלא)', 'סדרת 6 טיפולי לייזר');

-- ===== צוות: רק 3. מחיקת המשתמשת ב-Auth מוחקת גם את שורת הצוות =====
delete from auth.users where id in (select id from staff where id not in (select r from _ids union all select l from _ids union all select n from _ids));

-- בדיקות: אם משהו לא תקין, הכול מתבטל
do $$
begin
  if (select count(*) from staff) <> 3 then raise exception 'staff: expected 3'; end if;
  if (select count(*) from treatments) <> 7 then raise exception 'treatments: expected 7'; end if;
  if (select count(*) from appointments) <> 20 then raise exception 'appointments changed'; end if;
  if (select count(*) from service_requests) <> 20 then raise exception 'requests changed'; end if;
  if (select count(*) from notifications) <> 20 then raise exception 'notifications changed'; end if;
  if (select count(*) from clients) <> 21 then raise exception 'clients changed'; end if;
  if exists (select 1 from clients where created_by is null)
     or exists (select 1 from appointments where created_by is null)
     or exists (select 1 from service_requests where created_by is null or assigned_to is null)
  then raise exception 'link lost'; end if;
end $$;

commit;
