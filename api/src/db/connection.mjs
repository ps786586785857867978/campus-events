import { Sequelize } from 'sequelize';
import { config } from '../config/env.mjs';

// Postgres when DATABASE_URL is set (production): the data lives in a real database server and
// survives restarts and deploys. Otherwise SQLite, so development and tests need no database server.
export const sequelize = config.databaseUrl
  ? new Sequelize(config.databaseUrl, { dialect: 'postgres', logging: false })
  : new Sequelize({ dialect: 'sqlite', storage: config.dbStorage, logging: false });
