\set user_id random(1, 10000)
\set amount random(1, 1000)
BEGIN;
    DO $$
    DECLARE
        last_purchase INT;
    BEGIN
        SELECT "purchaseId" INTO last_purchase FROM "Purchase" WHERE "userId" = :user_id ORDER BY "purchaseId" DESC LIMIT 1;
        INSERT INTO "Purchase" ("purchaseId", "userId", amount, returned) VALUES (last_purchase + 1, :user_id, :amount, false) ON CONFLICT DO NOTHING;
    END $$;
END;
