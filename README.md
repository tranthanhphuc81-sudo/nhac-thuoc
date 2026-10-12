# Nhắc Uống Thuốc

Ứng dụng di động nhắc uống thuốc đúng giờ. Phần nhắc thuốc **chạy 100% offline**: không cần đăng nhập, dữ liệu nằm trên điện thoại. Riêng tính năng **chụp đơn thuốc để tự thêm** (tùy chọn) cần mạng và một máy chủ nhỏ trên Cloudflare.

Viết bằng Expo SDK 57 (React Native 0.86) + TypeScript + Expo Router + SQLite.

## Tính năng

- **Danh sách thuốc**: tên, hàm lượng, liều mỗi lần (½, 1, 1½… viên/ml/gói/giọt…), cách uống (trước ăn, sau ăn…), ghi chú, ảnh viên thuốc, màu nhận diện.
- **Lịch linh hoạt**: nhiều giờ mỗi ngày; hằng ngày hoặc chọn thứ trong tuần; dùng lâu dài hoặc theo đợt N ngày (ví dụ kháng sinh 7 ngày); có ngày bắt đầu trong tương lai.
- **Thông báo cục bộ** có nút ngay trên thông báo: **✅ Đã uống**, **⏰ Nhắc lại sau** (5/10/15/30 phút), **Bỏ qua**. Các thuốc trùng giờ được gộp vào một thông báo.
- **Màn hình Hôm nay**: các cữ theo giờ, trạng thái (sắp tới / đến giờ / quên / đã uống / bỏ qua), nút “Uống tất cả”, hoàn tác.
- **Theo dõi số lượng thuốc**: tự trừ khi bấm “Đã uống”, báo **sắp hết** khi còn ≤ N ngày.
- **Lịch sử & tỉ lệ tuân thủ**: 7 / 30 / 90 ngày, chi tiết từng ngày, giờ uống thực tế.
- **Dễ dùng cho người lớn tuổi**: chữ to (3 cỡ), nút lớn, tương phản cao, toàn bộ tiếng Việt.
- **Hướng dẫn chống “giết app”** theo hãng (Xiaomi, Oppo/Realme, Vivo, Samsung), tự nhận diện hãng máy, có thông báo thử.
- **Sao lưu / khôi phục** ra file JSON (gửi qua Zalo, Drive, Email…). Mã truy cập / API key không nằm trong file sao lưu.
- **Chụp đơn thuốc để tự thêm** (tùy chọn, cần mạng): Claude Haiku 5.5 đọc đơn, điền sẵn tên thuốc, hàm lượng, liều, buổi uống, cách uống, số ngày, số lượng. Luôn có màn hình kiểm tra trước khi lưu; thuốc trùng và thuốc “khi cần” mặc định không thêm.

## Cài lên điện thoại Android

Vào mục **[Releases](../../releases/latest)** của repo, tải file `nhac-thuoc-v….apk` về điện thoại, mở file và cài (cho phép “Cài ứng dụng không rõ nguồn gốc” nếu máy hỏi). Bản mới cài đè lên bản cũ, giữ nguyên dữ liệu.

Mỗi lần đẩy code lên nhánh `main`, GitHub Actions tự kiểm tra code và build APK mới (khoảng 15–25 phút, xem tiến độ ở tab **Actions**). Có thể build lại bằng tay: Actions → *Build APK* → *Run workflow*.

> APK được ký bằng khóa debug của template Expo: cài dùng cá nhân và chia sẻ cho người quen được, nhưng không đưa lên Google Play. Khi cần lên Play, chuyển sang ký bằng khóa riêng (EAS Build hoặc thêm keystore vào GitHub Secrets).

## Chạy thử nhanh

```bash
npm install
npx expo start
```

Quét QR bằng **Expo Go** để xem giao diện. Thông báo cục bộ vẫn chạy trong Expo Go, nhưng icon thông báo, tên app và quyền “Báo thức chính xác” chỉ đúng khi build thật (xem bên dưới).

> File `.npmrc` bật `legacy-peer-deps` để tránh lỗi `ERESOLVE` do peer dependency tùy chọn `react-dom` của template Expo. Không ảnh hưởng tới app.

## Build file cài đặt (APK / iOS)

Dùng EAS Build trên cloud, không cần Android Studio hay Xcode:

```bash
npm install -g eas-cli        # hoặc dùng: npx eas-cli@latest
eas login
eas build:configure           # lần đầu, gắn project vào tài khoản Expo
eas build -p android --profile preview      # ra file .apk cài trực tiếp
eas build -p android --profile production   # ra .aab để đưa lên Google Play
eas build -p ios --profile production       # cần tài khoản Apple Developer
```

Hoặc build trên máy nếu đã cài Android Studio: `npx expo run:android --variant release`.

Trước khi phát hành, đổi `android.package` và `ios.bundleIdentifier` trong `app.json` (đang là `vn.nhacthuoc.app`) thành định danh của bạn.

## Cách nhắc nhở hoạt động

Toàn bộ nằm trong `src/lib/schedule.ts` (logic thuần, có unit test) và `src/lib/notifications.ts`.

| Loại thuốc | Cách hẹn | Lý do |
|---|---|---|
| Dùng lâu dài, hằng ngày | 1 trigger `DAILY` cho mỗi khung giờ | Hệ điều hành tự lặp mãi, không cần mở app |
| Dùng lâu dài, theo thứ | Trigger `WEEKLY` cho từng thứ | Như trên |
| Theo đợt / chưa đến ngày bắt đầu | Trigger `DATE` cho từng lần | Tự dừng đúng ngày kết thúc, không nhắc thừa |

- **Giới hạn iOS 64 thông báo chờ**: app hẹn tối đa 56 (chừa chỗ cho “nhắc lại” và cảnh báo hết thuốc). Ưu tiên trigger lặp lại; thuốc theo đợt được hẹn trong 14 ngày tới. Nếu bị cắt bớt, màn hình Hôm nay sẽ báo và lịch tự gia hạn mỗi lần mở app.
- **Android**: hẹn trước tối đa 300 thông báo / 45 ngày. Expo dùng `setExactAndAllowWhileIdle` khi app có quyền **Báo thức và lời nhắc** (Android 12+), nên app có màn hình hướng dẫn bật quyền này. Lịch được hệ thống khôi phục sau khi khởi động lại máy (`RECEIVE_BOOT_COMPLETED`).
- **Đồng bộ thông minh**: mỗi thông báo có ID ổn định và mã băm nội dung. Khi sửa thuốc, app chỉ hủy/hẹn lại những thông báo thực sự thay đổi, giữ nguyên các lần “nhắc lại” đang chờ.
- **Nút trên thông báo** mở app để ghi nhận chắc chắn (kể cả khi app đã bị tắt hẳn), có chống xử lý trùng.
- **Kênh thông báo Android** `medication-reminders` ở mức `MAX`: hiện nổi, có chuông, rung, hiện trên màn hình khóa.

## Cấu trúc thư mục

```
src/
  app/                      # Màn hình (Expo Router)
    _layout.tsx             # SQLite, khởi tạo thông báo, xử lý nút bấm trên thông báo
    (tabs)/index.tsx        # Hôm nay
    (tabs)/meds.tsx         # Danh sách thuốc
    (tabs)/history.tsx      # Lịch sử & tỉ lệ tuân thủ
    (tabs)/settings.tsx     # Cài đặt, sao lưu
    med/[id].tsx            # Thêm / sửa thuốc (id = "new" để thêm)
    guide.tsx               # Hướng dẫn chống tắt nền theo hãng
    scan.tsx                # Chụp đơn thuốc → kiểm tra → lưu
  lib/
    schedule.ts             # Logic lịch & lập kế hoạch thông báo (thuần TS)
    notifications.ts        # expo-notifications: kênh, nút hành động, đồng bộ, nhắc lại
    repo.ts, db.ts          # SQLite: schema, migration, CRUD, sao lưu
    date.ts, photos.ts, system.ts, backup.ts, hooks.ts
    rx/                     # Đọc đơn thuốc: prompt + JSON schema (dùng chung với Worker), chuyển kết quả thành thuốc
    __tests__/              # Unit test
server/                     # Cloudflare Worker trung gian cho tính năng quét đơn
  ui/                       # Theme, component dùng chung, bộ chọn ngày giờ
```

## Dữ liệu

SQLite (`nhac-thuoc.db`), 4 bảng: `medications`, `med_times`, `dose_logs` (unique theo thuốc + ngày + giờ), `settings`. Migration theo `PRAGMA user_version`. Xóa thuốc là xóa mềm, nên lịch sử uống thuốc vẫn được giữ.

## Kiểm tra

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # expo lint
npm test            # 17 unit test: logic lịch, đọc đơn, Worker
```

## Chụp đơn thuốc bằng AI

### Cách hoạt động

```
Điện thoại ──ảnh JPEG (≤2000px) + mã truy cập──▶ Cloudflare Worker ──API key──▶ Claude Haiku 5.5
          ◀──────────── danh sách thuốc (JSON) ───────────┘
```

- **API key chỉ nằm trên Worker**, không nằm trong app. Mỗi người dùng có **mã truy cập riêng**, mặc định tối đa **20 lượt quét/ngày/người**.
- Ảnh chỉ được chuyển tiếp để đọc, **không lưu** ở đâu cả. Log của Worker chỉ ghi tên người dùng, số thuốc, số token.
- Kết quả dùng *structured outputs* (JSON schema) nên luôn đúng định dạng; app vẫn chuẩn hóa lại và **không bao giờ tự lưu** khi người dùng chưa xác nhận.
- Chi phí ước tính: ảnh ~4.000 token + kết quả ~600 token ≈ **$0,0007 (~20đ) mỗi lần quét** với Haiku 5.5 ($0,10 / $0,50 mỗi triệu token). 100 lần quét/tháng ≈ 2.000đ.

### Dựng máy chủ (khoảng 10 phút, miễn phí)

Cần: tài khoản [Cloudflare](https://dash.cloudflare.com) (miễn phí) và API key Claude tại [platform.claude.com](https://platform.claude.com) (nạp tối thiểu vài USD là dùng rất lâu).

```bash
cd server
npm install
npx wrangler login

# 1. API key Claude (dán khi được hỏi)
npx wrangler secret put ANTHROPIC_API_KEY

# 2. Mã truy cập cho từng người, dạng Tên=mã, cách nhau dấu phẩy
#    Ví dụ: Phuc=phuc-8Tq2xk,Me=me-4Lw9pz,Tuan=tuan-7Hn3vd
npx wrangler secret put ACCESS_CODES

# 3. (Nên làm) Bật giới hạn lượt quét mỗi ngày — lệnh tự thêm KV vào wrangler.toml
npx wrangler kv namespace create USAGE --binding USAGE --update-config

npx wrangler deploy
#    → nhận địa chỉ dạng https://nhac-thuoc-scan.<tên-bạn>.workers.dev
```

Trên điện thoại: **Cài đặt → Quét đơn thuốc → Máy chủ riêng**, nhập địa chỉ và mã truy cập, bấm *Kiểm tra kết nối*, rồi *Lưu*.

- Thêm/bớt người: chạy lại `npx wrangler secret put ACCESS_CODES` với danh sách mới (có hiệu lực ngay).
- Đổi giới hạn lượt: sửa `DAILY_LIMIT` trong `wrangler.toml` rồi `npx wrangler deploy`.
- Xem log: `npx wrangler tail`.
- Đơn viết tay đọc kém: đổi `MODEL = "claude-sonnet-5-5"` (đắt hơn ~20 lần, vẫn chỉ ~400đ/lần).

**Cách khác cho riêng một máy:** Cài đặt → *API key trên máy*, dán API key. Không cần Worker, nhưng key nằm trên điện thoại, nên không dùng cách này cho máy người khác.

### Thử giao diện khi chưa có API key

```bash
npx tsx server/mock-dev.ts      # máy chủ giả lập: http://localhost:8799, mã "demo"
npx expo start --web            # mở http://localhost:8081/?demo=1
```

Máy chủ giả lập chạy đúng code Worker, chỉ thay câu trả lời của Claude bằng một đơn thuốc mẫu.

## Lưu ý

Ứng dụng chỉ hỗ trợ nhắc nhở, không thay thế chỉ định của bác sĩ hay dược sĩ.
