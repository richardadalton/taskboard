// Runs before any module is imported in each fork process.
// Setting DB_PATH here means db.ts initialises with an in-memory database,
// giving every test file a clean, isolated database.
process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'
process.env.SESSION_SECRET = 'test-secret'
