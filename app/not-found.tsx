import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return <section className="state-page">
    <span className="state-icon" aria-hidden="true"><Compass size={22}/></span>
    <h1>Page not found</h1>
    <p>This address does not exist in the IMDS / G-CATS Control Center. Press <kbd>Ctrl</kbd> <kbd>K</kbd> to jump to any module or search a part number.</p>
    <div className="state-actions"><Link className="btn btn-primary" href="/judgement">Judgement register</Link><Link className="btn" href="/workspace">All workspaces</Link></div>
  </section>;
}
