# IMDS / G-CATS Judgement Register — Panduan Mulai

Versi pengembangan: **0.2.2**. Produk utama sekarang adalah **Judgement Register** yang menata sembilan field AO–AW dari Master Data All IMDS, bukan dashboard KPI generik.

> Aplikasi ini belum Toyota-approved, belum production-certified, dan belum terhubung langsung ke sistem IMDS/G-CATS. Keputusan akhir tetap dilakukan manusia.

## 1. Menjalankan di Windows PowerShell

Persyaratan: Node.js 22.16.0+ dan npm 11.21.1+.

```powershell
npm install -g npm@11.21.1
npm -v
npm install
Copy-Item .env.example .env.local
npm run dev
```

Setelah terminal menampilkan `Local: http://localhost:3000`, buka alamat itu di Chrome atau Edge. Jangan masukkan URL sebagai perintah PowerShell.

Jika `npm install` mengalami `Cannot read properties of null (reading 'edgesOut')` dengan npm 10.9.3, update npm ke 11.21.1, buka ulang PowerShell, hapus `node_modules` dan `package-lock.json` bila ada, lalu ulangi `npm install`.

Tanpa Supabase, halaman preview dapat menampilkan katalog referensi dan evaluator, tetapi data register/import/persistence tidak disimpan. Untuk pemakaian operasional, sambungkan Supabase lokal.

## 2. Menyiapkan Supabase lokal

Jalankan Docker Desktop dan Supabase CLI:

```powershell
npx supabase start
npx supabase db reset
```

Atur `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=ISI_DENGAN_LOCAL_PUBLISHABLE_ATAU_ANON_KEY
MAX_IMPORT_FILE_MB=20
```

Buat user lewat Supabase Auth. User baru memiliki role `viewer`. Admin yang berwenang dapat mengubah role awal melalui SQL Editor:

```sql
update public.profiles set role = 'admin' where email = 'email-admin-anda@example.com';
```

Jangan pernah meletakkan service-role key di `NEXT_PUBLIC_*` atau source code.

## 3. Alur kerja harian internal

1. Buka **Judgement Register**. Cari part number, supplier code, source code atau Error Type.
2. Buka record untuk mengisi AO–AW: Assigned person, starting date, Judgment procedure, Judge, komentar OK, komentar NG, KM Judge, KM Comment dan Last Change Date.
3. Jika ada kasus berulang, gunakan saran prosedur dari histori yang sejenis. Verifikasi kembali bukti dan rule yang berlaku.
4. Untuk record dengan Error Type yang sama, pilih beberapa baris dan gunakan **Bulk preparation** untuk mengisi Assigned person, starting date atau Judgment procedure. Bulk action tidak mengubah Judge atau KM Judge.
5. Buka **Evidence & Tasks** dari record untuk menugaskan pengecekan Drawing, SMS-BR, New SMS/destination, supplier confirmation atau eskalasi TMA/TMC, kemudian lampirkan sumber dan halaman/barisnya.
6. KM Judge dan KM Comment hanya dapat diubah role reviewer/admin (alur review TMA).

## 4. Import update harian G-CATS

1. Buka **Daily G-CATS Update**.
2. Drag-and-drop file Excel Error Check Log terbaru.
3. Pilih klasifikasi dokumen; CONFIDENTIAL dan UNKNOWN diblokir.
4. Periksa nama sheet, header row, deteksi 9 field AO–AW, jumlah data, Error Type distribution, baris warning, serta jumlah record baru/refresh/snapshot sama.
5. Commit setelah preview disetujui.

Importer memakai `code` sebagai identity jika ada. Kolom `No.` adalah urutan harian dan tidak dipakai sebagai ID. Baris tanpa `code` memakai fallback konservatif berbasis file hash + sheet + row; jika baris berpindah di file berikutnya, aplikasi lebih memilih membuat observasi baru daripada menggabungkan dua record secara keliru.

Setiap upload disimpan sebagai snapshot. Record yang tidak muncul di file baru tidak dihapus. Field yang sudah diubah di website dilindungi dengan override per field. Database website adalah register yang diedit; Excel export adalah salinan laporan yang read-only, bukan write-back ke file lokal.

Opsional: **Connect local / OneDrive file** dapat mendeteksi perubahan file yang dapat diakses browser selama tab tetap terbuka dan permission aktif. Ini bukan background sync. File yang berubah tetap harus di-preview dan di-commit manual.

## 5. Supplier pre-check

Supplier dapat memasukkan data manual atau drag-and-drop XLSX/CSV. Aplikasi mencoba mengenali header umum untuk Supplier Code, Part Number, IMDS ID/Version, MDS Status, dan Preliminary MDS. Nilai hasil ekstraksi masuk ke form yang masih dapat diedit; supplier harus memeriksanya sebelum submit.

File MDS Report PDF contoh secara eksplisit menyatakan parsing tidak diperbolehkan. Karena itu PDF hanya boleh dilampirkan untuk pemeriksaan manual, bukan diekstrak otomatis. Nilai “Internally released” yang dimasukkan supplier adalah pernyataan sendiri, bukan bukti. Reviewer internal harus mengecek MDS asli di IMDS. Hanya reviewer/admin yang dapat memberikan `CLEARED_FOR_IMDS` setelah konfirmasi manusia.

## 6. Supplier follow-up dan Outlook

Petugas internal memilih Supplier PIC dari contact directory. Tombol **Notify supplier & draft Outlook** membuat notifikasi di portal supplier dan membuka Outlook compose yang sudah terisi. Email masih berupa draft; aplikasi tidak mengirim otomatis atau mengklaim pesan sudah terkirim. Pengiriman otomatis melalui Microsoft Graph belum diimplementasikan dan memerlukan persetujuan IT/tenant.

## 7. Batasan judgement yang penting

- 19 historical label pada workbook bukan katalog resmi 23 Error Types. Label asli dipertahankan.
- Numeric Error Type 19 tetap HOLD karena konflik sumber Version 6 antara Section II dan Appendix I.
- Battery (Pb), Battery (Cd), Tokusetsu Part number dan SCCP tetap historical-only sampai mapping disetujui process owner.
- TSZ2900 tolerance masih reference-only sampai TSZ2900G Rev.9 terkendali diverifikasi.
- Mass deviation Type 8 belum otomatis dihitung karena basis denominator/rounding perlu disetujui.
- Aturan substance-specific membutuhkan CAS, GADSL/TSZ, flow keluarga bahan, destination dan konteks penggunaan.
- Website tidak melakukan SEND ke G-CATS atau update status ACCEPTED/REJECTED.

## 8. Deployment

Vercel dapat digunakan untuk deployment personal awal setelah Supabase dikonfigurasi. Repository sebaiknya private. Docker disediakan untuk migrasi self-host berikutnya; database, Auth dan Storage tetap harus disediakan terpisah.

## 9. Status validasi

Syntax transpile TypeScript/TSX dan validasi JSON dilakukan saat penyusunan paket. Dependency install dari registry tidak berhasil di lingkungan build, sehingga full `typecheck`, test, lint, Playwright E2E dan `next build` belum dinyatakan lulus. Delapan migration sudah diterapkan ke project Supabase khusus; deployment Vercel, tes import melalui app, full build/typecheck/E2E belum lulus.

## Deployment khusus dan edit dengan Claude

Status deployment, URL Supabase khusus, migrasi yang sudah aktif, cara menyiapkan Vercel/GitHub Private, membuat akun admin, serta alur edit dengan Claude Code ada di `docs/DEPLOYMENT_AND_CLAUDE_GUIDE_ID.md`. Ikuti status tes di dokumen itu: aplikasi belum boleh dianggap Production-ready sebelum dependency, build, typecheck, E2E dan import workbook aktual lulus.
