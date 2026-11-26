import { WhatsAppAutomation } from "@/components/whatsapp-automation";

export default function WhatsAppPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SUPPLIER / COMMUNICATION</div>
          <h1 className="page-title">WhatsApp Automation</h1>
          <p className="page-subtitle">
            Manage approved WhatsApp senders, supplier consent, and automatic or approval-based campaigns.
          </p>
        </div>
        <span className="quiet-badge">WHATSAPP CLOUD API</span>
      </div>
      <WhatsAppAutomation />
    </>
  );
}
