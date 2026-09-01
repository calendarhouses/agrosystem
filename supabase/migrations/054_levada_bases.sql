-- Левада — службова ділянка (база), без культури в паспорті.
update public.farm_fields
set
  is_field = false,
  crop = ''
where lower(btrim(coalesce(canonical_name, name))) = 'левада'
   or lower(btrim(name)) = 'левада';
