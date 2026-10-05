-- 3.5H.3: the visible name of the 14-17 section is «Esculta». The internal code ESCOLTA is unchanged
-- (historical migrations, scopes and the legacy public form keep using it).
UPDATE section SET display_name='Esculta' WHERE code='ESCOLTA';
