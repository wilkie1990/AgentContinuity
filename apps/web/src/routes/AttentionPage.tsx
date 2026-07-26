import { NeedsAttentionPanel } from "../components/NeedsAttentionPanel.js";

export function AttentionPage() {
  return (
    <div className="page stack">
      <div>
        <h1>Needs Attention</h1>
        <p className="muted small">Work that needs a human decision, review, or a clean agent handoff.</p>
      </div>
      <NeedsAttentionPanel />
    </div>
  );
}
