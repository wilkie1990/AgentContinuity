import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

type MarkdownContextEditorProps = {
  value: string;
  savedValue: string;
  textareaLabel: string;
  emptyMessage: string;
  placeholder?: string;
  size?: "page" | "section";
  isSaving?: boolean;
  onChange: (value: string) => void;
  onSave: (value: string) => Promise<unknown>;
};

/**
 * Shared read-first context surface. Markdown is rendered through
 * react-markdown without rehypeRaw, so context-authored HTML is never
 * mounted as executable DOM.
 */
export function MarkdownContextEditor({
  value,
  savedValue,
  textareaLabel,
  emptyMessage,
  placeholder,
  size = "section",
  isSaving = false,
  onChange,
  onSave,
}: MarkdownContextEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const contentId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const restoreEditFocus = useRef(false);
  const dirty = value !== savedValue;

  useEffect(() => {
    if (isEditing) {
      textareaRef.current?.focus();
    } else if (restoreEditFocus.current) {
      restoreEditFocus.current = false;
      editButtonRef.current?.focus();
    }
  }, [isEditing]);

  const cancel = () => {
    onChange(savedValue);
    restoreEditFocus.current = true;
    setIsEditing(false);
  };

  const save = async () => {
    if (!dirty || isSaving) return;

    try {
      await onSave(value);
      restoreEditFocus.current = true;
      setIsEditing(false);
    } catch {
      // The owning mutation renders its error. Keep the draft open so the
      // person can retry without losing any text.
    }
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    }
  };

  return (
    <div className={`context-editor context-editor--${size}`}>
      {isEditing ? (
        <div className="context-edit-form">
          <textarea
            id={contentId}
            ref={textareaRef}
            aria-label={textareaLabel}
            className="context-textarea"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleEditorKeyDown}
            placeholder={placeholder}
          />
          <div className="context-edit-footer">
            <span className="small muted">
              {value.length} characters · Esc to cancel · ⌘/Ctrl+Enter to save
            </span>
            <div className="context-actions">
              <button type="button" onClick={cancel} disabled={isSaving}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void save()}
                disabled={!dirty || isSaving}
              >
                {isSaving ? "Saving…" : "Save context"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="context-read-actions">
            <button
              ref={editButtonRef}
              type="button"
              className="subtle"
              aria-expanded={false}
              aria-controls={contentId}
              onClick={() => setIsEditing(true)}
            >
              Edit context
            </button>
          </div>
          {value.trim() ? (
            <div
              id={contentId}
              className="context-document"
              role="region"
              aria-label={`${textareaLabel} preview`}
            >
              <Markdown skipHtml remarkPlugins={[remarkGfm, remarkBreaks]}>
                {value}
              </Markdown>
            </div>
          ) : (
            <div id={contentId} className="context-empty">
              <p>{emptyMessage}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
