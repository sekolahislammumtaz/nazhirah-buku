// App variables
let loadedBooks = [];
let selectedBookIds = new Set();
let totalPrice = 0;

// Elements
const studentClassSelect = document.getElementById('student-class');
const booksSection = document.getElementById('books-section');
const booksListContainer = document.getElementById('books-list');
const bottomBar = document.getElementById('bottom-bar');
const priceTotalEl = document.getElementById('price-total');
const successModal = document.getElementById('success-modal');
const whatsappBtn = document.getElementById('whatsapp-btn');
const toastContainer = document.getElementById('toast-container');
const suggestionsBox = document.getElementById('autocomplete-suggestions');

// Toast Helper
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icon = document.createElement('i');
  icon.className = `toast-icon fa-solid ${type === 'success' ? 'fa-circle-check success' : 'fa-circle-exclamation error'}`;
  
  const text = document.createElement('span');
  text.innerText = message;
  
  toast.appendChild(icon);
  toast.appendChild(text);
  toastContainer.appendChild(toast);
  
  // Trigger entry animation
  setTimeout(() => {
    toast.classList.add('show');
  }, 10);
  
  // Auto remove
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3500);
}

// Format currency
function formatRupiah(number) {
  return 'Rp ' + number.toLocaleString('id-ID');
}

// Handle Student Name input for Autocomplete suggestions
async function handleStudentNameInput(val) {
  if (!val || val.trim().length < 2) {
    suggestionsBox.innerHTML = '';
    suggestionsBox.style.display = 'none';
    return;
  }

  try {
    const response = await fetch(`/api/students/search?name=${encodeURIComponent(val)}`);
    if (!response.ok) throw new Error();
    
    const students = await response.json();
    
    if (students.length === 0) {
      suggestionsBox.innerHTML = '<div style="padding: 12px 16px; color: var(--text-muted); font-size: 0.85rem; background: #FFF;">Siswa tidak ditemukan. Masukkan data secara manual.</div>';
      suggestionsBox.style.display = 'block';
      return;
    }

    suggestionsBox.innerHTML = '';
    
    students.forEach(student => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.onclick = () => selectStudent(student);
      
      item.innerHTML = `
        <span class="item-name">${student.name}</span>
        <span class="item-class">Kelas ${student.kelas}</span>
      `;
      suggestionsBox.appendChild(item);
    });
    
    suggestionsBox.style.display = 'block';
  } catch (error) {
    console.error(error);
  }
}

// Auto-fill form fields when a student is selected
function selectStudent(student) {
  document.getElementById('student-name').value = student.name;
  studentClassSelect.value = 'Kelas ' + student.kelas;
  document.getElementById('va-number').value = student.va_number;
  document.getElementById('parent-whatsapp').value = student.whatsapp || '';
  document.getElementById('parent-email').value = student.email || '';
  
  suggestionsBox.style.display = 'none';
  
  // Trigger class change to fetch the checklist of books automatically
  handleClassChange(student.kelas);
}

// Hide autocomplete popup when clicking outside the input
document.addEventListener('click', (e) => {
  const studentNameInput = document.getElementById('student-name');
  if (e.target !== studentNameInput && e.target !== suggestionsBox) {
    suggestionsBox.style.display = 'none';
  }
});

// Handle class dropdown change
async function handleClassChange(classVal) {
  if (!classVal) return;
  
  // Show loading state or clear previous selections
  booksListContainer.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Memuat daftar buku...</div>';
  booksSection.style.display = 'block';
  selectedBookIds.clear();
  calculateTotal();
  
  try {
    const response = await fetch(`/api/books/class/${classVal}`);
    if (!response.ok) {
      throw new Error('Gagal memuat buku');
    }
    
    loadedBooks = await response.json();
    renderBooksList();
  } catch (error) {
    console.error(error);
    showToast('Gagal memuat daftar buku untuk kelas ini. Coba lagi.', 'error');
    booksListContainer.innerHTML = '<div style="text-align:center; padding: 20px; color: #EF4444;"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat data.</div>';
  }
}

// Render checklist of books
function renderBooksList() {
  if (loadedBooks.length === 0) {
    booksListContainer.innerHTML = `
      <div style="text-align:center; padding: 20px; color: var(--text-muted);">
        Belum ada daftar buku untuk Kelas ${studentClassSelect.value}.
      </div>
    `;
    return;
  }
  
  booksListContainer.innerHTML = '';
  
  loadedBooks.forEach(book => {
    const label = document.createElement('label');
    label.className = 'book-item-label';
    label.id = `book-label-${book.id}`;
    
    // Checkbox input
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'book-checkbox';
    input.value = book.id;
    input.onchange = (e) => handleBookToggle(e, book.id, label);
    
    // Custom checkmark span
    const checkmark = document.createElement('span');
    checkmark.className = 'custom-checkmark';
    
    // Details wrapper
    const details = document.createElement('div');
    details.className = 'book-details';
    
    const name = document.createElement('span');
    name.className = 'book-name';
    name.innerText = book.name;
    
    const publisher = document.createElement('span');
    publisher.className = 'book-publisher';
    publisher.innerText = `Penerbit: ${book.publisher}`;
    
    details.appendChild(name);
    details.appendChild(publisher);
    
    // Price span
    const price = document.createElement('span');
    price.className = 'book-price';
    price.innerText = formatRupiah(book.price);
    
    // Append all
    label.appendChild(input);
    label.appendChild(checkmark);
    label.appendChild(details);
    label.appendChild(price);
    
    booksListContainer.appendChild(label);
  });
}

// Handle checkbox toggle
function handleBookToggle(event, bookId, labelElement) {
  if (event.target.checked) {
    selectedBookIds.add(bookId);
    labelElement.classList.add('selected-row');
  } else {
    selectedBookIds.delete(bookId);
    labelElement.classList.remove('selected-row');
  }
  calculateTotal();
}

// Calculate total price and update bottom floating bar
function calculateTotal() {
  totalPrice = 0;
  
  selectedBookIds.forEach(id => {
    const book = loadedBooks.find(b => b.id === id);
    if (book) {
      totalPrice += book.price;
    }
  });
  
  priceTotalEl.innerText = formatRupiah(totalPrice);
  
  // Show/hide bottom bar
  if (selectedBookIds.size > 0) {
    bottomBar.classList.add('show');
  } else {
    bottomBar.classList.remove('show');
  }
}

// Handle form submission
async function handleFormSubmit(event) {
  event.preventDefault();
  
  const studentName = document.getElementById('student-name').value.trim();
  const className = studentClassSelect.value.replace(/[^0-9]/g, '');
  const vaNumber = document.getElementById('va-number').value.trim();
  const parentWhatsapp = document.getElementById('parent-whatsapp').value.trim();
  const parentEmail = document.getElementById('parent-email').value.trim();
  
  if (selectedBookIds.size === 0) {
    showToast('Harap pilih minimal satu buku.', 'error');
    return;
  }

  const orderData = {
    student_name: studentName,
    class_name: className,
    va_number: vaNumber,
    parent_whatsapp: parentWhatsapp,
    parent_email: parentEmail,
    book_ids: Array.from(selectedBookIds),
    total_price: totalPrice
  };

  try {
    showToast('Menyimpan pesanan Anda...', 'success');

    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(orderData)
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.message || 'Gagal menyimpan pesanan');
    }

    // Book details formatted for WA
    const selectedBooks = loadedBooks.filter(b => selectedBookIds.has(b.id));
    const booksListText = selectedBooks.map(b => `- ${b.name} (${formatRupiah(b.price)})`).join('\n');
    
    // WA message template
    const waText = `Assalamu'alaikum. Saya orang tua dari ${studentName} dari Kelas ${className} VA no ${vaNumber} dengan email ${parentEmail} mau pesan buku berikut :\n${booksListText}\nTotal: ${formatRupiah(totalPrice)}\nJazakumullahu Khairan`;
    
    const waUrl = `https://wa.me/6289618600656?text=${encodeURIComponent(waText)}`;
    
    // Configure modal buttons and redirect action
    whatsappBtn.href = waUrl;
    
    // Clear form state
    document.getElementById('booking-form').reset();
    booksSection.style.display = 'none';
    selectedBookIds.clear();
    calculateTotal();
    
    // Display popup modal
    successModal.classList.add('show');
    
    // Trigger auto click redirect or help user
    whatsappBtn.onclick = () => {
      successModal.classList.remove('show');
    };

  } catch (error) {
    console.error(error);
    showToast(error.message || 'Terjadi kesalahan saat menyimpan pesanan.', 'error');
  }
}
