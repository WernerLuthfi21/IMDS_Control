# Panduan setup lengkap: IMDS Tracker + Master Sheet Excel + Power Automate

Dokumen ini adalah urutan kerja tunggal. Ikuti dari atas ke bawah. Detail tambahan ada di `POWER_AUTOMATE_ALL_FLOWS.md` dan `POWER_AUTOMATE_IMDS_MASTER_SETUP.md`.

> **Status jujur.** Kode website sudah lulus unit test dan build. **Flow di tenant Microsoft Anda dan alur upload ke Supabase belum pernah saya jalankan.** Uji berurutan di Bagian 7 sebelum dipakai massal. Paket flow siap-impor (.zip) **tidak disediakan**: formatnya tidak bisa saya uji di tenant Anda, jadi dibuat klik-per-klik dengan skema siap-tempel di folder `docs/power-automate/`.

## 1. Cara kerja (gambaran)

```
MD System (hasil pencarian .xlsx) --drag & drop--> Tracker > Settings --> Database (Supabase)
                                                                             |  (antrean, otomatis)
                                                          Power Automate Flow A  v
Excel Master di SharePoint  <-----------------------------------------------------
Excel Master (diedit manual) --Flow B--> website (database)
Tracker > Follow-up > "Send all sequentially" --Flow C--> Outlook: 1 email + 1 PDF per supplier
```

- **Database adalah pusat.** Tracker memuat dari database setiap dibuka; tidak perlu connect workbook lagi.
- Setiap perubahan di Tracker/import masuk antrean lalu ditulis ke Excel oleh Flow A. Setiap edit manual di Excel dibaca kembali oleh Flow B.
- Kunci baris selalu **KEY** (kolom tersembunyi di Excel). KEY adalah identitas satu baris yang dipakai Power Automate untuk mencocokkan baris Excel dengan baris database, supaya update tidak membuat baris dobel. Orang tidak perlu melihat atau mengubahnya; jangan hapus kolomnya.

## 2. Aturan status (otomatis saat upload MD System)

Urutan tinggi ke rendah: **ACCEPTED > TMMIN WORKING > REJECTED / NOT SUBMITTED**.

- Status hanya naik: NOT SUBMITTED/REJECTED → TMMIN WORKING → ACCEPTED.
- **ACCEPTED tidak turun**, kecuali **ID/Ver naik pada nomor ID yang sama** (contoh `1525320002 / 1` → `/ 2`). Itu dianggap **revisi**: status boleh kembali ke TMMIN WORKING dan revisinya dicatat.
- Jika nomor ID-nya berbeda, atau datanya ambigu (beberapa ID aktif), baris ditandai **review** dan tidak diubah.
- Upload file yang lebih lama tidak menimpa data yang lebih baru.
- `DEAD (NEW SMS)` dan `NOT TO BE COLLECTED` tidak pernah ditimpa otomatis.
- Pemetaan MD System → status: accepted → ACCEPTED; in process at recipient / not yet browsed → TMMIN WORKING; rejected → REJECTED; *cancelled by sender* tidak pernah menggantikan record aktif; status lain → review manual.

## 3. Master Sheet Excel (basis di SharePoint)

1. Ambil **`IMDS_Super_Master_TEMPLATE.xlsx`** (dikirim terpisah; dibuat oleh `node scripts/make-master-template.mjs`). Isinya kosong, hanya struktur: **satu sheet** `Part List LATEST` dengan tabel **`PartMaster`** (header di baris 6), semua header HURUF BESAR, tanpa kolom ganda:

   | Kolom | Isi |
   |---|---|
   | NO. | nomor urut |
   | PROJECT | model |
   | VENDOR CODE | kode supplier |
   | MAIN PIC EMAIL | email PIC supplier |
   | COMPANY NAME | nama supplier |
   | PART NAME / PART NO. | nama dan nomor part |
   | SUBMISSION PLAN | tanggal rencana submit (juga dipakai sebagai tanggal janji supplier) |
   | PART STATUS | **satu-satunya status**: ACCEPTED / TMMIN WORKING / REJECTED / NOT SUBMITTED. Diperbarui otomatis dari MD System |
   | ID / VER | ID dan versi IMDS terbaru, otomatis dari MD System |
   | STATUS DATE | tanggal status terakhir berubah (accepted / diperbarui) dari MD System |
   | COMMENT | alasan penolakan dari MD System |
   | KEY | tersembunyi; identitas baris untuk Power Automate |

   Dihapus dari sheet: Have respond email, LPOP Confirmation, CEK, Supplier Promise Date, STATUS UPDATE, ID/Ver kedua, dan sheet *MD System History* (data lama tetap aman di database, tidak ada yang dihapus). Pelacakan tanggal upload MD System ada di website: **Tracker > Settings > "MD System uploads"** menampilkan tiap file, periode data (dari tanggal berapa sampai berapa), jumlah baris, matched, dan unmatched, sehingga terlihat periode mana yang terlewat.
2. **Cara terbaik mengisinya:** buka Tracker > Settings, upload **IMDS Remaining master** (workbook berisi *Part List LATEST*), lalu klik **Download Super Master XLSX**. File itu sudah berisi semua data dengan KEY. Pakai file hasil unduhan itu sebagai master di SharePoint (bukan template kosong).
3. Unggah ke SharePoint/OneDrive for Business di lokasi tetap. **Jangan dipindah atau diganti nama** setelah flow dibuat.
4. Pastikan tabel masih bernama `PartMaster` dan kolom `KEY` ada. Header baris 6 harus persis seperti tabel di atas.

## 4. Isi variabel di Vercel

Vercel > Project > Settings > Environment Variables > tambahkan (Production), lalu **Redeploy**.

| Nama | Isi / dari mana | Wajib |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase > Project Settings > API > Project URL | ya |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase > API > publishable/anon key | ya |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase > API > service_role (rahasia, jangan dibagikan) | ya |
| `APP_BASE_URL` | alamat tetap website, mis. `https://imds-gcats-control.vercel.app` | ya |
| `POWER_AUTOMATE_SECRET` | kata sandi acak panjang buatan Anda (mis. 40 karakter). **Sama persis** dengan yang dipakai di semua flow | ya |
| `POWER_AUTOMATE_TRACKER_URL` | URL pemicu Flow A (Bagian 5) | ya |
| `POWER_AUTOMATE_EMAIL_URL` | URL pemicu Flow C (Bagian 6) | ya |
| `FOLLOWUP_SENDERS` | pengirim yang boleh dipilih, mis. `IMDS Team <imds@perusahaan.co.id>; Budi <budi@perusahaan.co.id>` | opsional |
| `FOLLOWUP_MIN_GAP_HOURS` | jeda minimum kirim ulang ke supplier yang sama (default 24; `0` mematikan) | opsional |

Catatan: URL flow berisi tanda tangan rahasia. Jangan tempel di chat atau repo. `POWER_AUTOMATE_EXCEL_URL` hanya untuk Judgement; **jangan dipakai untuk Tracker**.

Pastikan juga migrasi database sudah diterapkan (lihat `DEPLOYMENT_AND_CLAUDE_GUIDE_ID.md`; periksa versi remote dulu, jangan reset). Bucket storage `import-staging` harus ada (dibuat oleh migrasi awal).

## 5. Flow A: Tracker → Excel Master

Pemicu: tanpa lisensi Premium, **"When a Teams webhook request is received"** (standar) bisa dipakai, seperti flow Anda sekarang. Jika Anda punya Premium, "When an HTTP request is received" juga sama persis. Website cukup `POST` JSON ke URL-nya.

1. make.powerautomate.com > **Create > Instant cloud flow** > nama `IMDS Tracker - Update Super Master` > pemicu di atas.
   - Di pemicu: *Who can trigger the flow* = **Anyone**. Pilihan lain membuat hanya akun Anda yang berhasil.
   - Pemicu → **Settings** → *Concurrency control* **On**, *Degree of parallelism* **1**, supaya dua kiriman tidak menulis Excel bersamaan.
2. **Parse JSON**: Content = `triggerBody()`; Schema = isi `docs/power-automate/tracker-writeback.schema.json` (tempel apa adanya).
3. **Condition** `Cek Rahasia`: kiri (Expression) `triggerOutputs()?['headers']?['x-imds-secret']`, `is equal to`, kanan = nilai `POWER_AUTOMATE_SECRET`. Semua langkah berikut hanya di cabang **True**. Aktifkan *Secure inputs* pada langkah yang menyentuh rahasia.
4. Di True: **Apply to each**, pilih `rows` dari Parse JSON. Settings > Concurrency control **On, Degree of Parallelism = 1**.
5. Di dalam Apply to each: **Excel Online (Business) > List rows present in a table**.
   - Location, Document Library, File = master Anda; Table = `PartMaster`.
   - Filter Query (tab Expression): `concat('KEY eq ''', string(items('Apply_to_each')?['KEY']), '''')`
6. **Condition** `Check if Row Exist`: `greater(length(body('List_rows_present_in_a_table')?['value']), 0)` is equal to `true`. (Flow Anda memakai Switch dengan 2 case; Condition lebih sederhana dan setara.)
   - **True**: **Update a row**. Table `PartMaster`, Key Column `KEY`, Key Value `items('Apply_to_each')?['KEY']`. Petakan semua kolom dari item (dynamic content) ke kolom bernama sama.
   - **False**: **Add a row into a table**, petakan kolom yang sama.
7. Setelah Apply to each (masih di True) tambahkan **Response** bila pemicunya HTTP (200, body `{"ok":true}`). Pemicu Teams webhook membalas sendiri.
8. **Save**, salin **URL pemicu** > Vercel `POWER_AUTOMATE_TRACKER_URL`, lalu Redeploy.
9. Tambahkan rekan sebagai **co-owner** flow (flow berjalan atas nama pemilik).

### 5b. Versi cepat (disarankan): Office Script `UpsertRows`

Langkah 4–7 di atas memanggil Excel dua kali per baris. Upload MD System dengan ribuan baris berarti ribuan panggilan,
sehingga muncul throttling (429), "file locked", dan flow berjam-jam. Office Script menulis satu batch dengan **satu** panggilan.
"Run script" adalah aksi **standard** (bukan Premium).

1. Buka master di **Excel for the web** → tab **Automate** → **New script**. Hapus isinya, tempel seluruh isi
   `docs/power-automate/UpsertRows.ts`, lalu **Save** dengan nama `UpsertRows`.
2. Agar rekan (co-owner) juga bisa memakai script, pindahkan script ke SharePoint. Di OneDrive Anda, buka
   *Documents > Office Scripts*, lalu **pindahkan** `UpsertRows.osts` ke satu folder di SharePoint tim (misalnya `IMDS/Scripts`).
3. Di flow, ganti langkah 4–6 (Apply to each, List rows, Condition, Update/Add) dengan **satu** aksi
   **Excel Online (Business) → Run script from SharePoint library**:
   - Workbook: master Anda
   - Script library: folder `IMDS/Scripts` · Script: `UpsertRows`
   - `tableName` = `PartMaster` · `keyColumn` = `KEY` · `rowsJson` = `string(body('Parse_JSON')?['rows'])`
4. Di Vercel tambahkan `POWER_AUTOMATE_TRACKER_BATCH` = `200` (default 25), lalu Redeploy. Kiriman per batch jadi
   lebih sedikit dan setiap batch hanya satu panggilan Excel.
5. Hasil script (`{"updated":..,"added":..,"skipped":..}`) terlihat di Run history.

Script yang sama bisa dipakai untuk Judgement Register: `tableName` = `JudgementRegister`, `keyColumn` = `code`,
`rowsJson` = `string(triggerBody())`. Script tidak pernah menghapus baris dan tidak menimpa kolom rumus (misalnya *Judgement state*).

Kenapa lambat/gagal: tanpa Concurrency = 1, dua baris bisa bentrok di Excel. Dengan pemicu Teams webhook, balasan 202 hanya berarti diterima, bukan sudah tertulis; status sebenarnya terlihat di **Run history**.

## 6. Flow C: kirim email beruntun per supplier

1. Instant cloud flow `IMDS Tracker - Supplier Follow-up`, pemicu sama seperti Flow A.
2. **Parse JSON**: Content `triggerBody()`; Schema = `docs/power-automate/supplier-email.schema.json`.
3. **Condition** rahasia (sama seperti Flow A langkah 3), lalu di True:
4. **Data Operations > Select** (lampiran): From = `body('Parse_JSON')?['files']`. Map `Name` → `item()?['name']`, `ContentBytes` → `item()?['contentBytes']`.
   (Versi lama memakai `first(...)`, sehingga hanya lampiran pertama yang terkirim. Pakai Select agar PDF **dan** Excel ikut.)
5. **Office 365 Outlook > Send an email (V2)** (atau *Send an email from a shared mailbox (V2)* bila `from` terisi):
   - To = `to`, CC = `cc`, Subject = `subject`, Body = `bodyHtml` (HTML aman, baris baru sudah benar).
   - Attachments: klik *Switch to input entire array*, isi `body('Select')`.
   - Jika ingin pengirim dari daftar `FOLLOWUP_SENDERS`: tambahkan Condition `empty(body('Parse_JSON')?['from'])`; **True** = Send an email (V2); **False** = Send an email from a shared mailbox (V2) dengan Mailbox Address = `from`. (Akun Anda harus punya hak *Send As* pada mailbox itu.)
6. Pemicu: *Who can trigger* = **Anyone**; Settings → Concurrency **On / 1**.
7. Simpan, salin URL > Vercel `POWER_AUTOMATE_EMAIL_URL`, Redeploy.

Pengiriman beruntun: tombol **Send all sequentially** di Tracker > Follow-up mengirim satu supplier, menunggu balasan, lalu lanjut ke berikutnya. Supplier yang sudah diemail dalam `FOLLOWUP_MIN_GAP_HOURS` terakhir dilewati dan dilaporkan.

## 6c. Menyalakan pengiriman e-mail (tanpa Power Automate Premium)

Gejala "Power Automate is not ready" di Follow-up → Send e-mails berarti salah satu variabel di Vercel belum ada. Urutannya:

1. **Buat flow** (power automate.com → My flows → New flow → Instant cloud flow, nama `IMDS Tracker - Supplier Follow-up`). Pemicu yang tersedia tanpa Premium: **When a Teams webhook request is received** (jangan pakai *When an HTTP request is received*; itu Premium).
2. **Parse JSON**: Content = `triggerBody()`, Schema = isi `docs/power-automate/supplier-email.schema.json` (Generate from sample bila perlu).
3. **Condition** rahasia: `triggerOutputs()?['headers']?['x-imds-secret']` *is equal to* nilai rahasia Anda (string acak panjang, buat sendiri). **No** = tambahkan aksi *Terminate* (Status: Cancelled). Jangan pakai *Response*: itu Premium.
4. Di **Yes**: **Select** lampiran lalu **Office 365 Outlook → Send an email (V2)** dengan To = `to`, CC = `cc`, Subject = `subject`, Body = `bodyHtml`, Attachments = `body('Select')` (lihat Flow C di atas). Tidak perlu *Response* (Premium): pemicu langsung membalas 202 ke website, dan website menganggap 2xx sebagai diterima. Karena itu "Handed to Power Automate" tidak membuktikan e-mail terkirim; cek *Run history* flow.
5. **Save**, buka pemicu, salin **HTTP POST URL**.
6. Di **Vercel → Project → Settings → Environment Variables** (Production) isi:
   - `POWER_AUTOMATE_EMAIL_URL` = URL dari langkah 5
   - `POWER_AUTOMATE_SECRET` = rahasia yang sama dengan langkah 3
   - (opsional) `FOLLOWUP_SENDERS` = `Aiko <aiko@toyota.co.id>; Ayu <ayu@toyota.co.id>` (dipisah titik koma; hanya mailbox yang akun flow Anda boleh *Send As*); `FOLLOWUP_MIN_GAP_HOURS` = jeda minimum antar e-mail ke supplier yang sama.
7. **Redeploy** (Deployments → ⋯ → Redeploy). Variabel baru tidak terbaca sebelum redeploy.
8. Buka Tracker → Follow-up → **Send e-mails**. Banner kuning harus hilang. Jika masih ada, centang ✔/✖ di banner menunjukkan variabel mana yang belum terbaca.

**Uji tanpa risiko ke supplier (urutan yang disarankan):**
1. Langkah 5 → **Send a connection test to me**: mengirim 1 e-mail uji ke alamat Anda. Cek inbox dan *Run history* flow.
2. Mode **🧪 Test — only to me** (default): pilih jenis e-mail, pilih sampai 1/3/5/10 supplier, klik **Send test to me**. Semua e-mail masuk hanya ke alamat Anda, tanpa CC, subjek diawali `[TEST]`, lampiran PDF/Excel dibuat sungguhan. Server menolak alamat uji di luar domain Anda.
3. Baru ganti ke **🚀 Live — to suppliers**, mulai dengan *First 1 selected*, lalu naikkan. Opsi *Pause between e-mails* dan *Stop at the first failure* melindungi dari antrean gagal.

**Pengiriman terjadwal otomatis (belum ada, sengaja).** Aplikasi belum mengirim sendiri pada jam tertentu: template memakai tenggat per model yang hanya ada di browser, jadi pengiriman terjadwal memerlukan tenggat itu disimpan di server lebih dulu. Sampai itu dibuat, pengiriman dipicu dari tombol di layar (sudah mendukung batch dan jeda).

**Buyer:** e-mail 10 buyer PUD (Puguh, Luthfy, Omen, Irman, Taris, Liza, Aries, Bangun, Fifi, Regia) sudah terisi otomatis di Directory → PUD buyers (hanya jika kosong; tidak menimpa isian Anda). Pemetaan supplier → buyer: seret file `Supplier List & Buyer.xlsx` ke halaman Tracker (atau tempel di kotak *Update buyers from a pasted list*). Daftar supplier tidak disimpan di GitHub.

## 6b. Pusat e-mail (Tracker → Follow-up → "Send e-mails")

Semua e-mail ke supplier sekarang lewat **satu tempat**. Tombol *Remind*, *Send reminder*, *Status recap e-mail* di mana pun hanya membuka pusat ini (modal lama sudah dihapus).

**Tiga jenis e-mail, masing-masing punya template (teks asli, boleh diubah sedikit):**
1. **Request (kick-off):** minta supplier konfirmasi status dan tanggal rencana submit.
2. **Follow-up:** kejar satu supplier tentang part yang belum submit.
3. **Status recap:** satu e-mail progres ke semua PIC supplier (lampiran: PDF executive summary + Excel semua part outstanding).

**Alur 5 langkah di layar:** jenis e-mail → part & model (belum submit, atau semua yang belum ACCEPTED; semua model atau model tertentu) → template/pengirim → CC & lampiran → Preview lalu kirim. Template default per jenis ditandai "(default)".

**CC wajib:** `fuad-qc@`, `hendrick.kurdianto@`, `Michael.Aldryan@` (@toyota.co.id) selalu ikut CC dan tidak bisa dimatikan saat mengirim; server menambahkannya lagi jika hilang. Anggota tim pengirim lain juga ikut CC (kecuali pengirimnya sendiri). Opsional per kirim: management menengah, top management, PUD buyer, dan CC tambahan. Daftar CC wajib diubah di **Settings → E-mail templates and rules**.

**Lampiran per supplier (otomatis):** PDF recap dan Excel daftar part number yang belum submit (kolom kanan untuk tanggal rencana supplier). Di panel supplier juga ada tombol **Export Excel** (semua part supplier + status).

**Pengiriman:** lewat Power Automate (sequential, ada progress). "Handed to Power Automate" berarti flow menerima; cek Outlook Sent items untuk memastikan terkirim. Belum dikonfigurasi? Tiap e-mail tetap bisa dibuka sebagai **draft Outlook** lewat Preview. Supplier yang baru dikirimi dilewati kecuali "Send even if e-mailed recently" dicentang (`FOLLOWUP_MIN_GAP_HOURS`).

**Migrasi sekali jalan (wajib agar template & Directory tersimpan di server):** jalankan `supabase/migrations/20261110000000_tracker_settings.sql` di Supabase → SQL editor (atau tombol **Copy the SQL** di Settings → E-mail templates). Sebelum itu, template bawaan tetap dipakai tetapi tidak bisa disimpan. Cek versi migrasi remote dulu; jangan reset database.

**Directory tersimpan di database.** Kontak (sampai top management) dimuat otomatis di setiap browser; tersimpan otomatis ±2 detik setelah diedit.

**PUD buyer:** Directory → tab PUD buyers → *Update buyers from a pasted list*. Tempel baris dari Excel: `email ⇥ nama buyer` (mengisi e-mail buyer) dan/atau `kode ⇥ kode ⇥ nama supplier ⇥ buyer` (menetapkan buyer ke supplier). Tidak ada yang dihapus; supplier yang belum ada di Directory dilaporkan.

## 7. Flow B: Excel Master → website (edit manual di Excel)

Detail lengkap: `POWER_AUTOMATE_IMDS_MASTER_SETUP.md` bagian D. Ringkas:
1. Pemicu SharePoint **When a file is created or modified (properties only)** pada master. Concurrency On/1.
2. **Delay** 45 detik, lalu **List rows present in a table** (`PartMaster`, Pagination 5000).
3. **HTTP** (aksi ini Premium; tanpa Premium lewati Flow B, edit dilakukan di Tracker saja): `POST https://<APP_BASE_URL>/api/imds-master/sync-from-excel`, header `Content-Type: application/json` dan `x-imds-secret: <POWER_AUTOMATE_SECRET>`, body `{"type":"imds_master_snapshot","source":"sharepoint_excel","rows": <body('List_rows_present_in_a_table')?['value']>}`.
4. Tulis balik `assignedKeys` ke kolom KEY (lihat dokumen detail).

Tanpa Premium: edit **di Tracker** (otomatis ke Excel via Flow A). Edit manual di Excel tidak bisa dikirim balik ke website tanpa aksi HTTP.

## 8. Kerja harian

1. Buka Tracker (otomatis memuat dari database).
2. **Seret file Excel ke halaman mana pun di Tracker** (Overview, Settings, dll.). Aplikasi mengenali sendiri hasil MD System (sheet "Export") atau master IMDS Remaining (sheet "Part List LATEST"); jika keduanya dijatuhkan sekaligus, master diproses lebih dulu. Selama menyeret muncul bingkai putus-putus tipis; hasil tampil sebagai notifikasi singkat. Kotak di Settings tetap bisa diklik.
3. Follow-up > **Send e-mails** (lihat 6b).

Catatan teknis: file kecil (≤3,5 MB) dikirim dalam satu permintaan; import MD System memperbarui baris secara paralel; dorongan ke Excel diantrekan dan dikirim otomatis oleh Tracker segera setelah import. Jika koneksi terputus saat server masih bekerja, Tracker memeriksa hasilnya dulu sebelum menyatakan gagal, jadi tidak ada import ganda.

## 9. Urutan uji (jangan dilewati)

1. Tracker membuka dan menampilkan jumlah part. Jika kosong, upload master dulu.
2. Tombol **Sync to Excel now** di Settings; periksa antrean di panel dan *Run history* Flow A.
3. Ubah satu baris di Tracker; pastikan baris yang sama berubah di Excel.
4. Upload MD System; periksa bahwa status ACCEPTED tidak turun dan ada ringkasan matched/ambiguous/unmatched.
5. Kirim satu email ke alamat Anda sendiri sebelum **Send all**.

## 10. Pemecahan masalah

| Gejala | Penyebab umum |
|---|---|
| Panel menulis "not configured" | URL/rahasia belum diisi di Vercel, atau belum Redeploy |
| Flow selalu masuk cabang False | rahasia berbeda satu karakter / spasi |
| `Invalid time value` saat impor | sel tanggal rusak di Excel; sudah diabaikan di versi terbaru |
| Upload gagal "storage" | bucket `import-staging` belum ada / migrasi belum diterapkan |
| Baris dobel di Excel | kolom `KEY` kosong/diubah, atau Concurrency bukan 1 |
| Excel tidak berubah, antrean "pending" | flow mati/lisensi; lihat Run history, lalu **Sync to Excel now** |

## 11. Auto-judge dan memori (Judgement)

**Sekali jalan:** jalankan `supabase/migrations/20261118000000_judgement_memory_autojudge.sql` lalu `20261118010000_judgement_escalations.sql` di Supabase → SQL editor (setelah `20261110000000_tracker_settings.sql`). Cek versi migrasi remote dulu; jangan reset.

**Memori ("tidak ditanya lagi"):** jawaban Toyota per part number (destination, kelas toleransi massa, jawaban flow milik Toyota) disimpan sekali dan otomatis dipakai untuk kasus yang sama. Di panel kasus tertulis *Remembered from <nama> on <tanggal>*. Pilih jawaban lain untuk menggantinya.

**Auto-judge (kartu dengan kucing di atas halaman Judgement):**
1. **Preview** menjalankan semua kasus pending dan menunjukkan berapa yang *akan* OK/NG dan berapa yang masih perlu orang, beserta alasannya. Tidak ada yang ditulis.
2. **Accuracy check** membandingkan keputusan mesin dengan keputusan yang sudah dibuat orang.
3. **Rules** (admin / rule approver): saklar induk, *Shadow mode*, dan saklar per keluarga aturan (mass, SMS, App 44, Pb, substances). Nama dan tanggal yang menyalakan dicatat.
4. Kalau saklar induk ON, shadow OFF, dan keluarganya ON: tombol menjadi **Auto-judge** dan kasus yang lengkap disimpan FINAL oleh `Auto-judgement (System)`, dicatat di audit, dan ikut disinkronkan ke Excel seperti simpan manual. Error Type 19, HOLD, data kurang, dan flow yang belum dikodekan tidak pernah difinalkan.
5. Keputusan otomatis bertanda **Auto OK / Auto NG** di daftar; buka kasusnya lalu **Reopen** (wajib alasan) untuk mengembalikannya ke antrean.

**Eskalasi TMC:** kalau flow berakhir "Contact TMC", panel kasus menampilkan strip kuning. Klik **Mark as sent to TMC** saat sudah dikirim (strip biru), lalu **Record TMC answer** (OK/NG + catatan) saat TMC menjawab (strip hijau). Jawaban itu otomatis dipakai untuk kasus identik berikutnya (part, error type, CAS, flow sama) dan bisa difinalkan oleh auto-judge bila keluarga *substances* dinyalakan.

## 12. Kirim e-mail tanpa Power Automate (untuk semua orang)

Di Tracker → Follow-up → **Send e-mails**, langkah 5 punya tiga mode:
1. **🧪 Test — only to me**: lewat Power Automate, hanya ke alamat Anda.
2. **📨 Outlook drafts — my own mailbox**: bisa dipakai **semua orang**, tanpa Power Automate. Website menyiapkan e-mail lengkap (To, CC wajib, subjek, isi, lampiran PDF + Excel) sebagai file `.eml`. Satu supplier → satu file `.eml`; banyak supplier → satu `.zip`. Buka file `.eml` (klik dua kali) → Outlook desktop membukanya sebagai **e-mail baru dari mailbox Anda sendiri** dengan lampiran sudah terpasang → periksa → **Send**. Tidak ada yang terkirim otomatis.
3. **🚀 Send now — Power Automate**: kirim otomatis lewat flow tim.

Di pratinjau tiap supplier juga ada tombol **📨 Outlook draft with attachments**.

Catatan: file `.eml` terbuka sebagai draft di **Outlook desktop (Windows/Mac)**. Outlook di browser tidak bisa membuka `.eml` sebagai draft; untuk itu pakai **Quick e-mail (no attachments)** lalu lampirkan file yang diunduh.

## 13. Kenapa rekan tidak bisa upload / kirim?

- **Peran**: upload dan kirim butuh peran *preparer*, *reviewer* atau *admin*. Peran *viewer* hanya melihat (tetap bisa membuat Outlook drafts). Admin mengubahnya di **Settings → Team access**.
- **Tabel belum dibuat**: selama migrasi `20261110000000_tracker_settings.sql` belum dijalankan, Directory (kontak supplier) dan template **hanya tersimpan di browser yang mengisinya**, sehingga rekan lain tidak melihat kontak dan e-mail mereka "tidak siap". Jalankan semua migrasi di bagian 11 sekali, maka semua orang memakai data yang sama.
