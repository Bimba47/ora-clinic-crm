-- 0013: אובייקט הצוות נקרא "משתמשים", כמו בתפריט ההגדרות (כותרת הרשימה, חיפוש, חזרה מרשומה, קובץ ייצוא)
update view_objects set label_plural = 'משתמשים' where object_key = 'staff';
