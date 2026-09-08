import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dbPath = resolve("prisma", "dev.db");
mkdirSync(dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "Project" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "BattleMap" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "imagePath" TEXT,
  "gridSizePx" REAL NOT NULL,
  "gridOffsetX" REAL NOT NULL DEFAULT 0,
  "gridOffsetY" REAL NOT NULL DEFAULT 0,
  "distancePerSq" REAL NOT NULL DEFAULT 5,
  "widthSquares" INTEGER NOT NULL,
  "heightSquares" INTEGER NOT NULL,
  "wallsJson" TEXT NOT NULL,
  "terrainJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BattleMap_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "CreatureDefinition" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "sourceKey" TEXT,
  "sourceName" TEXT,
  "sourceSlug" TEXT,
  "importedAt" DATETIME,
  "importedJson" TEXT,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "data" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Encounter" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "mapId" TEXT,
  "name" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "snapshotJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Encounter_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Encounter_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "BattleMap" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "SimulationRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "encounterId" TEXT NOT NULL,
  "seed" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "rounds" INTEGER NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "metricsJson" TEXT NOT NULL,
  "eventLogJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SimulationRun_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
`);

db.close();
console.log(`Initialized SQLite database at ${dbPath}`);
