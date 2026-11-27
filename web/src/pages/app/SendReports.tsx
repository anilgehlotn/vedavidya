// Send Reports: email each student's report card PDF to the parent (built in the Send Reports step).
import { Modal } from "../../components/ui";

export function SendReportsModal({ onClose }: { test: { id: string; title: string }; onClose: () => void }) {
  return <Modal title="Send reports" onClose={onClose}><p className="muted">Coming next.</p></Modal>;
}
