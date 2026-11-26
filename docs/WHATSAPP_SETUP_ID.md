# WhatsApp Cloud API — setup IMDS Control Center

Modul ini menambahkan WhatsApp sebagai channel komunikasi terpisah. Supplier Directory, autentikasi, email Power Automate, dan sync_outbox tetap digunakan seperti sebelumnya; antrean WhatsApp berada di whatsapp_messages.

## 1. Persiapan Meta

1. Buat atau pilih aplikasi di [Meta for Developers](https://developers.facebook.com/).
2. Tambahkan produk WhatsApp dan hubungkan WhatsApp Business Account (WABA).
3. Daftarkan setiap nomor pengirim yang akan digunakan. Setiap nomor harus memiliki **Phone Number ID** dan WABA yang terkait.
4. Buat template pesan di WhatsApp Manager. Tunggu sampai status template **APPROVED**.
5. Pastikan bisnis hanya mengirim pesan kepada penerima yang memberikan izin WhatsApp yang sesuai. Pesan business-initiated dikirim menggunakan template yang disetujui Meta.

Referensi resmi: [WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview/).

## 2. Environment variables di Vercel

Tambahkan variabel berikut pada Project → Settings → Environment Variables. Semua variabel ini server-only; jangan beri prefix NEXT_PUBLIC_.

**WHATSAPP_GRAPH_API_VERSION** — opsional, default kode saat ini v27.0.

**WHATSAPP_SENDERS_JSON** — array konfigurasi nomor yang diperbolehkan dipilih pada campaign. Contoh format (ganti semua nilai contoh):

~~~json
[
  {
    "key": "imds-main",
    "label": "IMDS Main",
    "displayPhoneNumber": "+62 812-0000-0000",
    "phoneNumberId": "123456789012345",
    "wabaId": "123456789012345",
    "accessToken": "META_SYSTEM_USER_ACCESS_TOKEN"
  },
  {
    "key": "imds-backup",
    "label": "IMDS Backup",
    "displayPhoneNumber": "+62 813-0000-0000",
    "phoneNumberId": "234567890123456",
    "wabaId": "123456789012345",
    "accessToken": "META_SYSTEM_USER_ACCESS_TOKEN"
  }
]
~~~

Setiap sender dapat memakai token yang sama jika token System User tersebut memiliki permission whatsapp_business_messaging dan akses ke semua nomor/WABA terkait. Jika sender berada di WABA berbeda, masukkan token yang memiliki akses ke sender tersebut. Menambahkan sender dilakukan dengan menambah entry JSON dan redeploy; token tidak disimpan di database dan tidak pernah dikirim ke browser.

**WHATSAPP_APP_SECRET** — App Secret aplikasi Meta, untuk verifikasi signature webhook.

**WHATSAPP_VERIFY_TOKEN** — string rahasia buatan sendiri untuk verifikasi GET webhook.

**WHATSAPP_CRON_SECRET** — string acak panjang untuk mengamankan worker terjadwal.

Pastikan SUPABASE_SERVICE_ROLE_KEY yang sudah digunakan oleh aplikasi tersedia di Vercel. Worker cron menggunakannya hanya di route server /api/cron/whatsapp; key tidak pernah dikirim ke browser.

## 3. Terapkan migration

Jalankan migration supabase/migrations/20261126170000_whatsapp_cloud_automation.sql ke project Supabase yang dipakai IMDS Control Center setelah memeriksa target project dan backup. Migration ini hanya menambah kolom WhatsApp di supplier_contacts dan tabel whatsapp_campaigns serta whatsapp_messages. Tidak ada tabel atau row email yang dihapus/diubah.

## 4. Webhook Meta

Atur Callback URL:

https://imds-gcats-control.vercel.app/api/whatsapp/webhook

Verify Token harus sama persis dengan WHATSAPP_VERIFY_TOKEN. Subscribe aplikasi ke field webhook WhatsApp messages agar status sent, delivered, read, dan failed memperbarui riwayat campaign.

Endpoint GET memvalidasi hub challenge. Endpoint POST memvalidasi X-Hub-Signature-256 memakai WHATSAPP_APP_SECRET sebelum menyimpan status.

## 5. Worker antrean otomatis

Campaign otomatis memproses batch pertama saat dibuat. Setiap batch worker dibatasi hingga 6 pesan dan timeout panggilan Meta 8 detik agar tetap sesuai batas durasi fungsi Vercel. Campaign berikutnya diproses oleh endpoint:

POST https://imds-gcats-control.vercel.app/api/cron/whatsapp

Endpoint ini membutuhkan header Authorization: Bearer <WHATSAPP_CRON_SECRET>. Untuk proses berkelanjutan, jadwalkan pemanggilan setiap menit memakai Supabase Cron + pg_net. Simpan URL dan secret di Supabase Vault; jangan hardcode secret ke migration atau SQL history.

Contoh SQL dijalankan oleh admin database setelah mengaktifkan extension pg_cron, pg_net, dan Vault:

~~~sql
select vault.create_secret(
  'https://imds-gcats-control.vercel.app/api/cron/whatsapp',
  'imds_whatsapp_worker_url'
);

select vault.create_secret(
  'PASTE_THE_SAME_WHATSAPP_CRON_SECRET_FROM_VERCEL',
  'imds_whatsapp_cron_secret'
);

select cron.schedule(
  'imds-whatsapp-queue-worker',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'imds_whatsapp_worker_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'imds_whatsapp_cron_secret')
    ),
    body := '{"limit":6}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;
  $$
);
~~~

Simpan URL/secret di Vault seperti contoh di dokumentasi Supabase. Untuk mengubah atau menghapus jadwal, kelola job bernama imds-whatsapp-queue-worker di Supabase → Integrations → Cron.

## 6. Mengisi nomor dan consent supplier

Buka menu **WhatsApp Automation → Supplier WhatsApp contacts**. Untuk setiap contact yang benar-benar memberikan consent:

1. Isi nomor dalam format E.164, misalnya +628123456789.
2. Centang **Opted in** hanya setelah consent dapat dibuktikan.
3. Klik Save.

Kontak tanpa nomor valid atau tanpa whatsapp_opt_in = true tidak akan masuk ke recipient campaign. Menghapus centang akan mengecualikan contact dari campaign berikutnya. Simpan bukti consent sesuai kebijakan organisasi di sistem sumber yang disetujui.

## 7. Campaign modes

- **Automatic**: campaign masuk antrean PENDING; sistem memproses batch pertama saat campaign dibuat, kemudian worker terjadwal melanjutkan.
- **Semi-automatic**: campaign berstatus AWAITING_APPROVAL; tidak ada pesan yang dikirim sebelum admin/preparer menekan **Approve & send**.
- **Retry failed**: hanya pesan gagal dengan maksimum 3 attempt yang dapat dimasukkan kembali ke antrean.

UI menampilkan SENT sebagai pesan diterima API Meta, bukan bukti pesan sudah masuk ke perangkat. Status delivery yang sesungguhnya datang dari webhook Meta (DELIVERED, READ, atau FAILED).

## 8. Uji sebelum produksi

1. Konfigurasikan satu nomor sandbox/test atau sender yang disetujui.
2. Gunakan template hello_world atau template utilitas yang sudah approved.
3. Tambahkan satu nomor uji milik penerima yang secara eksplisit menyetujui pengujian.
4. Uji mode semi-automatic, pastikan campaign diam sebelum approval, lalu approve.
5. Pastikan message ID dari Meta tersimpan dan webhook mengubah status menjadi DELIVERED/READ.
6. Uji opt-out dengan menghapus centang consent; kontak harus tidak masuk campaign baru. Pesan masuk berisi STOP, UNSUBSCRIBE, BERHENTI, STOP WA atau HAPUS SAYA juga otomatis menonaktifkan consent dan membatalkan antrean yang belum dikirim.
7. Baru jalankan campaign yang lebih besar. Periksa kategori biaya, messaging limit WABA, template, opt-in, dan rate limit sebelum mengirim.

Jangan menguji dengan data CONFIDENTIAL/UNKNOWN atau mengunggah data internal yang tidak diizinkan ke layanan eksternal. Untuk IMDS Control Center, pastikan data kontak dan isi pesan telah disetujui pemilik data sebelum diproses melalui Meta.
