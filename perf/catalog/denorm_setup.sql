
DROP TRIGGER IF EXISTS "Seasons_Show_numSeasons_trigger" ON "Seasons";
DROP FUNCTION IF EXISTS "Seasons_Show_numSeasons"();
DROP FUNCTION IF EXISTS "Seasons_Show_numSeasons_reducers_forward"("accCur" FLOAT, "newRow" "Seasons");
DROP FUNCTION IF EXISTS "Seasons_Show_numSeasons_reducers_inverse"("accNext" FLOAT, "oldRow" "Seasons");


DROP TRIGGER IF EXISTS "Episode_Show_numEpisodes_trigger" ON "Episode";
DROP FUNCTION IF EXISTS "Episode_Show_numEpisodes"();
DROP FUNCTION IF EXISTS "Episode_Show_numEpisodes_reducers_forward"("accCur" FLOAT, "newRow" "Episode");
DROP FUNCTION IF EXISTS "Episode_Show_numEpisodes_reducers_inverse"("accNext" FLOAT, "oldRow" "Episode");


DROP TRIGGER IF EXISTS "Episode_Seasons_numEpisodes_trigger" ON "Episode";
DROP FUNCTION IF EXISTS "Episode_Seasons_numEpisodes"();
DROP FUNCTION IF EXISTS "Episode_Seasons_numEpisodes_reducers_forward"("accCur" FLOAT, "newRow" "Episode");
DROP FUNCTION IF EXISTS "Episode_Seasons_numEpisodes_reducers_inverse"("accNext" FLOAT, "oldRow" "Episode");

DROP TABLE IF EXISTS "Show";
CREATE TABLE "Show" (
    "showId" FLOAT NOT NULL,
    "numSeasons" FLOAT NOT NULL DEFAULT (0.0),
    "numEpisodes" FLOAT NOT NULL DEFAULT (0.0),
    PRIMARY KEY ("showId")
);

DROP TABLE IF EXISTS "Seasons";
CREATE TABLE "Seasons" (
    "showId" FLOAT NOT NULL,
    "seasonId" FLOAT NOT NULL,
    "numEpisodes" FLOAT NOT NULL DEFAULT (0.0),
    PRIMARY KEY ("showId", "seasonId")
);


DROP TABLE IF EXISTS "Episode";
CREATE TABLE "Episode" (
    "showId" FLOAT NOT NULL,
    "seasonId" FLOAT NOT NULL,
    "episodeId" FLOAT NOT NULL,
    PRIMARY KEY ("showId", "seasonId", "episodeId")
);

DO $$
DECLARE
    -- Configuration variables
    num_shows INT := 10000;
    min_season INT := 1;
    max_season INT := 15;
    min_episode INT := 3;
    max_episode INT := 27;

    num_seasons INT;
    num_episodes INT;
BEGIN
    RAISE NOTICE 'Deleting existing data...';
    DELETE FROM "Show";
    DELETE FROM "Seasons";
    DELETE FROM "Episode";

    RAISE NOTICE 'Generating % shows...', num_shows;

    FOR showid IN 1..num_shows LOOP
        INSERT INTO "Show" ("showId") VALUES (showid::FLOAT);

        num_seasons := floor(random() * (max_season - min_season + 1) + min_season)::INT;

        FOR seasonid IN 1..num_seasons LOOP
            INSERT INTO "Seasons" ("showId", "seasonId")
            VALUES (
                showid::FLOAT,
                seasonid
            );

            num_episodes := floor(random() * (max_episode - min_episode + 1) + min_episode)::INT;

            FOR episodeid IN 1..num_episodes LOOP
                INSERT INTO "Episode" ("showId", "seasonId", "episodeId")
                VALUES (
                    showid::FLOAT,
                    seasonid,
                    episodeid
                );
            END LOOP;
        END LOOP;
    END LOOP;

    RAISE NOTICE 'Test data generation complete.';
END $$;


UPDATE "Show" s
SET 
    "numSeasons" = (SELECT COUNT(ss."seasonId") FROM "Seasons" ss WHERE ss."showId" = s."showId"),
    "numEpisodes" = (SELECT COUNT(ep."episodeId") FROM "Episode" ep WHERE ep."showId" = s."showId")
;

UPDATE "Seasons" s
SET 
    "numEpisodes" = (SELECT COUNT(ep."episodeId") FROM "Episode" ep WHERE ep."seasonId" = s."seasonId" AND ep."showId" = s."showId")
;

    CREATE OR REPLACE FUNCTION "Seasons_Show_numSeasons_reducers_forward"("accCur" FLOAT, "newRow" "Seasons")
        RETURNS FLOAT AS $$
        BEGIN
            RETURN ("accCur" + 1);
        END;
        $$ LANGUAGE plpgsql;
    

        
    CREATE OR REPLACE FUNCTION "Seasons_Show_numSeasons_reducers_inverse"("accNext" FLOAT, "oldRow" "Seasons")
        RETURNS FLOAT AS $$
        BEGIN
            RETURN ("accNext" - 1);
        END;
        $$ LANGUAGE plpgsql;
    
    

        CREATE OR REPLACE FUNCTION "Seasons_Show_numSeasons"()
        RETURNS TRIGGER AS $$
        BEGIN
            -- Handle INSERT operation
            IF (TG_OP = 'INSERT') THEN
                UPDATE "Show"
                SET "numSeasons" = "Seasons_Show_numSeasons_reducers_forward"("Show"."numSeasons", NEW)
                WHERE (NEW."showId" = "Show"."showId");
                RETURN NEW;

            -- Handle UPDATE operation
            ELSIF (TG_OP = 'UPDATE') THEN
                UPDATE "Show"
                SET "numSeasons" = "Seasons_Show_numSeasons_reducers_inverse"("Show"."numSeasons", OLD)
                WHERE (OLD."showId" = "Show"."showId");

                UPDATE "Show"
                SET "numSeasons" = "Seasons_Show_numSeasons_reducers_forward"("Show"."numSeasons", NEW)
                WHERE (NEW."showId" = "Show"."showId");
                RETURN NEW;

            -- Handle DELETE operation
            ELSIF (TG_OP = 'DELETE') THEN
                UPDATE "Show"
                SET "numSeasons" = "Seasons_Show_numSeasons_reducers_inverse"("Show"."numSeasons", OLD)
                WHERE (OLD."showId" = "Show"."showId");
                RETURN OLD;
            END IF;

            -- This part should not be reached, but it's good practice
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER "Seasons_Show_numSeasons_trigger"
        AFTER INSERT OR UPDATE OR DELETE ON "Seasons"
        FOR EACH ROW EXECUTE FUNCTION "Seasons_Show_numSeasons"();
    


        
        
    CREATE OR REPLACE FUNCTION "Episode_Show_numEpisodes_reducers_forward"("accCur" FLOAT, "newRow" "Episode")
        RETURNS FLOAT AS $$
        BEGIN
            RETURN ("accCur" + 1);
        END;
        $$ LANGUAGE plpgsql;
    

        
    CREATE OR REPLACE FUNCTION "Episode_Show_numEpisodes_reducers_inverse"("accNext" FLOAT, "oldRow" "Episode")
        RETURNS FLOAT AS $$
        BEGIN
            RETURN ("accNext" - 1);
        END;
        $$ LANGUAGE plpgsql;
    
    

        CREATE OR REPLACE FUNCTION "Episode_Show_numEpisodes"()
        RETURNS TRIGGER AS $$
        BEGIN
            -- Handle INSERT operation
            IF (TG_OP = 'INSERT') THEN
                UPDATE "Show"
                SET "numEpisodes" = "Episode_Show_numEpisodes_reducers_forward"("Show"."numEpisodes", NEW)
                WHERE (NEW."showId" = "Show"."showId");
                RETURN NEW;

            -- Handle UPDATE operation
            ELSIF (TG_OP = 'UPDATE') THEN
                UPDATE "Show"
                SET "numEpisodes" = "Episode_Show_numEpisodes_reducers_inverse"("Show"."numEpisodes", OLD)
                WHERE (OLD."showId" = "Show"."showId");

                UPDATE "Show"
                SET "numEpisodes" = "Episode_Show_numEpisodes_reducers_forward"("Show"."numEpisodes", NEW)
                WHERE (NEW."showId" = "Show"."showId");
                RETURN NEW;

            -- Handle DELETE operation
            ELSIF (TG_OP = 'DELETE') THEN
                UPDATE "Show"
                SET "numEpisodes" = "Episode_Show_numEpisodes_reducers_inverse"("Show"."numEpisodes", OLD)
                WHERE (OLD."showId" = "Show"."showId");
                RETURN OLD;
            END IF;

            -- This part should not be reached, but it's good practice
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER "Episode_Show_numEpisodes_trigger"
        AFTER INSERT OR UPDATE OR DELETE ON "Episode"
        FOR EACH ROW EXECUTE FUNCTION "Episode_Show_numEpisodes"();
    


        
        
    
    CREATE OR REPLACE FUNCTION "Episode_Seasons_numEpisodes_reducers_forward"("accCur" FLOAT, "newRow" "Episode")
        RETURNS FLOAT AS $$
        BEGIN
            RETURN ("accCur" + 1);
        END;
        $$ LANGUAGE plpgsql;
    

        
    CREATE OR REPLACE FUNCTION "Episode_Seasons_numEpisodes_reducers_inverse"("accNext" FLOAT, "oldRow" "Episode")
        RETURNS FLOAT AS $$
        BEGIN
            RETURN ("accNext" - 1);
        END;
        $$ LANGUAGE plpgsql;
    
    

        CREATE OR REPLACE FUNCTION "Episode_Seasons_numEpisodes"()
        RETURNS TRIGGER AS $$
        BEGIN
            -- Handle INSERT operation
            IF (TG_OP = 'INSERT') THEN
                UPDATE "Seasons"
                SET "numEpisodes" = "Episode_Seasons_numEpisodes_reducers_forward"("Seasons"."numEpisodes", NEW)
                WHERE ((NEW."showId" = "Seasons"."showId") AND (NEW."seasonId" = "Seasons"."seasonId"));
                RETURN NEW;

            -- Handle UPDATE operation
            ELSIF (TG_OP = 'UPDATE') THEN
                UPDATE "Seasons"
                SET "numEpisodes" = "Episode_Seasons_numEpisodes_reducers_inverse"("Seasons"."numEpisodes", OLD)
                WHERE ((OLD."showId" = "Seasons"."showId") AND (OLD."seasonId" = "Seasons"."seasonId"));

                UPDATE "Seasons"
                SET "numEpisodes" = "Episode_Seasons_numEpisodes_reducers_forward"("Seasons"."numEpisodes", NEW)
                WHERE ((NEW."showId" = "Seasons"."showId") AND (NEW."seasonId" = "Seasons"."seasonId"));
                RETURN NEW;

            -- Handle DELETE operation
            ELSIF (TG_OP = 'DELETE') THEN
                UPDATE "Seasons"
                SET "numEpisodes" = "Episode_Seasons_numEpisodes_reducers_inverse"("Seasons"."numEpisodes", OLD)
                WHERE ((OLD."showId" = "Seasons"."showId") AND (OLD."seasonId" = "Seasons"."seasonId"));
                RETURN OLD;
            END IF;

            -- This part should not be reached, but it's good practice
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER "Episode_Seasons_numEpisodes_trigger"
        AFTER INSERT OR UPDATE OR DELETE ON "Episode"
        FOR EACH ROW EXECUTE FUNCTION "Episode_Seasons_numEpisodes"();
    

VACUUM;
ANALYZE;
