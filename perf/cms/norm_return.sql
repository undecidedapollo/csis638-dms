\set user_id random(1, 10000)
BEGIN;
    UPDATE "Purchase"
    SET returned = true
    WHERE "purchaseId" = (
        SELECT "purchaseId"
        FROM "Purchase"
        WHERE "userId" = :user_id AND returned = false
        ORDER BY random()
        LIMIT 1
    ) AND "userId" = :user_id;
END;
