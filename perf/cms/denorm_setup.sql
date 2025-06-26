DROP TRIGGER IF EXISTS "Purchase_User_isWhale_trigger" ON "Purchase";
DROP FUNCTION IF EXISTS "Purchase_User_isWhale"();
DROP FUNCTION IF EXISTS "Purchase_User_isWhale_reducers_forward"("accCur" FLOAT, "newRow" "Purchase");
DROP FUNCTION IF EXISTS "Purchase_User_isWhale_reducers_inverse"("accNext" FLOAT, "oldRow" "Purchase");


DROP TRIGGER IF EXISTS "Purchase_User_numberOfPurchases_trigger" ON "Purchase";
DROP FUNCTION IF EXISTS "Purchase_User_numberOfPurchases"();
DROP FUNCTION IF EXISTS "Purchase_User_numberOfPurchases_reducers_forward"("accCur" FLOAT, "newRow" "Purchase");
DROP FUNCTION IF EXISTS "Purchase_User_numberOfPurchases_reducers_inverse"("accNext" FLOAT, "oldRow" "Purchase");
    


DROP TRIGGER IF EXISTS "Purchase_User_numberOfReturns_trigger" ON "Purchase";
DROP FUNCTION IF EXISTS "Purchase_User_numberOfReturns"();
DROP FUNCTION IF EXISTS "Purchase_User_numberOfReturns_reducers_forward"("accCur" FLOAT, "newRow" "Purchase");
DROP FUNCTION IF EXISTS "Purchase_User_numberOfReturns_reducers_inverse"("accNext" FLOAT, "oldRow" "Purchase");
    


DROP TRIGGER IF EXISTS "Purchase_User_lifetimeValue_trigger" ON "Purchase";
DROP FUNCTION IF EXISTS "Purchase_User_lifetimeValue"();
DROP FUNCTION IF EXISTS "Purchase_User_lifetimeValue_reducers_forward"("accCur" FLOAT, "newRow" "Purchase");
DROP FUNCTION IF EXISTS "Purchase_User_lifetimeValue_reducers_inverse"("accNext" FLOAT, "oldRow" "Purchase");
    
DROP TABLE IF EXISTS "User";
CREATE TABLE "User" (
    "userId" FLOAT NOT NULL,
    "isWhale" FLOAT NOT NULL DEFAULT(0),
    "numberOfPurchases" FLOAT NOT NULL DEFAULT(0),
    "numberOfReturns" FLOAT NOT NULL DEFAULT(0),
    "lifetimeValue" FLOAT NOT NULL DEFAULT(0),
    PRIMARY KEY("userId")
);



DROP TABLE IF EXISTS "Purchase";
CREATE TABLE "Purchase" (
    "purchaseId" FLOAT NOT NULL,
    "userId" FLOAT NOT NULL,
    "amount" FLOAT NOT NULL,
    "returned" BOOLEAN NOT NULL,
    PRIMARY KEY("userId", "purchaseId")
);
        

DO $$
DECLARE
    -- Configuration variables
    num_users INT := 10000;
    min_purchases INT := 1;
    max_purchases INT := 200;

    num_purchases INT;
BEGIN
    DELETE FROM "User";
    DELETE FROM "Purchase";

    RAISE NOTICE 'Generating % users...', num_users;

    FOR userid IN 1..num_users LOOP
        INSERT INTO "User" ("userId") VALUES (userid::FLOAT);

        num_purchases := GREATEST(1, floor(random() * (max_purchases - min_purchases + 1) + min_purchases)::INT - 125);

        FOR purchaseid IN 1..num_purchases LOOP
            INSERT INTO "Purchase" ("purchaseId", "userId", "amount", "returned")
            VALUES (
                purchaseid::FLOAT,
                userid::FLOAT,
                (((random() * 1000) * 100)::INT)::FLOAT / 100.0, -- Convert to int w/ two decimal places in tens and ones place then back to float
                random() > 0.95
            );
        END LOOP;
    END LOOP;

    RAISE NOTICE 'Test data generation complete.';
END $$;

UPDATE "User" u
SET 
    "isWhale" = (SELECT COUNT(1) FROM "Purchase" WHERE "userId" = u."userId" AND amount > 975 AND returned = false),
    "numberOfReturns" = (SELECT COUNT(*) FROM "Purchase" WHERE "userId" = u."userId" AND returned = true),
    "numberOfPurchases" = (SELECT COUNT(*) FROM "Purchase" WHERE "userId" = u."userId" AND returned = false),
    "lifetimeValue" = (SELECT COALESCE(SUM(amount), 0) FROM "Purchase" WHERE "userId" = u."userId" AND returned = false)
;

CREATE OR REPLACE FUNCTION "Purchase_User_isWhale_reducers_forward"("accCur" FLOAT, "newRow" "Purchase")
        RETURNS FLOAT AS $$
        BEGIN
            RETURN 
                        case ((("newRow"."returned" = false) AND ("newRow"."amount" > 975)))
                        when true then
                            ("accCur" + 1)
                        else "accCur"
                        END case
                    ;
        END;
        $$ LANGUAGE plpgsql;
    

        
    CREATE OR REPLACE FUNCTION "Purchase_User_isWhale_reducers_inverse"("accNext" FLOAT, "oldRow" "Purchase")
        RETURNS FLOAT AS $$
        BEGIN
            RETURN 
                        case ((("oldRow"."returned" = false) AND ("oldRow"."amount" > 975)))
                        when true then
                            ("accNext" - 1)
                        else "accNext"
                        END case
                    ;
        END;
        $$ LANGUAGE plpgsql;
    
    

        CREATE OR REPLACE FUNCTION "Purchase_User_isWhale"()
        RETURNS TRIGGER AS $$
        BEGIN
            -- Handle INSERT operation
            IF (TG_OP = 'INSERT') THEN
                UPDATE "User"
                SET "isWhale" = "Purchase_User_isWhale_reducers_forward"("User"."isWhale", NEW)
                WHERE (NEW."userId" = "User"."userId");
                RETURN NEW;

            -- Handle UPDATE operation
            ELSIF (TG_OP = 'UPDATE') THEN
                UPDATE "User"
                SET "isWhale" = "Purchase_User_isWhale_reducers_inverse"("User"."isWhale", OLD)
                WHERE (OLD."userId" = "User"."userId");

                UPDATE "User"
                SET "isWhale" = "Purchase_User_isWhale_reducers_forward"("User"."isWhale", NEW)
                WHERE (NEW."userId" = "User"."userId");
                RETURN NEW;

            -- Handle DELETE operation
            ELSIF (TG_OP = 'DELETE') THEN
                UPDATE "User"
                SET "isWhale" = "Purchase_User_isWhale_reducers_inverse"("User"."isWhale", OLD)
                WHERE (OLD."userId" = "User"."userId");
                RETURN OLD;
            END IF;

            -- This part should not be reached, but it's good practice
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER "Purchase_User_isWhale_trigger"
        AFTER INSERT OR UPDATE OR DELETE ON "Purchase"
        FOR EACH ROW EXECUTE FUNCTION "Purchase_User_isWhale"();
    


        
        
    CREATE OR REPLACE FUNCTION "Purchase_User_numberOfPurchases_reducers_forward"("accCur" FLOAT, "newRow" "Purchase")
        RETURNS FLOAT AS $$
        BEGIN
            RETURN ("accCur" + 1);
        END;
        $$ LANGUAGE plpgsql;
    

        
    CREATE OR REPLACE FUNCTION "Purchase_User_numberOfPurchases_reducers_inverse"("accNext" FLOAT, "oldRow" "Purchase")
        RETURNS FLOAT AS $$
        BEGIN
            RETURN ("accNext" - 1);
        END;
        $$ LANGUAGE plpgsql;
    
    

        CREATE OR REPLACE FUNCTION "Purchase_User_numberOfPurchases"()
        RETURNS TRIGGER AS $$
        BEGIN
            -- Handle INSERT operation
            IF (TG_OP = 'INSERT') THEN
                UPDATE "User"
                SET "numberOfPurchases" = "Purchase_User_numberOfPurchases_reducers_forward"("User"."numberOfPurchases", NEW)
                WHERE ((NEW."userId" = "User"."userId") AND (NEW."returned" = false));
                RETURN NEW;

            -- Handle UPDATE operation
            ELSIF (TG_OP = 'UPDATE') THEN
                UPDATE "User"
                SET "numberOfPurchases" = "Purchase_User_numberOfPurchases_reducers_inverse"("User"."numberOfPurchases", OLD)
                WHERE ((OLD."userId" = "User"."userId") AND (OLD."returned" = false));

                UPDATE "User"
                SET "numberOfPurchases" = "Purchase_User_numberOfPurchases_reducers_forward"("User"."numberOfPurchases", NEW)
                WHERE ((NEW."userId" = "User"."userId") AND (NEW."returned" = false));
                RETURN NEW;

            -- Handle DELETE operation
            ELSIF (TG_OP = 'DELETE') THEN
                UPDATE "User"
                SET "numberOfPurchases" = "Purchase_User_numberOfPurchases_reducers_inverse"("User"."numberOfPurchases", OLD)
                WHERE ((OLD."userId" = "User"."userId") AND (OLD."returned" = false));
                RETURN OLD;
            END IF;

            -- This part should not be reached, but it's good practice
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER "Purchase_User_numberOfPurchases_trigger"
        AFTER INSERT OR UPDATE OR DELETE ON "Purchase"
        FOR EACH ROW EXECUTE FUNCTION "Purchase_User_numberOfPurchases"();
    


        
        
    CREATE OR REPLACE FUNCTION "Purchase_User_numberOfReturns_reducers_forward"("accCur" FLOAT, "newRow" "Purchase")
        RETURNS FLOAT AS $$
        BEGIN
            RETURN ("accCur" + 1);
        END;
        $$ LANGUAGE plpgsql;
    

        
    CREATE OR REPLACE FUNCTION "Purchase_User_numberOfReturns_reducers_inverse"("accNext" FLOAT, "oldRow" "Purchase")
        RETURNS FLOAT AS $$
        BEGIN
            RETURN ("accNext" - 1);
        END;
        $$ LANGUAGE plpgsql;
    
    

        CREATE OR REPLACE FUNCTION "Purchase_User_numberOfReturns"()
        RETURNS TRIGGER AS $$
        BEGIN
            -- Handle INSERT operation
            IF (TG_OP = 'INSERT') THEN
                UPDATE "User"
                SET "numberOfReturns" = "Purchase_User_numberOfReturns_reducers_forward"("User"."numberOfReturns", NEW)
                WHERE ((NEW."userId" = "User"."userId") AND (NEW."returned" = true));
                RETURN NEW;

            -- Handle UPDATE operation
            ELSIF (TG_OP = 'UPDATE') THEN
                UPDATE "User"
                SET "numberOfReturns" = "Purchase_User_numberOfReturns_reducers_inverse"("User"."numberOfReturns", OLD)
                WHERE ((OLD."userId" = "User"."userId") AND (OLD."returned" = true));

                UPDATE "User"
                SET "numberOfReturns" = "Purchase_User_numberOfReturns_reducers_forward"("User"."numberOfReturns", NEW)
                WHERE ((NEW."userId" = "User"."userId") AND (NEW."returned" = true));
                RETURN NEW;

            -- Handle DELETE operation
            ELSIF (TG_OP = 'DELETE') THEN
                UPDATE "User"
                SET "numberOfReturns" = "Purchase_User_numberOfReturns_reducers_inverse"("User"."numberOfReturns", OLD)
                WHERE ((OLD."userId" = "User"."userId") AND (OLD."returned" = true));
                RETURN OLD;
            END IF;

            -- This part should not be reached, but it's good practice
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER "Purchase_User_numberOfReturns_trigger"
        AFTER INSERT OR UPDATE OR DELETE ON "Purchase"
        FOR EACH ROW EXECUTE FUNCTION "Purchase_User_numberOfReturns"();
    


        
        
    CREATE OR REPLACE FUNCTION "Purchase_User_lifetimeValue_reducers_forward"("accCur" FLOAT, "newRow" "Purchase")
        RETURNS FLOAT AS $$
        BEGIN
            RETURN ("accCur" + "newRow"."amount");
        END;
        $$ LANGUAGE plpgsql;
    

        
    CREATE OR REPLACE FUNCTION "Purchase_User_lifetimeValue_reducers_inverse"("accNext" FLOAT, "oldRow" "Purchase")
        RETURNS FLOAT AS $$
        BEGIN
            RETURN ("accNext" - "oldRow"."amount");
        END;
        $$ LANGUAGE plpgsql;
    
    

        CREATE OR REPLACE FUNCTION "Purchase_User_lifetimeValue"()
        RETURNS TRIGGER AS $$
        BEGIN
            -- Handle INSERT operation
            IF (TG_OP = 'INSERT') THEN
                UPDATE "User"
                SET "lifetimeValue" = "Purchase_User_lifetimeValue_reducers_forward"("User"."lifetimeValue", NEW)
                WHERE ((NEW."userId" = "User"."userId") AND (NEW."returned" = false));
                RETURN NEW;

            -- Handle UPDATE operation
            ELSIF (TG_OP = 'UPDATE') THEN
                UPDATE "User"
                SET "lifetimeValue" = "Purchase_User_lifetimeValue_reducers_inverse"("User"."lifetimeValue", OLD)
                WHERE ((OLD."userId" = "User"."userId") AND (OLD."returned" = false));

                UPDATE "User"
                SET "lifetimeValue" = "Purchase_User_lifetimeValue_reducers_forward"("User"."lifetimeValue", NEW)
                WHERE ((NEW."userId" = "User"."userId") AND (NEW."returned" = false));
                RETURN NEW;

            -- Handle DELETE operation
            ELSIF (TG_OP = 'DELETE') THEN
                UPDATE "User"
                SET "lifetimeValue" = "Purchase_User_lifetimeValue_reducers_inverse"("User"."lifetimeValue", OLD)
                WHERE ((OLD."userId" = "User"."userId") AND (OLD."returned" = false));
                RETURN OLD;
            END IF;

            -- This part should not be reached, but it's good practice
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER "Purchase_User_lifetimeValue_trigger"
        AFTER INSERT OR UPDATE OR DELETE ON "Purchase"
        FOR EACH ROW EXECUTE FUNCTION "Purchase_User_lifetimeValue"();
    

VACUUM;
ANALYZE;
