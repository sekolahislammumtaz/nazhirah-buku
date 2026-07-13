const path = require('path');
const crypto = require('crypto');

// Check database mode from environment variables
const dbUrl = process.env.DATABASE_URL ? process.env.DATABASE_URL.trim() : '';
const isPostgres = !!dbUrl && 
  (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://'));
const isLibsql = !isPostgres && !!process.env.TURSO_DATABASE_URL;

let db = null;         // for SQLite3
let client = null;     // for Turso LibSQL
let pgClient = null;   // for Neon PostgreSQL
let dbQuery = {};

// Helper function to hash password
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Dialect-specific placeholder converter (convert ? to $1, $2, etc.) for PostgreSQL
function convertPlaceholders(sql) {
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

if (isPostgres) {
  console.log('Database Mode: Cloud PostgreSQL (Neon)');
  const { Client } = require('pg');
  pgClient = new Client({
    connectionString: dbUrl,
    ssl: {
      rejectUnauthorized: false
    }
  });

  // DB wrappers for PostgreSQL
  dbQuery = {
    async run(sql, params = []) {
      let querySql = convertPlaceholders(sql);
      const isInsert = querySql.trim().toUpperCase().startsWith('INSERT');
      const isSettings = querySql.toUpperCase().includes('INTO SETTINGS');
      if (isInsert && !isSettings && !querySql.toUpperCase().includes('RETURNING')) {
        querySql += ' RETURNING id';
      }
      
      const res = await pgClient.query(querySql, params);
      
      let lastID = null;
      if (isInsert && res.rows && res.rows[0]) {
        lastID = res.rows[0].id;
      }
      return { lastID, changes: res.rowCount };
    },
    
    async get(sql, params = []) {
      const querySql = convertPlaceholders(sql);
      const res = await pgClient.query(querySql, params);
      return res.rows[0] || null;
    },
    
    async all(sql, params = []) {
      const querySql = convertPlaceholders(sql);
      const res = await pgClient.query(querySql, params);
      return res.rows;
    }
  };
} else if (isLibsql) {
  console.log('Database Mode: Turso Cloud LibSQL');
  const { createClient } = require('@libsql/client');
  client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
  });

  // DB wrappers for Turso
  dbQuery = {
    async run(sql, params = []) {
      const result = await client.execute({ sql, args: params });
      const lastID = typeof result.lastInsertRowid === 'bigint' 
        ? Number(result.lastInsertRowid) 
        : result.lastInsertRowid;
      return { lastID, changes: result.rowsAffected };
    },
    
    async get(sql, params = []) {
      const result = await client.execute({ sql, args: params });
      return result.rows[0] || null;
    },
    
    async all(sql, params = []) {
      const result = await client.execute({ sql, args: params });
      return result.rows;
    }
  };
} else {
  console.log('Database Mode: Local SQLite3 File');
  const sqlite3 = require('sqlite3').verbose();
  const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, 'mumtaz_buku.db');
  console.log('Using SQLite database file at:', dbPath);
  db = new sqlite3.Database(dbPath);

  // DB wrappers for local SQLite
  dbQuery = {
    run(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
          if (err) return reject(err);
          resolve({ lastID: this.lastID, changes: this.changes });
        });
      });
    },
    
    get(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
          if (err) return reject(err);
          resolve(row);
        });
      });
    },
    
    all(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        });
      });
    }
  };
}

// Initialize database schema
async function initDatabase() {
  const defaultPassword = 'SiMumtaz123';
  const hashed = hashPassword(defaultPassword);

  if (isPostgres) {
    // PostgreSQL async connection & table creations
    await pgClient.connect();

    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS books (
        id SERIAL PRIMARY KEY,
        kelas VARCHAR(50) NOT NULL,
        name TEXT NOT NULL,
        publisher TEXT NOT NULL,
        price INTEGER NOT NULL
      )
    `);

    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        student_name TEXT NOT NULL,
        class_name TEXT NOT NULL,
        va_number TEXT NOT NULL,
        parent_name TEXT NOT NULL,
        parent_whatsapp TEXT NOT NULL,
        parent_email TEXT NOT NULL,
        book_details TEXT NOT NULL,
        total_price INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        kelas VARCHAR(50) NOT NULL,
        va_number TEXT NOT NULL,
        whatsapp TEXT NOT NULL,
        email TEXT NOT NULL
      )
    `);

    // Seed default password if setting missing
    const row = await dbQuery.get('SELECT value FROM settings WHERE key = $1', ['admin_password']);
    if (!row) {
      await dbQuery.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['admin_password', hashed]);
      console.log('Database initialized on PostgreSQL (Neon). Default admin password set.');
    } else {
      console.log('Database initialized on PostgreSQL (Neon).');
    }

  } else if (isLibsql) {
    // LibSQL / Turso async schema initialization
    await client.execute(`
      CREATE TABLE IF NOT EXISTS books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kelas TEXT NOT NULL,
        name TEXT NOT NULL,
        publisher TEXT NOT NULL,
        price INTEGER NOT NULL
      )
    `);

    await client.execute(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_name TEXT NOT NULL,
        class_name TEXT NOT NULL,
        va_number TEXT NOT NULL,
        parent_name TEXT NOT NULL,
        parent_whatsapp TEXT NOT NULL,
        parent_email TEXT NOT NULL,
        book_details TEXT NOT NULL,
        total_price INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    await client.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    await client.execute(`
      CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        kelas TEXT NOT NULL,
        va_number TEXT NOT NULL,
        whatsapp TEXT NOT NULL,
        email TEXT NOT NULL
      )
    `);

    const row = await dbQuery.get('SELECT value FROM settings WHERE key = ?', ['admin_password']);
    if (!row) {
      await dbQuery.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['admin_password', hashed]);
      console.log('Database initialized on Turso. Default admin password set.');
    } else {
      console.log('Database initialized on Turso.');
    }

  } else {
    // Local SQLite Promise-wrapped schema initialization
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run(`
          CREATE TABLE IF NOT EXISTS books (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kelas TEXT NOT NULL,
            name TEXT NOT NULL,
            publisher TEXT NOT NULL,
            price INTEGER NOT NULL
          )
        `, (err) => { if (err) return reject(err); });

        db.run(`
          CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_name TEXT NOT NULL,
            class_name TEXT NOT NULL,
            va_number TEXT NOT NULL,
            parent_name TEXT NOT NULL,
            parent_whatsapp TEXT NOT NULL,
            parent_email TEXT NOT NULL,
            book_details TEXT NOT NULL,
            total_price INTEGER NOT NULL,
            created_at TEXT NOT NULL
          )
        `, (err) => { if (err) return reject(err); });

        db.run(`
          CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          )
        `, (err) => { if (err) return reject(err); });

        db.run(`
          CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            kelas TEXT NOT NULL,
            va_number TEXT NOT NULL,
            whatsapp TEXT NOT NULL,
            email TEXT NOT NULL
          )
        `, (err) => {
          if (err) return reject(err);
          
          db.get('SELECT value FROM settings WHERE key = ?', ['admin_password'], (err, row) => {
            if (err) return reject(err);
            if (!row) {
              db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['admin_password', hashed], (err) => {
                if (err) return reject(err);
                console.log('Database initialized locally. Default admin password set.');
                resolve();
              });
            } else {
              console.log('Database initialized locally.');
              resolve();
            }
          });
        });
      });
    });
  }
}

module.exports = {
  db,
  initDatabase,
  hashPassword,
  dbQuery
};
