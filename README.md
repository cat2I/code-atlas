# Code Atlas

Công cụ đọc code **Python và C** bằng canvas, dành cho AI locomotion, Raspberry Pi và STM32.

## Dùng ngay trong VS Code

Mở file `.py`, `.c` hoặc `.h`, rồi nhấn **Ctrl+Shift+V** (macOS: **Cmd+Shift+V**). Code Atlas mở bản đồ ngay bên cạnh editor như Markdown Preview; không tạo file bản đồ. Mặc định chỉ hiển thị file đang mở. Chọn **Thư mục** trong panel để nối hàm giữa các file Python/C của workspace. Chọn một block để đọc code và các lời gọi; nhấp đúp block hoặc bấm **Về code ở dòng này** để nhảy về editor. Khi sửa code, kể cả chưa lưu, bản đồ tự cập nhật. Bố cục và ghi chú lưu trong trạng thái VS Code của workspace.

Build và cài bản dùng riêng:

```bash
cd /home/cat21/Documents/projects/code-atlas
npm install
npm run package:extension
code --install-extension artifacts/code-atlas-0.1.0.vsix
```

VSIX dùng cục bộ, không cần tài khoản hay dịch vụ cloud. Mã nguồn được phân tích tại máy, không thực thi và không tải lên server. Có giới hạn 120 file, 500 KB/file và 3 MB code cho mỗi bản đồ. Xem thêm [hướng dẫn extension](vscode/README.md).

## Bản web độc lập

```bash
cd /home/cat21/Documents/projects/code-atlas
npm install
npm run build
npm run dev
```

Mở http://127.0.0.1:4173. Server chỉ nghe trên loopback. `dist/` cũng có thể phục vụ bằng bất kỳ static HTTP server nào; không mở trực tiếp bằng `file://` vì app dùng Web Worker.

## Cách đọc code

1. Bấm **Mở code** và chọn các file `.py`, `.c`, `.h`, thư mục dự án hoặc dán code. Chọn các module liên quan để bản đồ dễ đọc.
   - Với package Python thật, **ưu tiên “Mở thư mục”**: trình duyệt chỉ gửi tên file khi chọn nhiều file, nên các `__init__.py` ở package khác nhau sẽ bị trùng tên (app tự đổi thành `__init__~2.py` và cảnh báo) và import tương đối sẽ không nối được.
2. Bấm **Phân tích code**. Các hàm xuất hiện thành khối, nhóm theo file. Method của cùng một class nằm trong khung riêng, nhãn ghi `class Tên(BaseClass)`.
3. Bắt đầu với `control_loop`, `step`, `main` hoặc callback HAL. Bấm vào hàm để xem code gốc, vị trí dòng, người gọi và hàm được gọi. Chọn một kết nối trong bảng chi tiết để chuyển sang hàm đó.
4. Kéo từng khối, kéo tiêu đề khung class để di chuyển cả class, hoặc kéo tên file để di chuyển cả file. Zoom bằng con lăn, dùng **Liên quan** để tập trung. Vẽ và thêm ghi chú để ghi lại điều đã hiểu.
5. **Xuất bản đồ** lưu JSON gồm code, bố cục và ghi chú. Mở lại qua **Mở code → Chọn file**. App cũng tự lưu một workspace trong localStorage của trình duyệt hiện tại.

Ví dụ có sẵn: Python observation → ONNX policy → joint targets; C main / timer / UART callbacks → control → PID → PWM. Đây là code minh họa cấu trúc, không phải firmware dùng trên phần cứng.

## Phân tích và giới hạn

- Lezer Python và C/C++ grammar phân tích cú pháp trong Web Worker. Giao diện chỉ nhận Python và C; không cần API key, không gửi code lên server và không thực thi code đầu vào.
- Đường liền biểu diễn lời gọi có một định nghĩa phù hợp trong các file đã mở. Nét đứt là method suy ra từ annotation hoặc gán constructor. Đây là call graph tĩnh, không phải thứ tự chạy, dataflow hoặc execution trace.
- Python hỗ trợ hàm, class/method, import trực tiếp/alias, import tương đối, `self.method`, `super().method`, `Class.method`, một số receiver có kiểu, và kế thừa qua class cha (kể cả class cha nằm ở file khác). Base class được dò theo thứ tự trái→phải, **chưa chạy MRO C3 đầy đủ**; chỉ dùng được khi file chứa class cha cũng đã mở. Chưa hỗ trợ đầy đủ dynamic dispatch, monkey patch, closures, decorator làm đổi đích gọi và import wildcard.
- Decorator được giữ trong khối code hiển thị và liệt kê ở inspector. Bản thân decorator không được tính là lời gọi của hàm, vì nó chạy lúc định nghĩa chứ không phải trong thân hàm.
- C hỗ trợ định nghĩa hàm và lời gọi trực tiếp, tránh nối sang hàm `static` của translation unit khác. Không chạy preprocessor và không giải quyết đầy đủ macro, function pointer, conditional compilation, kiểu từ include hoặc symbol linkage. Callback/IRQ được đánh dấu theo tên, không tạo giả một lời gọi từ main.
- Lời gọi chưa nối được chia hai nhóm trong inspector. **Không vẽ kết nối**: module chưa mở (gom theo tên module), hàm có sẵn của Python, hoặc gọi trên kết quả trung gian như `f(x).abs().sum()`. **Chưa xác định**: phần còn lại, kèm lý do — đây mới là chỗ đáng đọc.
- Symbol được re-export (file A `import` từ B rồi file C `import` từ A) vẫn truy ngược về định nghĩa gốc.
- Bố cục xếp file thành nhiều cột và tự xuống cột với file nhiều hàm, để bản đồ không bị dẹt và zoom vừa màn hình không quá nhỏ.
- `@lezer/python` 1.1.19 báo lỗi cú pháp sai với số dạng `0.` (hợp lệ trong Python, hay gặp như `gravity=(0., 0., -9.81)`). App parse trên một bản sao đã viết lại thành `.0` — cùng số byte nên mọi dòng, offset và code hiển thị vẫn là bản gốc. Grammar này vẫn chưa đọc được f-string lồng f-string kiểu Python 3.12. Lỗi cú pháp được báo trong nút **ⓘ**; parser có thể khôi phục một phần, nên kiểm tra code gốc.
- Màu vai trò (policy/sensor/motor/communication) chỉ gợi ý theo tên hàm. Không tạo giải thích AI hoặc suy đoán luồng UART/CAN giữa Python và C.
- Tối đa 120 file, 500 KB mỗi file, 3 MB code và 900 hàm mỗi bản đồ. Thư mục phụ thuộc/cache phổ biến được bỏ qua khi mở thư mục.

## Kiểm tra

```bash
npm test
npm run build
```

Chạy thử bộ phân tích trên một thư mục code thật, không cần trình duyệt:

```bash
node scripts/analyze-dir.mjs /đường/dẫn/dự-án            # toàn bộ
node scripts/analyze-dir.mjs /đường/dẫn/dự-án /bipedal/  # lọc theo đường dẫn
```

Kiểm tra trình duyệt (khi server đang chạy):

```bash
npx playwright install chromium --only-shell
node scripts/browser-check.mjs
```

Các ca kiểm tra bao gồm lời gọi liên file, callback HAL, phạm vi hàm static, method trùng tên, alias/relative import, tên bị che, loại bỏ lời gọi giả trong comment/string, khôi phục lỗi cú pháp, kế thừa Python (`self`, `super()`, `__init__` kế thừa, base class vòng tròn, `metaclass=` không phải base), decorator trong khối code; và thao tác UI desktop/mobile, kéo node, kéo khung class, nhập code, ghi chú, lưu và xuất/nhập JSON.

## Công nghệ

Vanilla JavaScript/CSS, SVG canvas, Lezer parsers, esbuild. Nguồn grammar: [Python](https://github.com/lezer-parser/python), [C/C++](https://github.com/lezer-parser/cpp). Thư viện giữ giấy phép MIT; bundle được tạo cùng các thông báo giấy phép của esbuild.
