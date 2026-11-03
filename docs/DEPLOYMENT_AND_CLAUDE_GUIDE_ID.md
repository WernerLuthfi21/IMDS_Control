# Deployment dan workflow Claude Code — Toyota IMDS / G-CATS

Status dokumen: 3 November 2026. Deployment masih **PREVIEW / BELUM PRODUCTION** sampai build, typecheck, tes import file aktual dan tes E2E dinyatakan lulus.

## 1. Infrastruktur yang sudah dibuat

- Supabase khusus: `toyota-imds-gcats-control`
- Project ref: `thjntzkidfsydaiiwbyn`
- Region: `ap-southeast-1`
- URL: `https://thjntzkidfsydaiiwbyn.supabase.co`
- Status project saat verifikasi: `ACTIVE_HEALTHY`
- Biaya proyek baru saat dibuat: US$0/bulan (sesuai quotation yang tampil ketika pembuatan).
- Migrasi database yang sudah diterapkan dan diverifikasi: 8 migrasi.
- Proyek Supabase lama `BulletinMETP` dan `WernerLuthfi21's Project` tidak disentuh.

### Environment lokal / Vercel

Isi Environment Variables berikut untuk Development, Preview dan Production:

```env
NEXT_PUBLIC_APP_NAME="IMDS Intelligence Control Center"
NEXT_PUBLIC_SUPABASE_URL="https://thjntzkidfsydaiiwbyn.supabase.co"
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_publishable_4m8LK3BKPiPDy8UUYZcbDw_zOI56f-M"
MAX_IMPORT_FILE_MB="20"
```

Publishable key memang dirancang untuk aplikasi browser dan bukan pengganti service-role key. **Jangan** menaruh Supabase secret/service-role key, Microsoft client secret, access token, refresh token, atau password dalam source code, file `.env.example`, Git, prompt Claude, atau browser bundle.

## 2. Migrasi — jangan jalankan ulang secara buta

Delapan migrasi sudah diterapkan langsung ke project khusus. File di `supabase/migrations/` telah dinamai ulang agar prefix versinya sama dengan versi yang tercatat di remote:

| Versi remote | Migrasi |
|---|---|
| 20261103032048 | initial_schema |
| 20261103032119 | judgement_register_supplier_workflows |
| 20261103032155 | source_status_overrides_and_precheck_import |
| 20261103032157 | precheck_internal_review |
| 20261103032159 | supplier_pdf_storage |
| 20261103032202 | bulk_preparation_rpc |
| 20261103032218 | authenticated_data_api_grants |
| 20261103032731 | harden_role_helpers |

Setelah menghubungkan CLI lokal, jalankan `npx supabase migration list --linked` terlebih dahulu dan cocokkan daftar remote/local. Jangan jalankan `db push` bila daftar versinya tidak cocok; jangan reset database remote. Seluruh tabel aplikasi memakai RLS; Data API memberi grant ke `authenticated`, bukan `anon`.

## 3. Buat akun awal dan jadikan admin

1. Buka Supabase Dashboard → project `toyota-imds-gcats-control` → Authentication → Users.
2. Tambahkan akun email kerja yang akan dipakai masuk aplikasi. Pastikan email dikonfirmasi sesuai kebijakan tenant.
3. Buka SQL Editor dan jalankan query berikut dengan email akun sendiri:

```sql
update public.profiles p
set role = 'admin'
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('EMAIL_KERJA_ANDA');
```

4. Verifikasi:

```sql
select u.email, p.role
from auth.users u
join public.profiles p on p.id = u.id
where lower(u.email) = lower('EMAIL_KERJA_ANDA');
```

5. Login ke aplikasi memakai email dan password tersebut. User baru otomatis dibuat sebagai `viewer`; promosi ke admin dilakukan manual oleh pemilik database. Jangan membuat registrasi publik bebas untuk sistem yang menyimpan data operasional.

## 4. Deploy ke Vercel

### Persiapan satu kali

1. Simpan source ZIP ini sebagai repository GitHub **Private**. Jangan memasukkan workbook Toyota, export G-CATS harian, dokumen supplier, file `.env.local`, password atau data CONFIDENTIAL ke Git.
2. Extract ZIP, lalu dari PowerShell pada folder project jalankan:

```powershell
git init -b main
git add .
git commit -m "Initial private IMDS G-CATS app"
git remote add origin https://github.com/USERNAME/toyota-imds-gcats-control.git
git push -u origin main
```

Buat repository Private kosong di GitHub terlebih dahulu. Perintah di atas mengasumsikan Git sudah terpasang dan autentikasi GitHub telah selesai.

3. Buka Vercel → Add New → Project → Import Git Repository → pilih repo private tadi.
4. Framework: Next.js; Root Directory: `./`; Node.js: `22.x`; Build Command: `npm run build`.
5. Tambahkan environment variables di atas pada ketiga target (Production, Preview, Development).
6. Deploy Preview terlebih dahulu. Jangan promosikan ke Production sebelum lint, typecheck, unit test, build, E2E dan tes import data lulus.

### Akses team Vercel

Koneksi Vercel saat paket disiapkan meminta persetujuan akses team. Buka tautan persetujuan yang disediakan di chat, periksa scope izin lalu approve. Tautan sekali pakai berlaku 10 menit. Setelah akses diberikan, project Vercel dapat dibuat/di-link dalam team tersebut. Jika tautan kedaluwarsa, minta tautan baru.

## 5. Supaya bisa mengedit dengan Claude setelah deploy

Deployment tidak membuat source code bisa diedit langsung dari website. **GitHub Private adalah sumber kode; Vercel membangun ulang dari commit Git; Supabase menyimpan data aplikasi.** Alur aman yang disarankan:

1. Clone repo private ke PC kerja:

```powershell
git clone https://github.com/USERNAME/toyota-imds-gcats-control.git
cd toyota-imds-gcats-control
```

2. Pasang Node.js 22 dan npm yang sesuai dengan `package.json`. Untuk Windows, instal Claude Code melalui WinGet (`winget install Anthropic.ClaudeCode`) atau installer resmi, bukan menambahkan Claude ke deployment Vercel. Lalu install dependency project:

```powershell
node -v
npm -v
npm install
Copy-Item .env.example .env.local
```

3. Isi `.env.local` memakai nilai Development di atas. File ini sudah diabaikan oleh `.gitignore`; jangan pernah commit.
4. Jalankan `npm run dev` untuk aplikasi lokal. Verifikasi Claude Code dengan `claude --version` dan `claude doctor`; buka terminal di folder repo dan jalankan `claude` (atau buka folder yang sama melalui integrasi Claude Code di IDE). File `.claude/settings.json` sudah menolak pembacaan `.env*`, workbook Excel, PDF dan DOCX melalui tool file Claude. Tetap jangan simpan raw source files di repository; aturan permission bukan pengganti kontrol OS/repository.
5. Berikan instruksi pada Claude untuk mengubah file tertentu, mempertahankan aturan di `CLAUDE.md`, menambah tes, dan tidak mengubah database produksi tanpa migration SQL.
6. Setelah perubahan:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

7. Buat branch untuk perubahan besar, push, dan buat Pull Request. Vercel akan membuat Preview dari branch/PR. Cek Preview, lalu merge ke `main` setelah pemeriksaan. Push ke branch production (`main`) akan memicu deployment production jika Git Integration sudah tersambung.

Gunakan prompt Claude yang spesifik, misalnya:

> Baca CLAUDE.md, docs/SECURITY.md dan docs/SOURCE_REGISTER.md. Perbaiki [fitur]. Jangan mengakses file CONFIDENTIAL atau secret environment. Pertahankan source row, source hash, original judgement labels dan manual override. Tambah unit/E2E test. Jangan mengklaim integrasi GXATS/MD SYSTEM, Outlook Graph, atau SharePoint tersedia kecuali implementasinya benar-benar ada dan telah dites. Jalankan lint, typecheck, test dan build; laporkan kegagalan sebenarnya.

## 6. Status pengujian yang benar saat ini

| Item | Status | Penjelasan |
|---|---|---|
| Supabase khusus | **DONE** | Project ACTIVE_HEALTHY dibuat di ap-southeast-1. |
| 7 migrasi database | **DONE** | Semua delapan nama/versi tampil di `list_migrations`; fungsi import/approval/bulk memiliki EXECUTE untuk authenticated dan bukan anon. |
| RLS | **APPLIED / REVIEW** | RLS aktif pada 21/21 tabel public. Advisor tidak lagi melaporkan mutable search_path atau helper SECURITY DEFINER untuk `current_app_role` / `has_any_role`. Dua RPC SECURITY DEFINER (`commit_import_batch` dan `approve_judgement`) masih sengaja dipakai oleh aplikasi dan dibatasi dengan pemeriksaan role, kepemilikan batch / status rule, serta persetujuan manusia. Advisor tetap memberi warning pada dua RPC itu; perlu security review dan uji role terpisah sebelum Production. Advisor performance juga melaporkan beberapa multiple permissive policies / auth_rls_initplan yang perlu dirapikan. |
| Import Master Data asli | **NOT VERIFIED** | Workbook 4 MB telah disediakan, tetapi pemeriksaan `artifact_tool` berhenti saat mengambil metadata/range. Parser mengarah ke sheet `G-CATS Error Log Master Data`; belum ada hasil preview/commit dari server. |
| Import daily G-CATS asli | **BLOCKED** | File export harian terpisah belum teridentifikasi di folder paket; belum ada preview/commit dengan file aktual harian. |
| Full build / typecheck / E2E | **NOT PASSED** | `npm install` tidak selesai karena akses registry npm time-out di lingkungan build; `node` lokal 22.16.0 tetapi npm 10.9.2, sedangkan `package.json` menyatakan npm >=11.21.1. Jangan sebut aplikasi lulus build. |
| Outlook Graph send | **NOT IMPLEMENTED / NOT AUTHORIZED** | Saat ini hanya membuka Outlook draft. Memerlukan Entra ID app registration, consent tenant, token flow dan backend send endpoint. |
| Excel / SharePoint write-back | **NOT IMPLEMENTED / NOT AUTHORIZED** | Export saat ini hanya salinan laporan. Perlu Graph OAuth, pemilihan site/drive/item/workbook, strategi conflict/locking dan uji PATCH pada range yang disetujui. |
| GXATS / MD SYSTEM live sync | **NOT AVAILABLE** | Tidak ada API, dokumentasi teknis atau credential resmi yang diberikan; tidak boleh mengarang endpoint atau mensimulasikan sinkronisasi sebagai fakta. |

### Data test yang masih dibutuhkan

- Workbook `Master Data All IMDS Project_new.xlsx` untuk test import preview dan commit.
- Satu file export **daily G-CATS `.xlsx` yang sesungguhnya** untuk test snapshot kedua, update, duplicate detection dan manual override preservation.
- Jangan upload/masukkan data CONFIDENTIAL. PROTECTED hanya diproses sesuai otorisasi pemiliknya. `MDSReport_73230-0KN60-A.pdf` tetap tidak diparse karena dokumen contohnya secara eksplisit melarang parsing.

## 7. Outlook Graph dan Excel/SharePoint — persetujuan Microsoft

Integrasi di aplikasi masih perlu dikembangkan. Persiapan yang diperlukan dari Microsoft 365 / Entra admin:

- Entra ID App Registration untuk web application, single-tenant jika hanya tenant Toyota/organisasi sendiri.
- Redirect URI: `https://<domain-vercel>/api/auth/microsoft/callback` dan URI localhost development yang dipakai implementasi.
- Email sending atas user yang login: delegated permission `Mail.Send`. Bila memakai shared mailbox, konfirmasi kebijakan Exchange dan delegated send-as/on-behalf permissions.
- Excel workbook update melalui Microsoft Graph: delegated permission minimum endpoint Excel range update adalah `Files.ReadWrite`; endpoint workbook range update tidak mendukung application permission. Jadi write-back berjalan atas sesi user Microsoft yang login, bukan background daemon tanpa user. Workbook harus berada di OneDrive/SharePoint dan account yang login harus punya akses edit. Administrator tenant mungkin tetap harus menyetujui user consent sesuai policy.
- Simpan tenant id, client id dan client secret/certificate sebagai environment variables server-side terenkripsi di Vercel. Client secret tidak diletakkan dalam `NEXT_PUBLIC_*`.
- Implementasi harus meminta persetujuan sebelum mengirim email atau mengubah workbook, mencatat audit log, menggunakan idempotency/concurrency check, dan membuat preview/diff serta backup/versioning sebelum write-back.

Referensi teknis:
- Claude Code installation and setup: https://docs.anthropic.com/en/docs/claude-code/getting-started
- Claude Code permissions / secret file denial: https://support.claude.com/en/articles/14554922-claude-code-user-faq
- Microsoft Graph sendMail: https://learn.microsoft.com/graph/api/user-sendmail
- Microsoft Graph Excel range update: https://learn.microsoft.com/graph/api/range-update
- Microsoft Graph permission reference: https://learn.microsoft.com/graph/permissions-reference
- Vercel Git deployment: https://vercel.com/docs/git
- Claude Code setup: https://docs.anthropic.com/en/docs/claude-code/getting-started

## 8. Larangan data dan batas sinkronisasi

- Jangan commit workbook, source PDF, supplier attachments, export G-CATS, database dumps, `.env.local`, secrets, authentication state atau data produksi ke repository.
- CONFIDENTIAL: jangan dibaca, diekstrak, diindeks, diupload, disimpan, diringkas, dikutip atau dipakai sebagai knowledge source.
- PROTECTED: boleh diolah sesuai izin pemilik, tetapi batasi ke private app/repository dan user berwenang.
- UNKNOWN: blokir sampai klasifikasi dipastikan.
- Jangan mengaktifkan GXATS/MD SYSTEM sinkronisasi otomatis tanpa kontrak API dan izin tertulis; jangan menggunakan browser automation untuk mengakali akses sistem tersebut.
