# Power Automate: peta semua automasi (IMDS Tracker + Judgement)

> **Tidak punya lisensi Premium, atau flow gagal di akun lain?** Pakai `POWER_AUTOMATE_STANDARD_ID.md`. Panduan itu
> mengganti pemicu HTTP (Premium) dengan pemicu Teams webhook (standard), dan menambahkan flow pengingat supplier harian
> yang hanya memakai Excel, Outlook dan Recurrence. Bagian di bawah tetap berlaku untuk payload dan aturan pengiriman.

Dokumen ini adalah **satu-satunya daftar** flow yang perlu Anda buat. Detail langkah klik untuk flow Excel tetap ada di
`POWER_AUTOMATE_SETUP.md` (Judgement) dan `POWER_AUTOMATE_IMDS_MASTER_SETUP.md` (Tracker). Yang berubah di sini adalah
**email supplier**: Tracker dan Judgement sekarang memakai **satu flow dan satu bentuk payload (versi 2)**.

> Status: kode di website sudah diuji dengan unit test. **Flow di tenant Microsoft Anda belum pernah saya jalankan**, jadi
> uji satu supplier dulu sebelum memakai kirim massal.

## 1. Empat flow

| # | Flow | Pemicu | Env var di Vercel | Detail |
|---|---|---|---|---|
| 1 | **Email supplier** (Tracker + Judgement, per supplier, dengan PDF, CC, pengirim) | When an HTTP request is received | `POWER_AUTOMATE_EMAIL_URL` | Bagian 3 di bawah |
| 2 | Judgement → Excel register (kolom AO–AW) | When an HTTP request is received | `POWER_AUTOMATE_EXCEL_URL` | `POWER_AUTOMATE_SETUP.md`, Flow 1 |
| 3 | Tracker → Excel Super Master | When an HTTP request is received | `POWER_AUTOMATE_TRACKER_URL` | `POWER_AUTOMATE_IMDS_MASTER_SETUP.md`, bagian B |
| 4 | Excel Super Master → website | SharePoint: file created or modified | tidak ada; flow memanggil website | `POWER_AUTOMATE_IMDS_MASTER_SETUP.md`, bagian D |

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
- Map: `Name` = `item()?['name']`, `ContentBytes` = `item()?['contentBytes']`

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
