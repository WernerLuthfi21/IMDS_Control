import { BUILTIN_BUYERS, type Directory } from "@/lib/followup/directory";

export type TrackerDirectoryData = Directory & {
  meta?: Record<string, unknown>;
};

const people = {
  pic1: "IMDS PIC 1",
  pic2: "IMDS PIC 2",
  pic3: "IMDS PIC 3",
  staff: "Marketing staff (PIC to TMMIN)",
  spv: "Marketing supervisor",
  dph: "Department head",
  gm: "General manager",
  md: "Marketing director",
  vp: "Vice president director",
  pd: "President director",
};
const labels = {
  name: "Name",
  position: "Position",
  email: "Email",
  phone: "Phone",
};

export function directoryExportRows(data: TrackerDirectoryData) {
  const columns = Object.entries(people).flatMap(([person, label]) =>
    Object.entries(labels)
      .filter(([field]) => field !== "position" || person.startsWith("pic"))
      .map(([field, title]) => ({
        key: person + "_" + field,
        title: label + " – " + title,
      })),
  );
  const header = [
    "Supplier",
    "Vendor code",
    "PUD buyer",
    ...columns.map((column) => column.title),
    "Additional emails",
    "WhatsApp added",
    "WhatsApp members",
  ];
  const rows = Object.values(data.entries ?? {})
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const fields = entry.f ?? {};
      const buyer = fields.buyer || "";
      return [
        entry.name,
        entry.code,
        data.buyers?.[buyer]?.full || BUILTIN_BUYERS[buyer]?.full || buyer,
        ...columns.map((column) => fields[column.key] || ""),
        fields.pic_extra || "",
        fields.wa_added ? "Yes" : "",
        fields.wa_members || "",
      ];
    });
  return [header, ...rows];
}

export async function downloadDirectory(
  data: TrackerDirectoryData,
  format: "xlsx" | "json",
) {
  const at = new Date().toISOString();
  let blob: Blob;
  if (format === "xlsx") {
    const { Workbook } = await import("exceljs");
    const book = new Workbook();
    book.addWorksheet("Directory").addRows(directoryExportRows(data));
    blob = new Blob([await book.xlsx.writeBuffer()], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  } else {
    const backup = {
      app: "imds-tracker-directory",
      v: 1,
      at,
      entries: data.entries ?? {},
      buyers: data.buyers ?? {},
      aliases: data.aliases ?? {},
      meta: data.meta ?? {},
    };
    blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  }
  const filename =
    "IMDS_Directory_" +
    (format === "json" ? "backup_" : "") +
    at.slice(0, 10) +
    "." +
    format;
  const host = window as Window & {
    claude?: {
      use: (
        name: "downloads",
      ) => Promise<{
        save: (file: { filename: string; data: Blob }) => Promise<void>;
      }>;
    };
  };
  const downloads = await host.claude?.use("downloads").catch(() => null);
  if (downloads) return downloads.save({ filename, data: blob });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
