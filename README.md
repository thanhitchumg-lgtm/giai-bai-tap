# Giải Bài Tập Bằng Ảnh

Website cho người dùng chụp ảnh bài tập, chọn môn và cấp học, rồi nhận lời giải từng bước từ Gemini API của Google.

## Chức năng
- Chụp ảnh bằng camera (điện thoại) hoặc chọn ảnh từ máy.
- Kéo khung để chọn đúng phần bài tập, có nút xoay ảnh và chọn toàn ảnh.
- Chọn **chế độ giải**: Nhanh, Cân bằng hoặc Chính xác. Mỗi chế độ dùng một model Gemini và một mức "suy nghĩ" khác nhau.
- Website tự hỏi Google xem API key của bạn dùng được model nào; chế độ nào không dùng được sẽ bị làm mờ.
- Nếu model đang chọn bị quá tải hoặc lỗi, server tự thử lại rồi chuyển sang model khác và báo cho người dùng biết.
- Chọn môn (Toán, Lý, Hóa, Sinh, Anh, Văn, Sử, Địa, GDCD, Tin...) và cấp (Tiểu học, THCS, THPT, Đại học), hoặc để tự nhận diện.
- Lời giải hiển thị công thức toán đẹp (KaTeX).
- API key được giữ ở server, giới hạn số lượt gọi mỗi IP (mặc định 15 lượt/phút).

## Cách chạy
1. Cài Node.js bản 18 trở lên (nodejs.org).
2. Lấy API key: vào https://aistudio.google.com, đăng nhập Google, bấm **Get API key** rồi **Create API key**.
3. Sao chép file `.env.example` thành `.env`, mở ra và dán key vào dòng `GEMINI_API_KEY=`.
4. Mở terminal trong thư mục này và chạy:
   ```
   node server.js
   ```
5. Mở trình duyệt vào http://localhost:3000

Không cần chạy `npm install` vì dự án không dùng thư viện ngoài. Công thức toán cần có internet để tải KaTeX và marked từ CDN.

## Dùng thử trên điện thoại
Điện thoại và máy tính cần cùng mạng Wi-Fi. Mở `http://<địa chỉ IP máy tính>:3000` trên điện thoại. Lưu ý: một số trình duyệt chỉ cho mở camera trực tiếp trên HTTPS, nhưng nút "Chụp ảnh" dùng camera hệ thống nên thường vẫn hoạt động.

## Đưa lên mạng cho nhiều người dùng
Cần một nơi chạy Node.js (VPS, Render, Railway...). Đặt biến môi trường `GEMINI_API_KEY` trên nơi đó, không đưa file `.env` lên Git. Khi có nhiều người dùng, nên theo dõi hạn mức của Google và cân nhắc bật thanh toán.

## Tùy chỉnh (trong file `.env`)
- `MODEL_FAST`, `MODEL_BALANCED`, `MODEL_ACCURATE`: model cho từng chế độ. Mặc định là `gemini-3.1-flash-lite`, `gemini-3.7-flash`, `gemini-3.8-flash`. Khi Google đổi hoặc ngừng model, chỉ cần sửa các dòng này.
- `THINKING_FAST`, `THINKING_BALANCED`, `THINKING_ACCURATE`: mức suy nghĩ (`minimal`, `low`, `medium`, `high`, `default`). Mức thấp nhanh hơn nhưng bài khó có thể kém chính xác hơn. `gemini-3.8-flash` không nhận `minimal`.
- `DEFAULT_MODE`: chế độ mặc định (`fast`, `balanced`, `accurate`).
- `PORT`: đổi cổng.
- `RATE_LIMIT_PER_MIN`: số lượt giải tối đa mỗi phút cho một IP.
- `TIMEOUT_SECONDS`: thời gian chờ Google tối đa cho mỗi lần gọi (mặc định 60 giây).

Khi khởi động, terminal sẽ in ra từng chế độ đang dùng model nào và model đó có trong danh sách của Google hay không.

## Cấu trúc
- `server.js`: server, gọi Gemini, giữ API key.
- `public/index.html`, `style.css`, `app.js`: giao diện, công cụ cắt ảnh, hiển thị lời giải.

## Trang tĩnh trên Render (không còn màn hình đen "waking up")

- **Web Service** `giai-bai-tap`: chạy server.js (API giải bài, `/health`).
- **Static Site**: Publish directory = `public`, Build Command để trống. Trang này luôn bật, mở lên là hiện ngay và tự đánh thức Web Service, trong lúc chờ hiện "Đang tải, vui lòng chờ chút...".
- Nếu địa chỉ Web Service khác `https://giai-bai-tap.onrender.com`, sửa trong `public/config.js`.
- Tuỳ chọn: thêm biến `ALLOWED_ORIGIN` (địa chỉ Static Site) trong Environment của Web Service để chỉ trang đó được gọi API.
