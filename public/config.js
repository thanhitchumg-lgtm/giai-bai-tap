// Địa chỉ máy chủ giải bài (Web Service trên Render).
// - Trang tĩnh gọi sang máy chủ này để giải bài.
// - Khi chạy trên máy tính (localhost) hoặc khi trang và máy chủ cùng một địa chỉ thì dùng chung địa chỉ.
// Nếu sau này địa chỉ máy chủ đổi, chỉ cần sửa dòng địa chỉ bên dưới.
window.API_BASE =
  location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? ''
    : 'https://giai-bai-tap.onrender.com';
