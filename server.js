const express = require('express');
const path = require('path');
const multer = require('multer');
const xlsx = require('xlsx');
const jwt = require('jsonwebtoken');
const { initDatabase, dbQuery, hashPassword } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'SiMumtazSecretJWTKeyForSchoolBookOrderApp123';

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for Excel file uploads in memory
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
      cb(null, true);
    } else {
      cb(new Error('Format file tidak didukung. Harap unggah file Excel (.xlsx, .xls) atau CSV.'));
    }
  }
});

// Admin JWT Authentication Middleware
function authenticateAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ message: 'Akses ditolak. Token tidak disediakan.' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Format token salah.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Token tidak valid atau kedaluwarsa.' });
  }
}

// ----------------------------------------------------
// PUBLIC API (PARENTS INTERFACE)
// ----------------------------------------------------

// Get books by class
app.get('/api/books/class/:class_name', async (req, res) => {
  const { class_name } = req.params;
  try {
    const books = await dbQuery.all('SELECT * FROM books WHERE kelas = ? ORDER BY name ASC', [class_name]);
    res.json(books);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Gagal mengambil daftar buku.' });
  }
});

// GET search student by name (Autocomplete)
app.get('/api/students/search', async (req, res) => {
  const { name } = req.query;
  if (!name || name.trim().length < 2) {
    return res.json([]);
  }

  try {
    const term = `%${name.toLowerCase()}%`;
    const matchedStudents = await dbQuery.all(
      'SELECT name, kelas, va_number, whatsapp, email FROM students WHERE LOWER(name) LIKE ? ORDER BY name ASC LIMIT 10',
      [term]
    );
    res.json(matchedStudents);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Gagal mencari data siswa.' });
  }
});

// Submit a new book order
app.post('/api/orders', async (req, res) => {
  const {
    student_name,
    class_name,
    va_number,
    parent_whatsapp,
    parent_email,
    book_ids, // array of IDs
    total_price
  } = req.body;

  if (!student_name || !class_name || !va_number || !parent_whatsapp || !parent_email || !book_ids || book_ids.length === 0) {
    return res.status(400).json({ message: 'Mohon lengkapi seluruh data dan pilih minimal satu buku.' });
  }

  try {
    // Fetch details of chosen books to freeze them in the order
    const placeholders = book_ids.map(() => '?').join(',');
    const books = await dbQuery.all(`SELECT name, publisher, price FROM books WHERE id IN (${placeholders})`, book_ids);
    
    const bookDetailsJson = JSON.stringify(books);
    const createdAt = new Date().toISOString();

    const result = await dbQuery.run(`
      INSERT INTO orders (student_name, class_name, va_number, parent_name, parent_whatsapp, parent_email, book_details, total_price, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [student_name, class_name, va_number, '', parent_whatsapp, parent_email, bookDetailsJson, total_price, createdAt]);

    res.status(201).json({
      message: 'Pesanan berhasil disimpan.',
      order_id: result.lastID
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Gagal menyimpan pesanan ke database.' });
  }
});


// ----------------------------------------------------
// ADMIN API
// ----------------------------------------------------

// Admin Login
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;

  if (!password) {
    return res.status(400).json({ message: 'Password wajib diisi.' });
  }

  try {
    const hashed = hashPassword(password);
    const adminPasswordRow = await dbQuery.get('SELECT value FROM settings WHERE key = ?', ['admin_password']);

    if (hashed === adminPasswordRow.value) {
      const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
      return res.json({ token });
    } else {
      return res.status(401).json({ message: 'Password yang Anda masukkan salah.' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
  }
});

// Admin change password
app.post('/api/admin/change-password', authenticateAdmin, async (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.trim().length < 4) {
    return res.status(400).json({ message: 'Password baru minimal 4 karakter.' });
  }

  try {
    const hashed = hashPassword(new_password);
    await dbQuery.run('UPDATE settings SET value = ? WHERE key = ?', [hashed, 'admin_password']);
    res.json({ message: 'Password admin berhasil diubah.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Gagal mengubah password.' });
  }
});

// Verify token validity
app.get('/api/admin/check', authenticateAdmin, (req, res) => {
  res.json({ valid: true });
});

// GET all books (admin view)
app.get('/api/admin/books', authenticateAdmin, async (req, res) => {
  try {
    const books = await dbQuery.all('SELECT * FROM books ORDER BY kelas ASC, name ASC');
    res.json(books);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Gagal mengambil data buku.' });
  }
});

// POST add new book
app.post('/api/admin/books', authenticateAdmin, async (req, res) => {
  const { kelas, name, publisher, price } = req.body;
  if (!kelas || !name || !publisher || price === undefined) {
    return res.status(400).json({ message: 'Mohon lengkapi semua field buku.' });
  }

  try {
    await dbQuery.run(
      'INSERT INTO books (kelas, name, publisher, price) VALUES (?, ?, ?, ?)',
      [kelas, name, publisher, parseInt(price)]
    );
    res.status(201).json({ message: 'Buku berhasil ditambahkan.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Gagal menambahkan buku.' });
  }
});

// PUT update book
app.put('/api/admin/books/:id', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  const { kelas, name, publisher, price } = req.body;

  if (!kelas || !name || !publisher || price === undefined) {
    return res.status(400).json({ message: 'Mohon lengkapi semua field buku.' });
  }

  try {
    const result = await dbQuery.run(
      'UPDATE books SET kelas = ?, name = ?, publisher = ?, price = ? WHERE id = ?',
      [kelas, name, publisher, parseInt(price), id]
    );

    if (result.changes === 0) {
      return res.status(404).json({ message: 'Buku tidak ditemukan.' });
    }

    res.json({ message: 'Buku berhasil diubah.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Gagal mengubah data buku.' });
  }
});

// DELETE single book
app.delete('/api/admin/books/:id', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await dbQuery.run('DELETE FROM books WHERE id = ?', [id]);
    if (result.changes === 0) {
      return res.status(404).json({ message: 'Buku tidak ditemukan.' });
    }
    res.json({ message: 'Buku berhasil dihapus.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Gagal menghapus buku.' });
  }
});

// DELETE all books in a class
app.delete('/api/admin/books/class/:class_name', authenticateAdmin, async (req, res) => {
  const { class_name } = req.params;
  try {
    const result = await dbQuery.run('DELETE FROM books WHERE kelas = ?', [class_name]);
    res.json({ message: `Berhasil menghapus ${result.changes} buku untuk Kelas ${class_name}.` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: `Gagal menghapus buku untuk Kelas ${class_name}.` });
  }
});

// POST import books from Excel/CSV
app.post('/api/admin/books/import', authenticateAdmin, upload.single('file'), async (req, res) => {
  const { kelas: defaultKelas } = req.body; // option to specify class from dropdown

  if (!req.file) {
    return res.status(400).json({ message: 'Harap unggah file Excel/CSV.' });
  }

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    // Convert sheet to JSON array
    const rows = xlsx.utils.sheet_to_json(worksheet);

    if (rows.length === 0) {
      return res.status(400).json({ message: 'File Excel kosong atau tidak terbaca.' });
    }

    let importedCount = 0;
    
    const nameKeys = ['namabuku', 'namabukusekolah', 'nama', 'name', 'bookname', 'judul', 'judulbuku'];
    const publisherKeys = ['penerbit', 'publisher'];
    const priceKeys = ['hargabuku', 'harga', 'price', 'hargabukusekolah'];
    const classKeys = ['kelas', 'class', 'tingkat', 'tingkatan'];

    for (const row of rows) {
      // Normalize row keys to lowercase alphanumeric only
      const normalizedRow = {};
      for (const key of Object.keys(row)) {
        if (key !== undefined && key !== null) {
          const normKey = key.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
          normalizedRow[normKey] = row[key];
        }
      }

      // Lookup values using normalized keys
      let name = '';
      for (const k of nameKeys) {
        if (normalizedRow[k] !== undefined && normalizedRow[k] !== null) {
          name = normalizedRow[k].toString().trim();
          break;
        }
      }

      let publisher = '';
      for (const k of publisherKeys) {
        if (normalizedRow[k] !== undefined && normalizedRow[k] !== null) {
          publisher = normalizedRow[k].toString().trim();
          break;
        }
      }

      let priceRaw = null;
      for (const k of priceKeys) {
        if (normalizedRow[k] !== undefined && normalizedRow[k] !== null) {
          priceRaw = normalizedRow[k];
          break;
        }
      }

      let kelasRaw = null;
      for (const k of classKeys) {
        if (normalizedRow[k] !== undefined && normalizedRow[k] !== null) {
          kelasRaw = normalizedRow[k];
          break;
        }
      }

      // Validate required fields
      if (!name || priceRaw === undefined || priceRaw === null) {
        continue; // skip invalid or empty rows
      }

      // Parse price, removing non-numeric characters (e.g. "Rp 75.000" -> 75000)
      const price = parseInt(priceRaw.toString().replace(/[^0-9]/g, '')) || 0;
      
      // Parse class, stripping non-numeric text (e.g. "Kelas 8" -> "8")
      const kelas = (kelasRaw ? kelasRaw.toString().trim().replace(/[^0-9]/g, '') : '') || defaultKelas;

      if (!kelas) {
        continue; // skip if class could not be resolved
      }

      await dbQuery.run(
        'INSERT INTO books (kelas, name, publisher, price) VALUES (?, ?, ?, ?)',
        [kelas, name, publisher || 'Sekolah Islam Mumtaz', price]
      );
      importedCount++;
    }

    res.json({ message: `Berhasil mengimpor ${importedCount} daftar buku.` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Gagal memproses file impor Excel.' });
  }
});

// ----------------------------------------------------
// ADMIN STUDENTS MANAGEMENT API
// ----------------------------------------------------

// GET all students (admin view)
app.get('/api/admin/students', authenticateAdmin, async (req, res) => {
  try {
    const students = await dbQuery.all('SELECT * FROM students ORDER BY kelas ASC, name ASC');
    res.json(students);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Gagal mengambil data siswa.' });
  }
});

// DELETE single student
app.delete('/api/admin/students/:id', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await dbQuery.run('DELETE FROM students WHERE id = ?', [id]);
    if (result.changes === 0) {
      return res.status(404).json({ message: 'Siswa tidak ditemukan.' });
    }
    res.json({ message: 'Siswa berhasil dihapus.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Gagal menghapus data siswa.' });
  }
});

// DELETE all students
app.delete('/api/admin/students-clear/all', authenticateAdmin, async (req, res) => {
  try {
    const result = await dbQuery.run('DELETE FROM students');
    res.json({ message: `Berhasil menghapus seluruh data siswa.` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Gagal menghapus data siswa.' });
  }
});

// POST import students from Excel/CSV
app.post('/api/admin/students/import', authenticateAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Harap unggah file Excel/CSV.' });
  }

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(worksheet);

    if (rows.length === 0) {
      return res.status(400).json({ message: 'File Excel kosong atau tidak terbaca.' });
    }

    let importedCount = 0;

    const nameKeys = ['namasiswa', 'nama', 'name', 'studentname', 'fullname'];
    const classKeys = ['kelas', 'class', 'tingkat'];
    const vaKeys = ['novirtualaccount', 'virtualaccount', 'nova', 'vanumber', 'no_va', 'va'];
    const whatsappKeys = ['nowhatsapp', 'whatsapp', 'nowa', 'wa', 'nomorwhatsapp', 'nomorwa', 'telepon', 'nohp', 'no_whatsapp'];
    const emailKeys = ['alamatemail', 'email', 'alamatemailorangtua', 'emailorangtua', 'parentemail', 'no_email'];

    for (const row of rows) {
      // Normalize keys
      const normalizedRow = {};
      for (const key of Object.keys(row)) {
        if (key !== undefined && key !== null) {
          const normKey = key.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
          normalizedRow[normKey] = row[key];
        }
      }

      // Lookup student properties
      let name = '';
      for (const k of nameKeys) {
        if (normalizedRow[k] !== undefined && normalizedRow[k] !== null) {
          name = normalizedRow[k].toString().trim();
          break;
        }
      }

      let kelasRaw = '';
      for (const k of classKeys) {
        if (normalizedRow[k] !== undefined && normalizedRow[k] !== null) {
          kelasRaw = normalizedRow[k].toString().trim();
          break;
        }
      }

      let vaRaw = '';
      for (const k of vaKeys) {
        if (normalizedRow[k] !== undefined && normalizedRow[k] !== null) {
          vaRaw = normalizedRow[k].toString().trim();
          break;
        }
      }

      let whatsappRaw = '';
      for (const k of whatsappKeys) {
        if (normalizedRow[k] !== undefined && normalizedRow[k] !== null) {
          whatsappRaw = normalizedRow[k].toString().trim();
          break;
        }
      }

      let emailRaw = '';
      for (const k of emailKeys) {
        if (normalizedRow[k] !== undefined && normalizedRow[k] !== null) {
          emailRaw = normalizedRow[k].toString().trim();
          break;
        }
      }

      if (!name || !kelasRaw || !vaRaw) {
        continue;
      }

      // Format class (strip non-numeric e.g. "Kelas 8" -> "8")
      const kelas = kelasRaw.replace(/[^0-9]/g, '');
      if (!kelas) continue;

      // Clean WhatsApp (ensure digits only, prefix digits)
      const whatsapp = whatsappRaw.replace(/[^0-9]/g, '');

      await dbQuery.run(
        'INSERT INTO students (name, kelas, va_number, whatsapp, email) VALUES (?, ?, ?, ?, ?)',
        [name, kelas, vaRaw, whatsapp || '', emailRaw || '']
      );
      
      importedCount++;
    }

    res.json({ message: `Berhasil mengimpor ${importedCount} data siswa.` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Gagal memproses file impor data siswa.' });
  }
});


// GET all orders (admin view)
app.get('/api/admin/orders', authenticateAdmin, async (req, res) => {
  try {
    const orders = await dbQuery.all('SELECT * FROM orders ORDER BY id DESC');
    // Parse book_details JSON string for client convenience
    const formattedOrders = orders.map(order => {
      try {
        order.book_details = JSON.parse(order.book_details);
      } catch (e) {
        order.book_details = [];
      }
      return order;
    });
    res.json(formattedOrders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Gagal mengambil data pesanan.' });
  }
});

// PUT update order
app.put('/api/admin/orders/:id', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  const {
    student_name,
    class_name,
    va_number,
    parent_name,
    parent_whatsapp,
    parent_email,
    book_details, // should be parsed array
    total_price
  } = req.body;

  if (!student_name || !class_name || !va_number || !parent_whatsapp || !parent_email || !book_details) {
    return res.status(400).json({ message: 'Data pesanan tidak lengkap.' });
  }

  try {
    const bookDetailsJson = JSON.stringify(book_details);
    const result = await dbQuery.run(`
      UPDATE orders 
      SET student_name = ?, class_name = ?, va_number = ?, parent_name = ?, parent_whatsapp = ?, parent_email = ?, book_details = ?, total_price = ?
      WHERE id = ?
    `, [student_name, class_name, va_number, parent_name, parent_whatsapp, parent_email, bookDetailsJson, total_price, id]);

    if (result.changes === 0) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan.' });
    }

    res.json({ message: 'Pesanan berhasil diperbarui.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Gagal memperbarui pesanan.' });
  }
});

// DELETE single order
app.delete('/api/admin/orders/:id', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await dbQuery.run('DELETE FROM orders WHERE id = ?', [id]);
    if (result.changes === 0) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan.' });
    }
    res.json({ message: 'Pesanan berhasil dihapus.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Gagal menghapus pesanan.' });
  }
});

// GET export orders to Excel
app.get('/api/admin/orders/export', authenticateAdmin, async (req, res) => {
  try {
    const orders = await dbQuery.all('SELECT * FROM orders ORDER BY id DESC');
    
    // Map data for clean Excel export
    const excelData = orders.map((order, index) => {
      let booksText = '';
      try {
        const books = JSON.parse(order.book_details);
        booksText = books.map(b => `${b.name} (${b.publisher}) - Rp ${b.price.toLocaleString('id-ID')}`).join('\n');
      } catch (e) {
        booksText = 'Gagal memuat detail';
      }

      // Format date
      const date = new Date(order.created_at);
      const formattedDate = date.toLocaleDateString('id-ID', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      return {
        'No.': index + 1,
        'ID Pesanan': `MUMTAZ-${order.id.toString().padStart(4, '0')}`,
        'Tanggal': formattedDate,
        'Nama Siswa': order.student_name,
        'Kelas': `Kelas ${order.class_name}`,
        'No. Virtual Account': order.va_number,
        'Nama Orang Tua': order.parent_name,
        'WhatsApp Orang Tua': order.parent_whatsapp,
        'Email Orang Tua': order.parent_email,
        'Buku yang Dipesan': booksText,
        'Total Harga (Rp)': order.total_price
      };
    });

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(excelData);
    
    // Adjust column widths roughly
    const wscols = [
      { wch: 5 },  // No.
      { wch: 15 }, // ID Pesanan
      { wch: 25 }, // Tanggal
      { wch: 20 }, // Nama Siswa
      { wch: 10 }, // Kelas
      { wch: 20 }, // No. VA
      { wch: 20 }, // Nama Orang Tua
      { wch: 20 }, // WhatsApp
      { wch: 25 }, // Email
      { wch: 50 }, // Buku yang Dipesan
      { wch: 18 }  // Total Harga
    ];
    ws['!cols'] = wscols;

    xlsx.utils.book_append_sheet(wb, ws, "Pesanan Buku Mumtaz");
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=daftar_pesanan_buku_mumtaz.xlsx');
    res.send(buffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Gagal mengekspor data pesanan.' });
  }
});

// GET export recap per class (Matrix format: Student x Books)
app.get('/api/admin/orders/export-recap', authenticateAdmin, async (req, res) => {
  const { kelas } = req.query; // 'all' or specific class e.g. '8'

  try {
    const classesToExport = kelas && kelas !== 'all' ? [kelas] : ['7', '8', '9', '10', '11', '12'];
    const wb = xlsx.utils.book_new();

    for (const cls of classesToExport) {
      // 1. Fetch books in this class
      const books = await dbQuery.all('SELECT id, name, price FROM books WHERE kelas = ? ORDER BY name ASC', [cls]);
      if (books.length === 0) {
        // If there are no books, write an informative sheet
        const emptyWs = xlsx.utils.json_to_sheet([{ 'Nama Siswa': 'Belum ada daftar buku di kelas ini' }]);
        xlsx.utils.book_append_sheet(wb, emptyWs, `Kelas ${cls}`);
        continue;
      }

      // 2. Fetch orders in this class
      const orders = await dbQuery.all('SELECT student_name, book_details FROM orders WHERE class_name = ? ORDER BY student_name ASC', [cls]);

      // 3. Construct rows
      const headers = ['Nama Siswa', ...books.map(b => b.name)];
      const sheetData = [];

      if (orders.length === 0) {
        // Empty state: list the header and a placeholder student
        const dummyRow = { 'Nama Siswa': 'Belum ada pesanan' };
        books.forEach(b => {
          dummyRow[b.name] = 0;
        });
        sheetData.push(dummyRow);
      } else {
        orders.forEach(order => {
          let orderedBooks = [];
          try {
            orderedBooks = JSON.parse(order.book_details);
          } catch (e) {
            orderedBooks = [];
          }

          const row = { 'Nama Siswa': order.student_name };
          
          books.forEach(book => {
            // Match order book by name (case-insensitive & trimmed to be safe)
            const isOrdered = orderedBooks.some(ob => ob.name.trim().toLowerCase() === book.name.trim().toLowerCase());
            row[book.name] = isOrdered ? book.price : 0;
          });

          sheetData.push(row);
        });
      }

      const ws = xlsx.utils.json_to_sheet(sheetData, { header: headers });
      
      // Auto-fit columns
      const wscols = [{ wch: 25 }]; // Nama Siswa
      books.forEach(b => {
        wscols.push({ wch: Math.max(b.name.length + 3, 14) });
      });
      ws['!cols'] = wscols;

      xlsx.utils.book_append_sheet(wb, ws, `Kelas ${cls}`);
    }

    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = kelas && kelas !== 'all' ? `rekap_pesanan_kelas_${kelas}.xlsx` : 'rekap_pesanan_buku_per_kelas.xlsx';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(buffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Gagal mengekspor rekap per kelas.' });
  }
});



// Catch-all route to serve index.html for undefined routes (excluding api)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const isVercel = !!process.env.VERCEL;

// Initialize DB and start server (or export for serverless environment)
initDatabase().then(() => {
  if (!isVercel) {
    app.listen(PORT, () => {
      console.log(`Server Sekolah Islam Mumtaz berjalan di http://localhost:${PORT}`);
    });
  } else {
    console.log('Database initialized successfully in Serverless mode (Vercel).');
  }
}).catch(err => {
  console.error('Gagal menginisialisasi database:', err);
  if (!isVercel) {
    process.exit(1);
  }
});

module.exports = app;

