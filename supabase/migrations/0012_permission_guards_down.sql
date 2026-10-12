-- ביטול 0012
drop trigger if exists field_permissions_target on field_permissions;
drop function if exists private.check_field_permission_target();
alter table role_permissions drop constraint if exists role_permissions_treatments_scope;
