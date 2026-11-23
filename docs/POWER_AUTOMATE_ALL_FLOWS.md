# Power Automate: peta semua automasi (IMDS Tracker + Judgement)

> **Tidak punya lisensi Premium, atau flow gagal di akun lain?** Pakai `POWER_AUTOMATE_STANDARD_ID.md`. Panduan itu
> mengganti pemicu HTTP (Premium) dengan pemicu Teams webhook (standard), dan menambahkan flow pengingat supplier harian
> yang hanya memakai Excel, Outlook dan Recurrence. Bagian di bawah tetap berlaku untuk payload dan aturan pengiriman.

Dokumen ini adalah **satu-satunya referensi** flow yang perlu Anda buat. Langkah klik flow Tracker → Excel Super Master
ada di `PANDUAN_SETUP_LENGKAP_ID.md` bagian 5; flow lain ada di dokumen ini (bagian 3 dan Lampiran A–D).
Tracker dan Judgement memakai **satu flow email dan satu bentuk payload (versi 2)**.

> Status: kode di website sudah diuji dengan unit test. **Flow di tenant Microsoft Anda belum pernah saya jalankan**, jadi
> uji satu supplier dulu sebelum memakai kirim massal.

## 1. Empat flow

| # | Flow | Pemicu | Env var di Vercel | Detail |
|---|---|---|---|---|
| 1 | **Email supplier** (Tracker + Judgement, per supplier, dengan PDF, CC, pengirim) | When an HTTP request is received | `POWER_AUTOMATE_EMAIL_URL` | Bagian 3 di bawah |
| 2 | Judgement → Excel register (kolom AO–AW) | When an HTTP request is received | `POWER_AUTOMATE_EXCEL_URL` | Lampiran A |
| 3 | Tracker → Excel Super Master | When an HTTP request is received | `POWER_AUTOMATE_TRACKER_URL` | `PANDUAN_SETUP_LENGKAP_ID.md`, bagian 5 |
| 4 | Excel Super Master → website | SharePoint: file created or modified | tidak ada; flow memanggil website | Lampiran C |

Semua flow memakai satu rahasia: `POWER_AUTOMATE_SECRET`, dikirim di header `x-imds-secret`. Flow harus menolak (401)
permintaan tanpa header yang cocok.

## 2. Variabel Vercel

| Nama | Fungsi |
|---|---|
| `POWER_AUTOMATE_EMAIL_URL` | URL flow 1 |
| `POWER_AUTOMATE_EXCEL_URL` | URL flow 2 (jangan dipakai ulang untuk tracker) |
| `POWER_AUTOMATE_TRACKER_URL` | URL flow 3 |
| `POWER_AUTOMATE_SECRET` | rahasia bersama |
| `FOLLOWUP_SENDERS` | daftar mailbox yang boleh dipakai sebagai pengirim, contoh `IMDS Team <imds@perusahaan.co.id>; Budi <budi@perusahaan.co.id>` |
| `FOLLOWUP_MIN_GAP_HOURS` | jeda minimum kirim ulang ke supplier yang sama (default 24; `0` mematikan) |
| `SUPABASE_SERVICE_ROLE_KEY` | hanya server, untuk flow 4 |

URL flow mengandung tanda tangan rahasia. Jangan masukkan ke repo.

## 3. Flow 1: email supplier (versi 2)

### 3.1 Pemicu

Tambahkan **When an HTTP request is received** dan tempel skema ini. Skema ini dihasilkan dari kode
(`SUPPLIER_EMAIL_SCHEMA`) dan dijaga oleh tes supaya tidak berbeda dari yang dikirim website.

<!-- SUPPLIER_EMAIL_SCHEMA -->
```json
{
  "type": "object",
  "properties": {
    "type": {
      "type": "string"
    },
    "version": {
      "type": "integer"
    },
    "source": {
      "type": "string"
    },
    "followupId": {
      "type": "string"
    },
    "logId": {
      "type": "string"
    },
    "supplierCode": {
      "type": "string"
    },
    "supplierName": {
      "type": "string"
    },
    "from": {
      "type": "string"
    },
    "senderName": {
      "type": "string"
    },
    "to": {
      "type": "string"
    },
    "cc": {
      "type": "string"
    },
    "subject": {
      "type": "string"
    },
    "body": {
      "type": "string"
    },
    "bodyHtml": {
      "type": "string"
    },
    "attachments": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "contentType": {
            "type": "string"
          },
          "contentBytes": {
            "type": "string"
          }
        }
      }
    },
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "contentType": {
            "type": "string"
          },
          "contentBytes": {
            "type": "string"
          }
        }
      }
    },
    "metadata": {
      "type": "object",
      "properties": {
        "partCount": {
          "type": "integer"
        },
        "projects": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "items": {
          "type": "integer"
        }
      }
    }
  }
}
```

Di **Settings** pemicu: aktifkan **Concurrency control**, Degree of parallelism = `1`. Website mengirim satu supplier per
permintaan, berurutan; pengaturan ini mencegah Outlook menolak kiriman yang menumpuk.

Payload lama (tanpa `version`, `from`, `attachments`) tetap diterima oleh skema ini, jadi flow yang sudah Anda buat tidak rusak.

### 3.2 Cek rahasia

Condition: `triggerOutputs()?['headers']?['x-imds-secret']` sama dengan rahasia Anda.
Jika tidak: **Response 401**, lalu **Terminate**.

### 3.3 Lampiran

Tambahkan **Select** (Data Operations):
- From: `triggerBody()?['files']` (file dikirim di `files`; `attachments` selalu kosong karena pemicu Teams webhook menolak file di `attachments` dengan HTTP 400)
- Map: `Name` = `item()?['name']`, `ContentBytes` = `base64ToBinary(item()?['contentBytes'])` (wajib `base64ToBinary`: tanpa itu Outlook menyandikan file dua kali dan lampiran terbuka kosong/rusak)

### 3.4 Kirim

Tambahkan **Condition**: `empty(triggerBody()?['from'])` sama dengan `true`.

**Jika ya** (pengirim bawaan, yaitu akun pemilik flow): Office 365 Outlook → **Send an email (V2)**
- To = `to`, CC = `cc`, Subject = `subject`, Body = `bodyHtml` (HTML aman, baris baru sudah `<br>`; untuk flow lama `body` tetap ada)
- Attachments: klik ikon "switch to input entire array", isi `body('Select')`

**Jika tidak** (pengirim dipilih di website): **Send an email (V2)** yang sama, ditambah *Show advanced options* → **From (Send As)** = `from`.
Alternatif: **Send an email from a shared mailbox (V2)** dengan *Original Mailbox Address* = `from`.

Syarat pengirim: admin Microsoft 365 harus memberi akun pemilik flow izin **Send As** (atau Send on Behalf) pada setiap
mailbox di `FOLLOWUP_SENDERS`. Tanpa izin, aksi gagal dan website menandai pengiriman **FAILED** dengan pesannya.
Website **menolak** pengirim yang tidak ada di daftar `FOLLOWUP_SENDERS`, jadi tidak ada yang bisa mengirim atas nama orang lain.

### 3.5 Jawaban

Setelah aksi kirim sukses: **Response 200**. Tambahkan **Response 500** dengan *Configure run after* = *has failed* pada aksi kirim.
Website menganggap **SENT hanya jika flow menjawab 2xx**, jadi Response 200 harus ada di akhir, setelah email benar-benar dikirim.

### 3.6 Apa yang dikirim website

| Sumber | Penerima (To) | CC | Lampiran |
|---|---|---|---|
| Tracker | `MAIN PIC EMAIL` di Part List (utama); jika kosong, kontak berperan PIC di direktori supplier | kontak CC/Marketing/SPV di direktori + CC tambahan yang diketik pengirim | PDF per supplier: semua part outstanding supplier itu |
| Judgement | kontak berperan PIC di direktori (SPV tidak pernah jadi penerima utama) | sama | belum ada |

Aturan yang sama dijalankan oleh satu fungsi (`lib/followup/recipients.ts`) untuk kedua sumber.

## 4. Cara kerja kirim per supplier dari website

1. Website menyusun satu email per supplier: PIC supplier itu, CC-nya, daftar part-nya, dan PDF-nya sendiri.
2. Tombol kirim massal memanggil server **satu supplier per permintaan, berurutan**.
3. Server menolak jika supplier yang sama sudah dikirimi dalam `FOLLOWUP_MIN_GAP_HOURS` terakhir (kecuali `force`).
4. Supplier tanpa email PIC dilewati dan ditandai. Website tidak menebak alamat.
5. Setiap percobaan tercatat (log + audit): siapa, kapan, ke siapa, berapa part, dan hasilnya.

## 5. Urutan uji (jangan lewati)

1. Isi env var, deploy ulang.
2. Pastikan `FOLLOWUP_SENDERS` hanya berisi mailbox yang flow-nya punya izin Send As.
3. Kirim **satu** supplier uji dengan alamat PIC Anda sendiri. Periksa To, CC, PDF, dan nama pengirim.
4. Kirim ulang supplier yang sama: harus ditolak (jeda kirim ganda).
5. Baru gunakan kirim massal.

---

## Lampiran A. Flow Judgement → Excel register (kolom AO–AW), `POWER_AUTOMATE_EXCEL_URL`

Setiap judgement yang disimpan menulis register dulu, lalu menambah job `EXCEL_UPSERT` ke `sync_outbox` (migrasi
`20261106000300_sync_outbox.sql`), lalu mengirim baris *terkini* ke flow. Job gagal tetap di antrean (maks. 5 kali);
**Sync now** di halaman Follow-up mencobanya lagi. Kalau URL flow belum diisi, tidak ada yang diklaim tersinkron.

Syarat: Excel Online (Business) hanya bekerja pada **Excel Table** di SharePoint/OneDrive. Jadikan sheet register sebuah
Table dengan kolom `code` yang unik, satu sheet saja (header ganda dan sheet master historis tidak digabung). Nyalakan
*Retry policy* pada aksi Excel (file yang sedang dibuka eksklusif di Excel desktop membuat aksi gagal).

Pemicu: *When an HTTP request is received* (Premium) **atau** *When a Teams webhook request is received* (standar,
lihat `POWER_AUTOMATE_STANDARD_ID.md` bagian 2). Schema:

```json
{"type":"object","properties":{"type":{"type":"string"},"code":{"type":"string"},
"Assigned person":{"type":"string"},"Starting date":{"type":"string"},"Judgment procedure":{"type":"string"},
"Judge OK/NG":{"type":"string"},"Comment of changing to OK":{"type":"string"},"IMDS Reject comment":{"type":"string"},
"KM Judge":{"type":"string"},"KM Comment":{"type":"string"},"Last Change Date":{"type":"string"}}}
```

1. Condition: header `x-imds-secret` sama dengan `POWER_AUTOMATE_SECRET`; jika tidak, berhenti (Response 401 bila Premium).
2. Excel Online → **Update a row**: Key Column `code`, Key Value `triggerBody()?['code']`, petakan kolom di atas.
3. Premium: Response 200 setelah langkah 2 berhasil (500 bila gagal). Teams webhook menjawab 202 sendiri, tanpa Response.

Nama header harus sama dengan header Table Anda; sesuaikan pemetaan bila berbeda.

## Lampiran B. Tanpa pemicu webhook: email perintah (konektor standar)

Pakai ini hanya jika semua pemicu webhook diblokir. Website → SMTP → email perintah ke inbox Outlook Anda → pemicu
*When a new email arrives (V3)* → Excel *Update a row* atau Outlook *Send an email (V2)*. Jeda biasanya detik sampai 1–2 menit.

- Vercel (server-only): `FLOW_SMTP_HOST`, `FLOW_SMTP_PORT` (465), `FLOW_SMTP_USER`, `FLOW_SMTP_PASS`, `FLOW_SMTP_FROM`,
  `FLOW_INBOX_ADDRESS`, `POWER_AUTOMATE_SECRET`. Kosongkan `POWER_AUTOMATE_*_URL`. Pakai akun pengirim khusus dengan app password.
- Flow Excel: Subject Filter `IMDS-SYNC|<rahasia>|excel_upsert`, From = alamat pengirim → *Parse JSON* isi email
  (schema Lampiran A) → *Update a row*. Bila Outlook membungkus HTML, pakai `bodyPreview` atau langkah HTML-to-text.
- Flow email supplier: Subject Filter `IMDS-SYNC|<rahasia>|supplier_email` → *Parse JSON* (`to`, `cc`, `subject`, `body`) → *Send an email (V2)*.
- Status jujur: "SENT" dengan `handed_off_via_mail` berarti SMTP menerimanya. Website **tidak tahu** apakah flow berjalan;
  cek *run history* di Power Automate. Rahasia subject harus panjang dan filter From wajib aktif.

## Lampiran C. Flow Excel Super Master → website (edit manual di Excel)

Membuat master dua arah: edit manual atau baris baru di `PartMaster` dikirim ke database, Tracker memuat ulang dari
database. Baris yang tidak ada di snapshot **tidak** dihapus. Aksi **HTTP** adalah Premium; tanpa Premium, edit di Tracker saja.

1. Pemicu **SharePoint → When a file is created or modified (properties only)** pada workbook master yang sama dengan flow
   Tracker → Excel. Concurrency **On / 1**, lalu **Delay 45 detik** supaya tulisan Excel Online selesai dulu.
2. **Excel Online (Business) → List rows present in a table**: Table `PartMaster`, Pagination **On, 5000**
   (endpoint menerima maks. 5.000 baris / 3,8 MB per snapshot). Jangan ubah nama kolom; kolom `KEY` harus ada.
3. **HTTP** `POST https://<APP_BASE_URL>/api/imds-master/sync-from-excel`, header `Content-Type: application/json` dan
   `x-imds-secret: <POWER_AUTOMATE_SECRET>`, body (isi `rows` lewat editor Expression, jangan sebagai teks):

   ```json
   { "type": "imds_master_snapshot", "source": "sharepoint_excel", "rows": "@{body('List_rows_present_in_a_table')?['value']}" }
   ```

   Endpoint mencocokkan baris dengan `KEY`, menormalkan tanggal dan nomor part, dan menyimpan riwayat MD System.
4. Baris baru tanpa `KEY` mendapat kunci baru di `assignedKeys` (`{ no, masterKey }`). **Apply to each** atas
   `body('HTTP')?['assignedKeys']` → **Update a row**: Key Column `NO.`, Key Value `items('Apply_to_each')?['no']`,
   kolom `KEY` = `items('Apply_to_each')?['masterKey']`. `NO.` harus unik per baris; bila ada peringatan `No.` kosong,
   isi nomor unik di Excel dan biarkan pemicu berjalan lagi.

Aturan konflik: tulisan terakhir yang diterima menang. Jangan mengedit part yang sama di Excel dan website bersamaan.

## Lampiran D. Memeriksa dan mengoperasikan (Follow-up → panel Power Automate)

- **Checklist**: flow Excel, flow email dan rahasia sudah diisi atau belum, dan jalur yang dipakai (langsung / lewat mailbox).
- **Test (Excel)**: upsert baris tetap `IMDS-PING` (pertama ditambah, berikutnya diperbarui). Hapus kapan saja.
- **Send test to me**: satu email ke alamat Anda sendiri.
- **Pill di bar atas**: "Excel in sync / n waiting / n failed". Selama ada pengguna internal yang membuka aplikasi, job
  antrean dicoba ulang sekitar sekali per menit; **Retry failed now** mengulang job yang habis percobaannya.
- **Download register CSV**: isi awal register WORKING dengan urutan kolom Table Excel; sel berawalan `= + - @` diberi `'`.
- Batas: jika tidak ada yang membuka aplikasi dan flow mati, retry menunggu (cron Vercel Hobby hanya harian).

