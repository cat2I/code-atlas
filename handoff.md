# Handoff — Code Atlas

Cập nhật: 2026-10-08, Asia/Ho_Chi_Minh. Phiên 2 (Claude Code) đã làm tiếp phần phân giải kế thừa Python, decorator và khung class; chi tiết ở mục "Phiên 2".

## Yêu cầu của người dùng

Người dùng muốn một công cụ kiểu Graphicule: các khối code nằm trên canvas có thể kéo/zoom, nối với nhau để dễ đọc và hiểu chương trình. Ảnh tham chiếu là nền tối, khối code, khung nhóm class và đường nối/vẽ tay.

**Phạm vi đã được người dùng chỉnh lại: chỉ ưu tiên Python và C, dùng cho AI locomotion, Raspberry Pi và nhúng STM32. Mục đích chính là HIỂU CODE.** Không quay lại hướng JavaScript/TypeScript. Đó là giả định ban đầu đã bị thay thế.

Yêu cầu mới nhất: tạo file này để Claude tiếp tục công việc. Không có yêu cầu mới về tính năng cụ thể sau khi bản đầu được làm xong. Tiếp tục dựa trên source hiện tại, không dựng lại từ đầu.

## Trạng thái bàn giao

- Bản đầu đã triển khai tại `/home/cat21/Documents/projects/code-atlas`.
- Bộ phân tích, giao diện và build đã hoạt động; kiểm tra unit (13/13) và trình duyệt đã qua sau các thay đổi của phiên 2.
- Có `node_modules/`, `package-lock.json` và build `dist/` tại thời điểm bàn giao.
- **Chưa xác nhận triển khai website thành công.** Đã đăng ký một Sites project, nhưng bước đồng bộ nguồn/đóng gói gặp credential hết hạn. Lần thử tiếp theo bị người dùng ngắt để chuyển sang bàn giao.
- Kiểm tra thư mục ngay trước khi viết handoff: **không có `.git/` trong `code-atlas`**. Chưa có commit/push SHA hay saved version/deployment thành công để bàn giao. Không tự nhận là đã push hoặc publish.
- Không lưu token hoặc credential trong source/file bàn giao.

## Phiên 2 — đã làm tiếp (Claude Code)

Tất cả nằm trong source hiện có, không dựng lại từ đầu. `npm test` 13/13, `npm run build` và `node scripts/browser-check.mjs` đều qua sau thay đổi.

1. **Kế thừa Python.** `self.method`, `super().method`, `Class.method` và constructor `Class()` nay đi theo chuỗi base class, kể cả class cha ở file khác (dò qua import/relative import). Lời gọi lấy từ class cha có `call.inheritedFrom` và cạnh có cờ `inherited`; inspector ghi `kế thừa`. Thứ tự dò là trái→phải theo chiều sâu, **không phải MRO C3** — đã ghi rõ trong reason tiếng Việt hiện trên UI.
2. **Base class được thu thập.** `files[].classes` đổi từ mảng chuỗi sang `[{ name, bases, line }]`. `metaclass=` và generic `Base[T]` được lọc đúng. Base vòng tròn không làm treo (có `seen` set).
3. **Decorator.** Khối code hiển thị bắt đầu từ decorator đầu tiên, `start` theo dòng decorator, `node.decorators` liệt kê ở inspector. `node.id` vẫn dùng offset của `FunctionDefinition` nên bố cục JSON cũ không hỏng.
4. **`super()` không còn là lời gọi rác.** Trước đây `super()` bị đếm thành lời gọi chưa phân giải; nay bỏ qua vì cạnh thật đã do `super().method` tạo.
5. **Khung class trên canvas.** Mỗi class có khung riêng trong khung file, nhãn `class Tên(Base)` kèm số method; kéo tiêu đề để di chuyển cả class. Bố cục xếp method cùng class thành khối liền, tách ra `src/layout.js` để nút **Sắp xếp** và worker dùng chung một logic.
6. **Sửa bug:** kéo node/nhóm chỉ vẽ lại khung file, khung class đứng yên tại chỗ cũ (`renderClassFrames` chưa được gọi trong `pointermove`).
7. **UI:** tooltip `Lire` → `Mở`; badge `KẾ THỪA: <Base>` và badge decorator trong inspector.

## Phiên 2b — chạy thử trên code thật của người dùng

Acceptance test đã làm: `/home/cat21/Documents/projects/Transformer/Transform_bipedal_todai` (Isaac Lab + MuJoCo bipedal RL, 53 file Python, 415 KB, 224 hàm). Dùng `node scripts/analyze-dir.mjs <thư mục>` để lặp lại.

Độ phủ: **92/92 dòng `def` → 92 node** trên tập không tính `_archive`. Không sót hàm. Parse toàn dự án ~200 ms.

Những gì code thật phát hiện và đã sửa:

1. **Nhiễu lời gọi chưa phân giải.** Ban đầu 1717 lời gọi "chưa xác định", một hàm `main` hiện 87 dòng — không đọc được. Nay phân loại `builtin` / `library` (gom theo module) / `chain` (gọi trên kết quả trung gian) / `unknown`. Còn **318 unknown**, hàm tệ nhất còn 21 dòng. `stats` tách `unresolved` (unknown) và `external`.
2. **Receiver là biến cục bộ bị chặn sai.** `ap = argparse.ArgumentParser()` rồi `ap.add_argument(...)`: `ap` nằm trong `shadowed` nên bị bỏ qua trước khi tra kiểu. Guard `shadowed` giờ chỉ áp cho lời gọi một đoạn.
3. **Re-export.** `from bipedal.officialdesign.task_walk import as_torch` trong khi `as_torch` thật nằm ở `_shared/lab3.py` và chỉ được task_walk import lại. Nay truy ngược qua chuỗi re-export (có cycle guard). 13 lời gọi `as_torch` từ unknown thành resolved.
4. **Lỗi cú pháp giả.** `@lezer/python` 1.1.19 coi `0.` là lỗi — mà `gravity=(0., 0., -9.81)` có thật trong code. Parse trên bản sao viết lại `0.` → `.0`, **giữ nguyên số byte** nên offset/dòng/code hiển thị không đổi. Toàn dự án: 1 file báo lỗi → 0. Grammar vẫn chưa đọc được f-string lồng f-string (Python 3.12); chưa có cách vá giữ độ dài, nếu gặp thì báo ⓘ là đúng.
5. **Không mở nổi package thật.** Dự án có 4 `__init__.py`; chọn nhiều file thì trình duyệt chỉ gửi tên file nên trùng đường dẫn và **toàn bộ lần mở bị từ chối**. Nay tự đổi tên `__init__~2.py` kèm cảnh báo khuyên dùng "Mở thư mục" (giữ `webkitRelativePath`, import tương đối mới nối được). So sánh thực tế trên cùng dự án: chọn file 92 hàm/72 cạnh, mở thư mục 227 hàm/174 cạnh.
6. **Bản đồ quá nhỏ.** Bố cục cũ xếp mọi file thành một hàng ngang; riêng `newsimple/task_walk.py` cao 4092 px nên fit chỉ còn **18%**, không đọc được gì. Nay file được xếp thành nhiều cột, file quá cao tự xuống cột trong khung của nó, và chiều cao cột được hiệu chỉnh theo tỉ lệ màn hình. Cùng dữ liệu: **36%**. Ví dụ mẫu cũng tăng (locomotion ~0.78).

Những gì code thật **không** sửa được (giới hạn thật, đã ghi vào README):

- `self.scene.clone_environments`, `env.sim.render`, `died.any()` — receiver là thuộc tính của thuộc tính hoặc tensor; không có type inference thì không nối được.
- `super().__init__` khi class cha là `DirectRLEnv` của Isaac Lab (không nằm trong file đã mở) — báo đúng lý do, không bịa cạnh.
- 108/224 hàm không có ai gọi trong phạm vi đã mở, vì entry point thật do framework gọi (Isaac Lab gọi `_get_rewards`, `_reset_idx`…). Đây là sự thật về code, không phải lỗi công cụ.

Chưa làm trong phiên này: control/dataflow graph, nối Python↔C qua UART/CAN, collapse class, mũi tên kế thừa giữa các class, minimap/redo, và nhánh hosting Sites.

## Chạy ngay trên máy

```bash
cd /home/cat21/Documents/projects/code-atlas
npm install
npm test
npm run build
npm run dev
```

Mở `http://127.0.0.1:4173`.

- `npm run dev` chỉ phục vụ **dist/**, không có watch/rebuild tự động. Sửa `src/` xong phải chạy lại `npm run build`.
- Không mở `dist/index.html` bằng `file://`: app dùng ES modules và Web Worker.
- Nếu dependency đã sẵn có và lockfile không thay đổi thì không cần cài lại.
- Server cũ có thể vẫn chạy ở port 4173; kiểm tra trước khi khởi động một server nữa (`ss -ltnp | grep 4173`). Chỉ dừng process thuộc app này nếu cần. Trong phiên 2, server của phiên trước đã tự chết; server hiện tại do phiên 2 khởi động bằng `node scripts/serve.mjs` chạy nền, và sẽ chết khi phiên kết thúc.

## Chức năng đã có

### Mở và phân tích code

- Dán code, chỉnh tên/path file, tạo file trống, chọn nhiều file `.py`, `.c`, `.h`, hoặc mở thư mục.
- Kéo file vào canvas; nhập JSON workspace để khôi phục.
- Parser chạy trong Web Worker ngay trên trình duyệt. Không cần API key, không gửi code người dùng đến server, không thực thi code đầu vào.
- Nhận diện Python function/class/method và C function definition.
- Nhóm các khối theo **file**, và trong mỗi file có **khung riêng cho từng class**, nhãn `class Tên(BaseClass)` kèm số method. Kéo tiêu đề khung để di chuyển cả class.
- Tạo call graph trong các file đã mở. Python có import/alias, relative import, `self.method`, `super().method`, `Class.method`, kế thừa qua class cha (kể cả ở file khác), một số đối tượng suy ra từ annotation hoặc gán constructor. C phân biệt hàm `static` theo file.
- Decorator Python nằm trong khối code hiển thị và được liệt kê ở inspector; decorator không bị tính thành lời gọi của hàm.
- Đường liền: tìm được định nghĩa phù hợp. Nét đứt: method được suy ra từ kiểu/constructor. Đây là phân tích tĩnh, không phải bảo đảm đích runtime.
- Lời gọi ngoài phạm vi hoặc chưa xác định được vẫn được liệt kê riêng với lý do.
- Phát hiện lỗi cú pháp qua error node của parser; xem ở nút `ⓘ`. Parser có error recovery, nên bản đồ của code lỗi có thể chỉ đúng một phần.

### Canvas và đọc code

- Nền tối, pan/zoom, fit, kéo từng khối hoặc cả nhóm file, sắp xếp lại.
- Explorer theo file/hàm; tìm kiếm theo tên, path và nội dung code.
- Chế độ `Tất cả`, `Liên quan`, `Điểm vào / IRQ`. Các node ngoài bộ lọc được làm mờ, không loại bỏ hoàn toàn.
- Chọn hàm để xem signature/docstring, file/dòng, số dòng, số nhánh/vòng lặp, incoming/outgoing calls, code gốc có số dòng.
- Chọn hàm liên quan trong inspector để điều hướng; incoming call có thể highlight dòng gọi ở caller.
- Nhận diện callback/IRQ C theo hậu tố tên (`Callback`, `IRQHandler`). **Không bịa cạnh `main → callback`** khi code không có lời gọi đó.
- Nhãn màu policy/sensor/motor/communication/control loop là **heuristic theo tên hàm**, không phải AI hiểu ngữ nghĩa.
- Vẽ tay, sticky notes, undo tối đa 15 snapshot trong phiên hiện tại.
- Tự lưu một workspace trong localStorage; xuất/nhập JSON gồm code, bố cục, ghi chú và nét vẽ.
- Responsive desktop/mobile, có phím tắt và dialog hướng dẫn.

### Ví dụ có sẵn

1. `AI locomotion`: 4 file Python, 10 hàm/method; controller → observation → ONNX Actor → joint targets/packet encoding.
2. `STM32 control`: 3 file C và 1 header, 11 hàm; main/timer/UART callback → control → PI/PID minh họa → PWM.

**Các ví dụ chỉ minh họa cấu trúc để đọc code. Không phải chương trình điều khiển phần cứng dùng được ngay.** Ví dụ transport Python trả về packet, chưa ghi serial; C bỏ qua nhiều yêu cầu thời gian/safety của firmware thực tế.

## Bản đồ source

| File | Vai trò |
| --- | --- |
| `src/analyzer.js` | Parse Python/C, thu thập hàm/method/call, phân giải symbol (kể cả kế thừa Python), decorator, gợi ý vai trò, bố cục ban đầu. Export `analyze`, `layoutGraph`, `languageOf`, `roleOf`. |
| `src/layout.js` | Vị trí node dùng chung cho worker (bố cục đầu) và nút **Sắp xếp** trong app. Giữ method cùng class thành một khối liền để vẽ khung class; xếp file thành nhiều cột, file cao tự xuống cột, hiệu chỉnh theo tỉ lệ màn hình. Không phụ thuộc Lezer. |
| `src/worker.js` | Wrapper Web Worker cho analyzer; trả `{id, graph, groups}` hoặc `{id, error}`. |
| `src/app.js` | State, canvas DOM/SVG, inspector, source dialog, import/export, localStorage, notes/ink, undo, keyboard/pointer events. |
| `src/index.html` | Khung giao diện và dialog; nội dung tiếng Việt. |
| `src/style.css` | Theme, node/edge styles, layout desktop/mobile. |
| `src/samples.js` | Hai bộ code mẫu; chưa dùng code riêng tư từ repo của người dùng. |
| `scripts/build.mjs` | esbuild bundle `app.js` và `worker.js`, copy HTML/CSS sang `dist/`. |
| `scripts/serve.mjs` | Static server loopback port 4173, có kiểm tra đường dẫn nằm trong `dist/`. |
| `scripts/inspect-parsers.mjs` | Script thăm dò cây cú pháp Lezer; công cụ phát triển, không phải runtime. |
| `scripts/analyze-dir.mjs` | Chạy analyzer trên một thư mục code thật, không cần trình duyệt. In stats, loại lời gọi chưa nối, module chưa mở, class/decorator, file lỗi cú pháp. Dùng cho acceptance test. |
| `tests/analyzer.test.mjs` | 8 unit tests bộ phân tích. |
| `scripts/browser-check.mjs` | Playwright end-to-end smoke checks; cần server 4173 đã chạy. |
| `.openai/hosting.json` | Sites identity và static directory. **Giữ nguyên project ID.** |
| `README.md` | Hướng dẫn dùng/chạy, giới hạn và kiểm tra. |

Dependencies: `@lezer/python@1.1.19`, `@lezer/cpp@1.1.6`. Dev dependencies: `esbuild@0.25.12`, `@playwright/test@1.56.1`. Node đã dùng: `v22.23.1`.

App dùng vanilla JS/CSS và SVG + DOM, không dùng React/Vite/backend. Lezer C/C++ grammar được dùng để parse C; giao diện giới hạn file `.c/.h`.

### State và dữ liệu

- `analyze(files)` nhận `[{name, content}]`, trả `{nodes, edges, files, stats}`.
- Node có ID dạng `path::qualifiedName@sourceOffset`, code/range, kind/class/scope, calls, role, metrics, tọa độ.
- Edge có source/target IDs, `inferred`, danh sách dòng gọi.
- Workspace JSON version 1: `title`, `files`, `positions`, `notes`, `strokes`, `camera`.
- localStorage key: `code-atlas-python-c-v1`.
- Import JSON **phân tích lại code**, không tin graph từ file. Chỉ phục hồi `x/y` vào node, không `Object.assign` tùy ý dữ liệu positions.
- Giới hạn: 120 file, khoảng 500 KB/file, 3 MB tổng code, 900 hàm. Upload kiểm tra byte; analyzer kiểm tra độ dài chuỗi. Một số thư mục dependency/cache bị bỏ qua khi nhập thư mục.

## Kiểm chứng đã hoàn tất

### Unit tests

Lần chạy cuối: **16/16 passed** bằng `npm test`, sau đó `npm run build` thành công.

Các ca đã kiểm tra:

1. Python locomotion: liên file, constructor, receiver có annotation.
2. STM32: lời gọi C liên file; không tạo cạnh giả tới callback timer.
3. Hàm `static` cùng tên không nối chéo translation unit.
4. Comment/string không tạo lời gọi giả; body hàm lồng được tính cho hàm lồng.
5. `self.method` phân giải đúng khi hai class có method cùng tên.
6. Import alias/relative import; receiver động chưa biết vẫn unresolved.
7. Parameter che tên global function không nối sai.
8. Phát hiện lỗi cú pháp và kiểm tra extension, file trùng, kích thước.
9. Decorator nằm trong khối code, `start` tính từ dòng decorator, `signature` vẫn chỉ là dòng `def`.
10. `self.method` đi theo chuỗi base class; method override ở class con thắng; `inheritedFrom` chỉ đặt khi lấy từ class cha.
11. Base class lấy từ import (kể cả relative import); `metaclass=ABCMeta` không bị tính là base; `super().method` nối đúng; `super()` không còn bị liệt kê thành lời gọi chưa phân giải.
12. `__init__` kế thừa; `Class.method` với receiver là tên class; tên class bị tham số che thì không nối.
13. Base class vòng tròn (A↔B) không treo; file C không sinh dữ liệu class/decorator.
14. Phân loại builtin / module chưa mở / unknown, kể cả receiver lấy kiểu từ constructor; `stats.unresolved` và `stats.external` tách nhau.
15. Symbol re-export qua một module trung gian vẫn về đúng định nghĩa gốc.
16. Số dạng `0.` không bị báo lỗi cú pháp; code hiển thị, docstring và số dòng giữ nguyên bản gốc.

### Browser checks

```bash
# Chỉ cần nếu thiếu browser binary:
npx playwright install chromium --only-shell

# Server npm run dev phải đang chạy ở terminal khác:
node scripts/browser-check.mjs
```

Lần chạy cuối đã qua các thao tác: tải ví dụ Python, inspector/call navigation cơ bản, kéo node, **khung class (số lượng, nhãn, kéo cả class, nút Sắp xếp)**, đổi mẫu STM32/đọc callback, sửa và phân tích code trong dialog, tìm kiếm, thêm ghi chú, reload giữ workspace, download JSON, import lại JSON, viewport mobile/sidebar, **workspace kế thừa 2 file (nhãn `class WalkPolicy(BasePolicy)`, badge KẾ THỪA/@decorator, caption `kế thừa`, không còn mục NGOÀI BẢN ĐỒ)**, không có `pageerror`.

Lưu ý khi sửa `browser-check.mjs`: ở đoạn cuối script, sidebar đang ở chế độ overlay sau khi test mobile, nên khung class bên trái bị sidebar che. Các test cần kéo chuột trên canvas phải đặt ở đoạn desktop phía trước.

Browser QA không bao phủ đầy đủ mọi tương tác: đặc biệt ink/undo, folder picker thực tế, pinch nhiều ngón, tính đúng đắn của mọi edge route và highlight đều đáng kiểm tra thêm nếu sửa các phần đó.

Ảnh QA nếu còn tồn tại:

- `/tmp/code-atlas-desktop.png`
- `/tmp/code-atlas-stm32.png`
- `/tmp/code-atlas-mobile.png`
- `/tmp/code-atlas-classes.png` (khung class trên ví dụ locomotion)
- `/tmp/code-atlas-inheritance.png` (workspace kế thừa 2 file)
- JSON xuất thử: `/tmp/code-atlas-test-export.json`

Đã xem ảnh desktop/STM32/mobile. Đã sửa đường nối liên file xa để vòng qua khoảng trống giữa các hàng thay vì chạy xuyên qua node trung gian. Đã thêm refit khi resize. Toàn bộ bộ kiểm tra trên đã chạy lại thành công sau các sửa này.

## Giới hạn và việc đáng làm tiếp

Ưu tiên tính đúng và khả năng hiểu code trước việc làm giao diện đẹp hơn.

1. **Phân giải symbol vẫn là MVP.** Python đã xử lý kế thừa nhưng chỉ theo thứ tự base trái→phải (DFS), **chưa chạy MRO C3**; đa kế thừa phức tạp có thể chọn sai nhánh. Chưa xử lý closures, wildcard imports, monkey patch/dynamic dispatch, decorator làm đổi đích gọi, và class cha nằm ngoài các file đã mở. C chưa chạy preprocessor hay phân giải function pointer, include/linkage đầy đủ; cả hai nhánh `#if` có thể cùng xuất hiện. Kiểm tra các ca tên bị che hoặc đối tượng bị gán lại trước khi tuyên bố chính xác cao hơn.
2. **Không phải control/dataflow graph.** Chưa tách `if/for/while` thành sub-block, chưa trace tensor/shape, chưa trình bày biến shared/read-write, chưa mô phỏng runtime. Chưa tự nối Python↔C qua UART/CAN/FFI. Những phần này rất hợp với mục đích người dùng, nhưng chưa được triển khai.
3. **Cấu trúc class:** đã có khung class trong khung file, kéo được cả class. Chưa có collapse/thu gọn class, chưa vẽ quan hệ kế thừa thành mũi tên riêng giữa các class (hiện kế thừa chỉ hiện ở nhãn khung và badge inspector).
4. **Đọc source:** đã xong — block Python bắt đầu từ decorator đầu tiên, `start` tính theo dòng decorator. Comment ngay trước `def` vẫn nằm ngoài khối.
5. **UI:** chữ `Lire` đã đổi thành `Mở`. Text toàn cảnh nhỏ khi fit nhiều nhóm; cần zoom hoặc inspector để đọc. Chưa có minimap, redo hoặc auto-layout theo topology.
6. **Ghi chú/canvas:** note editing có snapshot theo focus; ink redraw toàn bộ strokes mỗi pointermove. Chưa tối ưu cho workspace lớn. Giới hạn hiện tại có chủ ý.
7. Không có API LLM hay giải thích AI thực sự. Không quảng cáo rằng app hiểu ý nghĩa thuật toán, chứng minh timing hoặc kiểm tra tính an toàn của firmware.
8. Có thể dùng một tập file thực tế do người dùng chọn làm acceptance test tiếp theo. Chưa đọc/đóng gói code robotics riêng của người dùng vào bản demo hoặc upload nó lên Sites.
9. **Hai ví dụ mẫu chưa dùng kế thừa hay decorator**, nên mở ví dụ mặc định sẽ không thấy các tính năng mới. Muốn demo phải dán code có class cha. Sửa `src/samples.js` sẽ phải cập nhật test 1 (đang chốt 10 hàm).

## Sites — triển khai đang dang dở

Đã dùng skill Sites tại:

`/home/cat21/.codex/plugins/cache/openai-curated-remote/sites/1.0.0-d/skills/sites/SKILL.md`

Manifest hiện tại:

```json
{
  "project_id": "appgprj_6ac7180c80088191aa260f84df8796b7",
  "static": { "directory": "dist" }
}
```

- Slug: `code-atlas-cat21`.
- **Expected URL, chưa phải link đã xác minh live:** `https://code-atlas-cat21.luckybrush.chatgpt.site`.
- Lần đọc native Sites cuối: user là owner, audience owner-only (`custom`, chỉ owner), `latest_version_number: 0`, `current_live_url: null`.
- Đã tạo site đúng một lần. **Không gọi create_site lại.** Dùng project ID trong manifest.
- Lần helper thứ nhất dừng với `Renew the source credential for the same Site before retrying.`. Credential đã hết hạn trong lúc chờ lệnh được duyệt/chạy.
- Lần thử sau đã mở helper và nhận `Ready for Site workflow JSON on stdin (input is hidden).`, rồi phiên bị ngắt. Chưa có kết quả helper thành công. Không suy đoán kết quả dựa vào expected URL.
- Runtime session IDs cũ không có giá trị ổn định để bàn giao; kiểm tra process/file/project state trước khi tiếp tục. Một helper chờ stdin hoặc server preview cũ có thể vẫn còn sống.
- Archive dự kiến: `/tmp/code-atlas-deployment.tar.gz`. **Chưa xác minh file này đã được tạo thành công.**

**Phiên 2 không đụng vào nhánh này.** Claude Code trong phiên 2 không có Sites tools (chỉ có Docs, GitHub, DuckDuckGo, memory, sequentialthinking), nên không thể save version hay deploy. Không có link live để bàn giao; trạng thái Sites giữ nguyên như mô tả ở trên. Phần phát triển/kiểm tra local vẫn chạy bình thường.

Nếu phiên sau có công cụ Sites và muốn hoàn tất nhánh này:

1. Đọc skill, kiểm tra lại project/access/deployment hiện có trước khi retry.
2. Giữ manifest/ID, build và chạy các kiểm tra phù hợp nếu có sửa nguồn.
3. Mở helper trước, rồi mới cấp credential mới và truyền ngay qua stdin để tránh hết hạn trong thời gian chờ approval. Không lưu/in token hoặc nhét token vào command line.
4. Helper tại `/home/cat21/.codex/plugins/cache/openai-curated-remote/sites/1.0.0-d/scripts/site-workflow.mjs`, tham số `--project-id` như trên; chạy trong thư mục `code-atlas`. JSON stdin chứa `credential`, `commands: []` nếu checks/build đã qua với source không đổi, và `archivePath` tuyệt đối.
5. Chỉ khi helper trả về thành công, dùng chính `project_id`, `commit_sha`, `archive` được trả về để save/deploy. Với owner-private dùng `save_version_and_deploy_private`; tiếp tục theo trạng thái trả về, không publish lặp lại.
6. Chỉ đưa link live khi native deployment xác nhận thành công. Nếu Claude không có Sites tools, vẫn có thể tiếp tục phát triển/chạy local; nói rõ phần hosting chưa hoàn tất.

## Lưu ý môi trường

Trong phiên Codex, các shell command sandbox thường thất bại ngay với:

```text
bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted
```

Các lệnh kiểm tra/cài đặt/build được chạy bằng cơ chế escalation có approval. `apply_patch` vẫn ghi được source trong workspace. Đây là lỗi môi trường sandbox, không phải lỗi app; đừng sửa code để né lỗi này. Claude dùng cơ chế permission của môi trường hiện tại, không giả định các approval của phiên cũ còn hiệu lực.

Không có yêu cầu tạo goal hoặc dùng nhiều agent. Không cần chạm các project khác trong `/home/cat21/Documents/projects`.

## Bắt đầu phiên tiếp theo

Đọc `handoff.md`, `README.md`, `src/analyzer.js`, `src/layout.js` và `src/app.js`; kiểm tra server cũ rồi mở bản local. Bám mục tiêu **hiểu code Python/C cho locomotion và nhúng**. Giữ những gì đã qua kiểm tra, xử lý nhánh hosting còn dang dở nếu công cụ cho phép, hoặc tiếp tục theo chỉ đạo tính năng tiếp theo của người dùng.

Việc đáng làm tiếp, theo thứ tự giá trị cho mục tiêu hiểu code:

1. Chạy lại `scripts/analyze-dir.mjs` trên dự án bipedal sau mỗi thay đổi analyzer; con số tham chiếu ở mục "Phiên 2b".
2. Tách `if/for/while` trong một hàm thành sub-block để thấy luồng điều khiển, thay vì chỉ thấy quan hệ gọi hàm.
3. Mũi tên kế thừa giữa các khung class, và collapse class khi bản đồ lớn.
4. Nối Python↔C qua tên packet/UART (chỉ nên là gợi ý có nhãn rõ, không được vẽ như cạnh chắc chắn).
