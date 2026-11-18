# Power Automate tanpa lisensi Premium: panduan langkah demi langkah

Panduan ini menggantikan semua pemicu **"When an HTTP request is received"**. Pemicu itu, dan aksi **Response**, adalah
connector **Premium**. Di akun yang tidak punya Power Automate Premium, flow seperti itu gagal disimpan, berhenti
sendiri ("suspended"), atau jalan di akun A tetapi tidak di akun B. Itu penyebab paling mungkin dari masalah
"di akun lain gagal semua".

Semua yang dipakai di sini **standard** (termasuk lisensi Microsoft 365 biasa):

| Connector | Dipakai untuk |
|---|---|
| Microsoft Teams: **When a Teams webhook request is received** | Website memanggil flow (pengganti pemicu HTTP) |
| Excel Online (Business) | List rows, Update a row, Add a row |
| Office 365 Outlook | Send an email (V2) |
| Schedule: **Recurrence** | Pengingat supplier harian |
| Data Operations, Control | Select, Filter array, Compose, Create HTML table, Condition, Apply to each |

> Status: langkah ini disusun dari dokumentasi connector dan diuji pada **workbook** (rumus dan tabel dihitung ulang
> dengan LibreOffice). **Flow belum pernah saya jalankan di tenant Toyota.** Ikuti urutan uji di bagian 8.

---

## 0. Kenapa gagal di akun lain (cek dulu)

| Gejala | Penyebab | Perbaikan |
|---|---|---|
| "This flow uses premium connectors", atau flow *suspended* | Pemicu HTTP / aksi Response adalah Premium | Ganti dengan pemicu Teams webhook (bagian 2) |
| `Update a row`: *No row was found with ID…* | Nilai `code` beda: spasi, angka dan teks tercampur, atau baris belum ada | Workbook baru: semua `code` teks `code:YYYYMMDDNNN`. Tambahkan **Add a row** saat Update gagal (bagian 2.4) |
| `The file is locked for shared use` / `Resource busy` | File dibuka di Excel desktop, AutoSave mati | Buka lewat Excel for the web atau nyalakan AutoSave; pasang **Retry policy** (bagian 1.4) |
| Flow jalan di akun A, di akun B *File not found* | File dipilih dari **OneDrive pribadi** A ("Me") | Pindahkan file ke **SharePoint site** tim; di aksi Excel pilih *Location = SharePoint Site*, bukan OneDrive |
| Setelah impor/bagi flow: *Connection not configured* atau *Unauthorized* | Koneksi milik pembuat flow tidak ikut | Setiap pemilik membuat koneksinya sendiri, lalu **pilih ulang file dan tabel** di setiap aksi Excel |
| `List rows` hanya 256 baris | Batas bawaan | Settings aksi → **Pagination** On, Threshold `10000` |
| Tanggal jadi angka (46325) | Excel mengembalikan serial date | `List rows` → Show advanced → **DateTime Format = ISO 8601** |
| `429 Too many requests` | Batas Excel connector sekitar 100 panggilan per menit per koneksi | Concurrency **1** pada loop; biarkan retry bawaan |
| Kolom tidak muncul di Update a row | Nama tabel atau header berubah | Nama tabel harus persis `JudgementRegister`; header 13 kolom pertama jangan diubah |
| Hanya pemilik yang bisa menjalankan | Pengguna lain hanya *run-only* | Tambahkan rekan sebagai **Co-owner** (Share), atau pakai satu akun layanan bersama sebagai pemilik |

**Saran kuat:** buat semua flow dengan **satu akun bersama** (misalnya mailbox tim IMDS), tambahkan rekan sebagai
co-owner, dan simpan workbook di **SharePoint site tim**. Satu pemilik dan satu lokasi file menghilangkan sebagian besar
error "beda akun".

---

## 1. Siapkan workbook (sekali)

1. Unggah `JudgementRegister.xlsx` (dari chat ini) ke **SharePoint site → Documents**, misalnya `IMDS/JudgementRegister.xlsx`.
   Jika file lama sudah dipakai flow, gunakan **Replace** dengan nama dan lokasi yang sama.
2. Isi lembar **Daftar kontak supplier (tabel `SupplierContacts`)**: `PIC Email`, `CC Emails` (pisahkan dengan `;`), `Send reminders` (Y/N).
   Kode dan nama supplier sudah terisi untuk supplier yang punya kasus menunggu konfirmasi. Alamat email tidak ditebak.
3. Isi tabel `JudgementRegister`:
   - 13 kolom pertama: kolom yang ditulis flow.
   - **Supplier reminder** (Y/N): `Y` sudah diisi untuk kasus *To judge* yang langkah pertama Manual Flow-nya
     "Confirm to supplier" (mass tolerance, SMS mass, Application44, prohibited substance, not specified, mass deviation,
     supplied is not SMS). Ubah ke `N` untuk kasus yang tidak perlu diingatkan.
   - **Last reminder sent**, **Reminder count**: diisi flow pengingat.
   - **Judgement state**: rumus (To judge / Waiting TMA / Judged / Other). Jangan ditimpa; nilainya berubah sendiri saat Judge dan KM Judge diisi.
4. Lembar **Ringkasan (sheet `Summary`)** menghitung semuanya secara otomatis.

### 1.4 Retry policy (setiap aksi Excel)

Aksi → **Settings** → Retry policy: **Exponential**, Count `4`, Interval `PT20S`.

---

## 2. Flow A: website → Judgement Register (pengganti flow "Excel register")

### 2.1 Pemicu
1. **Create** → **Instant cloud flow** → lewati → cari **When a Teams webhook request is received**.
2. *Who can trigger the flow*: **Anyone** (website memanggil dari server; keamanannya diperiksa dengan rahasia di 2.2).
3. Simpan flow, lalu salin **HTTP URL** dari pemicu.
4. Di Vercel: `POWER_AUTOMATE_EXCEL_URL` = URL itu dan `POWER_AUTOMATE_SECRET` = rahasia panjang. Lalu redeploy.

### 2.2 Cek rahasia
- **Parse JSON**: Content `triggerBody()`. Untuk Schema, klik *Use sample payload* dan tempel:
  `{"type":"excel_upsert","code":"code:20261118007","Assigned person":"","Starting date":"","Judgment procedure":"","Judge OK/NG":"OK","Comment of changing to OK":"","IMDS Reject comment":"","KM Judge":"","KM Comment":"","Last Change Date":""}`
- **Condition**: `triggerOutputs()?['headers']?['x-imds-secret']` *is equal to* rahasia Anda.
  - **False** → **Terminate** (Status: Cancelled).

### 2.3 Update a row (di cabang True)
Excel Online (Business) → **Update a row**
- Location: **SharePoint Site** (situs tim) · Document Library · File: `JudgementRegister.xlsx` · Table: `JudgementRegister`
- Key Column: `code` · Key Value: `body('Parse_JSON')?['code']`
- Isi kolom: Assigned person, Starting date, Judgment procedure, Judge OK/NG, Comment of changing to OK, IMDS Reject comment,
  KM Judge, KM Comment, Last Change Date. Ambil masing-masing dari Parse JSON.
- **Kosongkan** kolom lain (Judgement state, Supplier reminder, dan seterusnya). Kolom kosong di aksi tidak menimpa nilai yang ada.

### 2.3b Lebih cepat dan tahan beda akun: Office Script
Alternatif untuk 2.3 + 2.4 adalah satu aksi **Run script from SharePoint library**, memakai script `UpsertRows`
(`docs/power-automate/UpsertRows.ts`; cara pasang ada di `PANDUAN_SETUP_LENGKAP_ID.md` bagian 5b) dengan
`tableName` = `JudgementRegister`, `keyColumn` = `code`, `rowsJson` = `string(triggerBody())`.
Baris yang ada diperbarui dan baris baru ditambahkan. Kolom rumus seperti *Judgement state* tidak tertimpa.

### 2.4 Kalau barisnya belum ada
Tambahkan **Add a row into a table** (file dan tabel sama) dengan isi yang sama ditambah `code`, `Error Type`,
`Delivery Part No` dan `Supplier Code`. Lalu **Configure run after** = *Update a row* **has failed**.

### 2.5 Settings pemicu
Concurrency control **On**, Degree of parallelism **1**.

**Catatan jujur:** pemicu Teams webhook langsung menjawab **HTTP 202** sebelum flow berjalan. Website memperlakukan 202 sebagai
**diserahkan ke flow**, bukan "pasti tersimpan". Hasil akhirnya ada di *Run history* flow, dan di Excel (kolom terisi).

---

## 3. Flow B: website → email supplier (pengganti flow email)

1. Pemicu sama seperti 2.1 (flow baru, URL baru). Di Vercel: `POWER_AUTOMATE_EMAIL_URL`.
2. **Parse JSON**: `triggerBody()`. Schema: isi `docs/power-automate/supplier-email.schema.json`.
3. Cek rahasia seperti 2.2.
4. **Select** (lampiran): From `body('Parse_JSON')?['attachments']`. Map `Name` → `item()?['name']`, `ContentBytes` → `item()?['contentBytes']`.
5. Office 365 Outlook → **Send an email (V2)**:
   - To `to`, CC `cc`, Subject `subject`, Body `bodyHtml` (HTML aman, baris baru sudah `<br>`)
   - Attachments: *switch to input entire array* → `body('Select')`
   - From (Send as) `from`: isi hanya jika akun pemilik flow punya izin **Send As** di mailbox itu
6. Settings pemicu: Concurrency **1**.

Tidak ada aksi Response (itu Premium). Website mencatat "diserahkan ke flow (202)", dan jeda kirim ulang tetap berlaku.

---

## 4. Flow C: pengingat supplier harian (100% di Power Automate, tidak perlu website)

Flow ini membaca Excel, mengelompokkan per supplier, mengirim **satu email per supplier** berisi semua part-nya, lalu
mencatat tanggal pengingat di setiap baris.

1. **Scheduled cloud flow** → **Recurrence**: Every `1` Day, Time zone `(UTC+07:00) Bangkok, Hanoi, Jakarta`,
   At these hours `8`, At these minutes `37`, On these days: Mon–Fri.
2. **Initialize variable** `minGapDays` (Integer) = `3` (jarak minimal antar pengingat ke supplier yang sama).
3. Excel **List rows present in a table** → beri nama aksi **`Rows`**
   - File `JudgementRegister.xlsx`, Table `JudgementRegister`
   - Filter Query: `Supplier reminder eq 'Y'`
   - DateTime Format: **ISO 8601** · Settings: Pagination **On**, Threshold `10000`
4. Excel **List rows present in a table** → **`Contacts`**: Table `SupplierContacts`, Filter Query `Send reminders eq 'Y'`.
5. **Filter array** → **`Due`**: From `body('Rows')?['value']`, *Edit in advanced mode*:
   ```
   @and(equals(item()?['Judgement state'], 'To judge'), or(empty(item()?['Last reminder sent']), less(string(item()?['Last reminder sent']), formatDateTime(addDays(utcNow(), mul(-1, variables('minGapDays'))), 'yyyy-MM-ddTHH:mm:ssZ'))))
   ```
6. **Select** → **`SupplierCodes`**: From `body('Due')`. Ubah ke *text mode*, isi `item()?['Supplier Code']`.
7. **Compose** → **`Distinct`**: `union(body('SupplierCodes'), body('SupplierCodes'))`
8. **Apply to each** over `outputs('Distinct')`. Settings → Concurrency **1**.
   1. **Filter array** → **`Contact`**: From `body('Contacts')?['value']`, advanced:
      `@equals(trim(string(item()?['Supplier Code'])), trim(string(items('Apply_to_each'))))`
   2. **Condition**: `length(body('Contact'))` is greater than `0` **and** `first(body('Contact'))?['PIC Email']` is not equal to *(kosong)*.
      Jika False, lewati supplier ini (tidak ada email, jadi tidak ada tebakan).
   3. (True) **Filter array** → **`Parts`**: From `body('Due')`, advanced:
      `@equals(trim(string(item()?['Supplier Code'])), trim(string(items('Apply_to_each'))))`
   4. **Select** → **`Table`**: From `body('Parts')`. Map: `Part No` → `item()?['Delivery Part No']`, `Error Type` → `item()?['Error Type']`,
      `G-CATS code` → `replace(item()?['code'],'code:','')`, `Since` → `item()?['Download Date']`
   5. **Create HTML table**: From `body('Table')`, Columns Automatic.
   6. **Send an email (V2)**:
      - To: `first(body('Contact'))?['PIC Email']` · CC: `first(body('Contact'))?['CC Emails']`
      - Subject: `concat('[Reminder] IMDS confirmation needed – ', first(body('Contact'))?['Supplier Name'], ' (', length(body('Parts')), ' part(s))')`
      - Body (Is HTML Yes), contoh:
        ```
        Dear @{first(body('Contact'))?['Supplier Name']} team,<br><br>
        The parts below still wait for your IMDS confirmation. For each part please answer:<br>
        A. the value is actual / calculated (it stays as it is), or B. it is an input mistake (please resubmit IMDS).<br><br>
        @{body('Create_HTML_table')}<br>
        You can also check your data before submitting in the supplier self-check on the IMDS portal.<br><br>
        Thank you,<br>TMMIN IMDS team
        ```
   7. **Apply to each** over `body('Parts')` (Concurrency 1) → Excel **Update a row**: Key Column `code`, Key Value `items('Apply_to_each_2')?['code']`
      - Last reminder sent: `formatDateTime(utcNow(),'yyyy-MM-ddTHH:mm:ssZ')`
      - Reminder count: `add(int(if(empty(items('Apply_to_each_2')?['Reminder count']),'0',string(items('Apply_to_each_2')?['Reminder count']))),1)`

Hasil: setiap pagi, setiap supplier yang punya kasus *To judge* bertanda `Y` dan belum diingatkan dalam `minGapDays` hari
menerima **satu** email. Begitu Judge diisi, rumus *Judgement state* berubah dan pengingatnya berhenti sendiri.

---

## 5. Flow D: Tracker → Excel Super Master
Sama seperti `POWER_AUTOMATE_IMDS_MASTER_SETUP.md` bagian B, dengan dua perubahan: pemicu diganti **When a Teams webhook request is received**
(seperti 2.1, lalu Parse JSON `triggerBody()`), dan aksi **Response** dihapus. Di Vercel: `POWER_AUTOMATE_TRACKER_URL`.

## 6. Jika semua pemicu webhook diblokir oleh kebijakan DLP tenant
Gunakan **Opsi B (email perintah)** di `POWER_AUTOMATE_SETUP.md`: website mengirim email JSON ke mailbox Anda, dan flow
**When a new email arrives (V3)** (standard) memprosesnya. Flow C (pengingat) tidak terpengaruh karena tidak butuh website.

## 7. Membagikan flow ke rekan atau akun lain
1. Buka flow → **Share** → tambahkan rekan sebagai **Co-owner**. Jangan gunakan Export/Import kecuali perlu.
2. Jika rekan memakai koneksinya sendiri, ia harus membuka setiap aksi Excel atau Outlook, memilih koneksinya, lalu **memilih ulang File dan Table**.
3. Untuk mengirim dari mailbox bersama: admin M365 memberi izin **Send As** ke akun pemilik flow.
4. Satu file, satu nama tabel. Jangan membuat salinan workbook per orang.

## 8. Urutan uji (jangan dilewati)
1. Flow A: di website, **Follow-up → Power Automate → Test (Excel)**. Baris `IMDS-PING` harus muncul atau berubah di Excel (lihat juga Run history).
2. Flow B: **Send test to me**. Email masuk ke alamat Anda sendiri.
3. Flow C: tambahkan satu baris uji dengan `Supplier reminder = Y` dan Supplier Code milik **kontak uji** berisi email Anda sendiri.
   Lalu **Test → Manually**. Harus datang satu email, dan *Last reminder sent* terisi.
4. Jalankan Flow C sekali lagi. Tidak boleh ada email kedua (jeda `minGapDays`).
5. Kembalikan kontak asli, lalu nyalakan Recurrence.
