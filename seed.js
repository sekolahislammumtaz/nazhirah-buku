const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'mumtaz_buku.db');
console.log('Connecting to database at:', dbPath);

const db = new sqlite3.Database(dbPath);

const books = [
  // Kelas 7
  { kelas: '7', name: 'Matematika Kelas 7', publisher: 'Kemendikbud', price: 65000 },
  { kelas: '7', name: 'Ilmu Pengetahuan Alam Kelas 7', publisher: 'Erlangga', price: 78000 },
  { kelas: '7', name: 'Bahasa Indonesia Kelas 7', publisher: 'Kemendikbud', price: 55000 },
  { kelas: '7', name: 'Bahasa Inggris: English in Focus Kelas 7', publisher: 'Erlangga', price: 82000 },
  { kelas: '7', name: 'Pendidikan Agama Islam Kelas 7', publisher: 'Tiga Serangkai', price: 60000 },

  // Kelas 8
  { kelas: '8', name: 'Matematika Kelas 8', publisher: 'Kemendikbud', price: 68000 },
  { kelas: '8', name: 'Ilmu Pengetahuan Alam Kelas 8', publisher: 'Erlangga', price: 80000 },
  { kelas: '8', name: 'Ilmu Pengetahuan Sosial Kelas 8', publisher: 'Kemendikbud', price: 72000 },
  { kelas: '8', name: 'Bahasa Inggris Kelas 8', publisher: 'Erlangga', price: 85000 },
  { kelas: '8', name: 'Pendidikan Agama Islam Kelas 8', publisher: 'Tiga Serangkai', price: 62000 },

  // Kelas 9
  { kelas: '9', name: 'Matematika Kelas 9', publisher: 'Kemendikbud', price: 70000 },
  { kelas: '9', name: 'Ilmu Pengetahuan Alam Kelas 9', publisher: 'Erlangga', price: 85000 },
  { kelas: '9', name: 'Bahasa Indonesia Kelas 9', publisher: 'Kemendikbud', price: 58000 },
  { kelas: '9', name: 'Pendidikan Pancasila dan Kewarganegaraan Kelas 9', publisher: 'Kemendikbud', price: 52000 },
  { kelas: '9', name: 'Pendidikan Agama Islam Kelas 9', publisher: 'Tiga Serangkai', price: 65000 },

  // Kelas 10
  { kelas: '10', name: 'Matematika Wajib Kelas 10', publisher: 'Erlangga', price: 90000 },
  { kelas: '10', name: 'Fisika Kelas 10', publisher: 'Erlangga', price: 95000 },
  { kelas: '10', name: 'Kimia Kelas 10', publisher: 'Erlangga', price: 98000 },
  { kelas: '10', name: 'Biologi Kelas 10', publisher: 'Erlangga', price: 92000 },
  { kelas: '10', name: 'Sejarah Indonesia Kelas 10', publisher: 'Kemendikbud', price: 60000 },

  // Kelas 11
  { kelas: '11', name: 'Matematika Peminatan Kelas 11', publisher: 'Erlangga', price: 95000 },
  { kelas: '11', name: 'Fisika Kelas 11', publisher: 'Erlangga', price: 102000 },
  { kelas: '11', name: 'Kimia Kelas 11', publisher: 'Erlangga', price: 105000 },
  { kelas: '11', name: 'Biologi Kelas 11', publisher: 'Erlangga', price: 98000 },
  { kelas: '11', name: 'Bahasa Inggris Kelas 11', publisher: 'Kemendikbud', price: 68000 },

  // Kelas 12
  { kelas: '12', name: 'Matematika Wajib Kelas 12', publisher: 'Erlangga', price: 98000 },
  { kelas: '12', name: 'Fisika Kelas 12', publisher: 'Erlangga', price: 105000 },
  { kelas: '12', name: 'Kimia Kelas 12', publisher: 'Erlangga', price: 108000 },
  { kelas: '12', name: 'Biologi Kelas 12', publisher: 'Erlangga', price: 102000 },
  { kelas: '12', name: 'Pendidikan Agama Islam Kelas 12', publisher: 'Tiga Serangkai', price: 70000 }
];

db.serialize(() => {
  // Clear existing books to avoid duplication
  db.run('DELETE FROM books', (err) => {
    if (err) {
      console.error('Error clearing books:', err);
      process.exit(1);
    }
    console.log('Cleared existing books.');
  });

  const stmt = db.prepare('INSERT INTO books (kelas, name, publisher, price) VALUES (?, ?, ?, ?)');
  
  books.forEach(book => {
    stmt.run(book.kelas, book.name, book.publisher, book.price);
  });

  stmt.finalize((err) => {
    if (err) {
      console.error('Error finalizing inserts:', err);
      process.exit(1);
    }
    console.log('Seeded', books.length, 'books successfully.');
    db.close();
  });
});
