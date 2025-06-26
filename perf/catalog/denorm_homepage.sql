\set showid0 random(1, 100)
\set showid1 random(1, 100)
\set showid2 random(1, 100)
\set showid3 random(1, 100)
\set showid4 random(1, 100)
\set showid5 random(1, 100)
\set showid6 random(1, 100)
\set showid7 random(1, 100)
\set showid8 random(1, 100)
\set showid9 random(1, 100)

BEGIN;
    SELECT
        show."showId",
        show."numSeasons",
        show."numEpisodes"
    FROM
        "Show" show
    WHERE
        show."showId" IN (:showid0, :showid1, :showid2, :showid3, :showid4, :showid5, :showid6, :showid7, :showid8, :showid9);
END;
