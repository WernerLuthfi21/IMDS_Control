import { ImportWorkbook } from "@/components/import-workbook";
import { FileSpreadsheet } from "lucide-react";
export default function ImportsPage(){return <><div className="page-heading"><div><div className="eyebrow">DATA GOVERNANCE / INGESTION</div><h1 className="page-title">Data Import</h1><div className="page-subtitle">Stage, validate and commit Excel source workbooks with full row provenance.</div></div><span className="status status-blue"><FileSpreadsheet size={12}/> XLSX INGESTION</span></div><ImportWorkbook/></>}
