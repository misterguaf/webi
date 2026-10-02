-- FASE 3.5G.2A (Tresoreria operativa): a short concept for each expense ("Compra de material"), shown in
-- the expense list and detail. Additive; earlier migrations are unchanged. Existing expenses keep NULL
-- and are shown by their supplier. The revision history keeps the previous concept too.
ALTER TABLE finance_expense ADD COLUMN concept TEXT CHECK(concept IS NULL OR length(trim(concept)) BETWEEN 1 AND 120);
ALTER TABLE finance_expense_revision ADD COLUMN previous_concept TEXT;
