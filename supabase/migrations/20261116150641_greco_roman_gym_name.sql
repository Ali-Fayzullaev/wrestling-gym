-- The gym teaches Greco-Roman wrestling, not freestyle (customer remark at acceptance, step 14).
-- Only a name nobody has changed yet is renamed: a name the owner set in Settings stays as is.
alter table public.settings
  alter column gym_name set default 'Зал греко-римской борьбы';

update public.settings
set gym_name = 'Зал греко-римской борьбы'
where gym_name = 'Зал вольной борьбы';
