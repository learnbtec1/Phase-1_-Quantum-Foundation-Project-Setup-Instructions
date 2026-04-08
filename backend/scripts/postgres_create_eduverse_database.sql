-- Run as superuser on database `postgres` (after role `eduverse` exists).

-- Creates the app database name expected by docker-compose (POSTGRES_DB=eduverse).

--

-- If you see "already exists", skip — nothing to do.

CREATE DATABASE eduverse OWNER eduverse;
