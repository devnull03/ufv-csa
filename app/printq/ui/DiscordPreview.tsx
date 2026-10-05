"use client";

import { Hash, Lock, MessageSquare, Pin, Send, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useState, type ReactNode } from "react";
import { toast } from "sonner";

// Demo mode: a working stand-in for the Discord channels. Every button, select
// menu, form and slash command goes through /api/printq/demo/discord, which
// runs the real interaction handler.

interface Embed {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
}
interface Component {
  type: number;
  style?: number;
  label?: string;
  emoji?: { name?: string };
  custom_id?: string;
  url?: string;
  disabled?: boolean;
  placeholder?: string;
  options?: { label: string; value: string; description?: string }[];
  components?: Component[];
}
interface Payload {
  content?: string;
  embeds?: Embed[];
  components?: Component[];
}
interface ModalData {
  custom_id: string;
  title: string;
  components: { components: { custom_id: string; label: string; style: number; placeholder?: string; value?: string; required?: boolean; max_length?: number }[] }[];
}

export interface StoredMessage {
  id: string;
  kind: "card" | "board" | "public_board";
  payload: Payload;
  logs: string[];
}
export interface DirectMessage {
  id: number;
  to: string;
  title: string;
  body: string;
  components: Component[] | null;
}

type Source = { messageId?: string; notificationId?: number; transient?: { embeds: Embed[]; components: Component[] } };
type InteractionResult = { type: number; data?: Payload & ModalData & { flags?: number } };

// --- Minimal Discord markdown: **bold**, *italic*, `code`, > quotes, line breaks ---

function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g);
  return parts.map((part, index) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(part)) return <code key={index} className="dc-code">{part.slice(1, -1)}</code>;
    if (/^\*[^*]+\*$/.test(part)) return <em key={index}>{part.slice(1, -1)}</em>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function Markdown({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, index) =>
        line.startsWith("> ") ? (
          <div key={index} className="dc-quote">
            {inline(line.slice(2))}
          </div>
        ) : (
          <div key={index} style={{ minHeight: line ? undefined : "0.6em" }}>
            {inline(line)}
          </div>
        )
      )}
    </>
  );
}

const BUTTON_CLASS: Record<number, string> = { 1: "dc-btn-primary", 2: "dc-btn-secondary", 3: "dc-btn-success", 4: "dc-btn-danger", 5: "dc-btn-secondary" };

function Message({
  payload,
  onComponent,
  busy,
}: {
  payload: Payload;
  onComponent: (component: Component, values?: string[]) => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {payload.content ? (
        <div className="dc-text">
          <Markdown text={payload.content} />
        </div>
      ) : null}
      {(payload.embeds ?? []).map((embed, index) => (
        <div key={index} className="dc-embed" style={{ borderLeftColor: `#${(embed.color ?? 0x4e5058).toString(16).padStart(6, "0")}` }}>
          {embed.title ? <div className="dc-embed-title">{embed.title}</div> : null}
          {embed.description ? (
            <div className="dc-text">
              <Markdown text={embed.description} />
            </div>
          ) : null}
          {embed.fields?.length ? (
            <div className="dc-fields">
              {embed.fields.map((field, fieldIndex) => (
                <div key={fieldIndex} className={field.inline ? "dc-field-inline" : "dc-field"}>
                  <div className="dc-field-name">{field.name}</div>
                  <div className="dc-text">
                    <Markdown text={field.value} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {embed.footer ? <div className="dc-footer">{embed.footer.text}</div> : null}
        </div>
      ))}
      {(payload.components ?? []).map((row, rowIndex) => (
        <div key={rowIndex} className="flex flex-wrap gap-2">
          {(row.components ?? []).map((component, index) =>
            component.type === 3 ? (
              <select
                key={index}
                className="dc-select"
                disabled={busy}
                value=""
                onChange={(event) => event.target.value && onComponent(component, [event.target.value])}
              >
                <option value="">{component.placeholder ?? "Choose…"}</option>
                {component.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                    {option.description ? ` · ${option.description}` : ""}
                  </option>
                ))}
              </select>
            ) : component.style === 5 ? (
              <a key={index} className="dc-btn dc-btn-secondary" href={component.url} target="_blank" rel="noreferrer">
                {component.label} ↗
              </a>
            ) : (
              <button
                key={index}
                type="button"
                className={`dc-btn ${BUTTON_CLASS[component.style ?? 2]}`}
                disabled={busy || component.disabled}
                onClick={() => onComponent(component)}
              >
                {component.emoji?.name ? <span aria-hidden>{component.emoji.name}</span> : null}
                {component.label}
              </button>
            )
          )}
        </div>
      ))}
    </div>
  );
}

function BotLine({ children, pinned, note }: { children: ReactNode; pinned?: boolean; note?: string }) {
  return (
    <div className="dc-message">
      <div className="dc-avatar" aria-hidden>
        PQ
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="dc-author">PrintQ</span>
          <span className="dc-badge">APP</span>
          {pinned ? (
            <span className="dc-meta inline-flex items-center gap-1">
              <Pin size={12} aria-hidden /> pinned
            </span>
          ) : null}
          {note ? <span className="dc-meta">{note}</span> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

export function DiscordPreview({ messages, dms, viewerName }: { messages: StoredMessage[]; dms: DirectMessage[]; viewerName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [ephemerals, setEphemerals] = useState<{ key: number; payload: Payload }[]>([]);
  const [modal, setModal] = useState<{ data: ModalData; source: Source } | null>(null);
  const [closeForm, setCloseForm] = useState({ when: "", reason: "", maintenance: false });

  async function send(body: object, source?: Source) {
    setBusy(true);
    try {
      const response = await fetch("/api/printq/demo/discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(source ? { ...body, source } : body),
      });
      if (!response.ok) throw new Error(String(response.status));
      const result = (await response.json()) as InteractionResult;
      if (result.type === 9 && result.data) setModal({ data: result.data as ModalData, source: source ?? {} });
      else if (result.type === 4 && result.data) {
        const payload = result.data;
        if (payload.flags === 64) setEphemerals((current) => [{ key: Date.now(), payload }, ...current].slice(0, 4));
        else toast.success(payload.content ?? "Posted");
      } else if (result.type === 7 && result.data?.content && !source?.transient) {
        toast.success(result.data.content.replace(/\*\*/g, ""));
      }
      // Updates to an ephemeral message are applied by the caller (it knows which one).
      router.refresh();
      return result;
    } catch {
      toast.error("That didn't work");
    } finally {
      setBusy(false);
    }
  }

  const clickOn = (source: Source) => (component: Component, values?: string[]) =>
    send({ kind: "component", customId: component.custom_id, values: values ?? [] }, source);

  async function clickEphemeral(key: number, payload: Payload, component: Component, values?: string[]) {
    const source: Source = { transient: { embeds: payload.embeds ?? [], components: payload.components ?? [] } };
    const result = await send({ kind: "component", customId: component.custom_id, values: values ?? [] }, source);
    if (result?.type === 7 && result.data) {
      const next = result.data;
      setEphemerals((current) => current.map((item) => (item.key === key ? { key, payload: next } : item)));
    }
  }

  const board = messages.find((message) => message.kind === "board");
  const publicBoard = messages.find((message) => message.kind === "public_board");
  const cards = messages.filter((message) => message.kind === "card");

  const commands: [string, string, string][] = [
    ["/printstaff pending", "printstaff", "pending"],
    ["/printstaff board", "printstaff", "board"],
    ["/print schedule", "print", "schedule"],
    ["/print mine", "print", "mine"],
  ];

  return (
    <div className="dc-root">
      <div className="dc-columns">
        <section className="dc-channel" aria-label="#printq-staff">
          <header className="dc-channel-head">
            <Lock size={15} aria-hidden />
            <Hash size={15} aria-hidden style={{ marginLeft: -6 }} />
            printq-staff
            <span className="dc-meta ml-auto">viewing as {viewerName}</span>
          </header>

          {ephemerals.map((item) => (
            <div key={item.key} className="dc-ephemeral">
              <div className="flex items-center gap-2">
                <span className="dc-meta">Only you can see this</span>
                <button
                  type="button"
                  className="dc-dismiss ml-auto"
                  aria-label="Dismiss"
                  onClick={() => setEphemerals((current) => current.filter((other) => other.key !== item.key))}
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
              <Message payload={item.payload} busy={busy} onComponent={(component, values) => clickEphemeral(item.key, item.payload, component, values)} />
            </div>
          ))}

          {board ? (
            <BotLine pinned>
              <Message payload={board.payload} busy={busy} onComponent={clickOn({ messageId: board.id })} />
            </BotLine>
          ) : (
            <p className="dc-meta p-4">No board yet. Add a printer and lab hours first.</p>
          )}

          {cards.length === 0 ? <p className="dc-meta px-4 pb-4">No requests yet. Book a print as a member and its card appears here.</p> : null}
          {cards.map((card) => (
            <BotLine key={card.id}>
              <Message payload={card.payload} busy={busy} onComponent={clickOn({ messageId: card.id })} />
              {card.logs.length ? (
                <details className="dc-thread">
                  <summary>
                    <MessageSquare size={13} aria-hidden /> Thread · {card.logs.length} update{card.logs.length === 1 ? "" : "s"}
                  </summary>
                  <ul>
                    {card.logs.map((line, index) => (
                      <li key={index}>
                        <Markdown text={line} />
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </BotLine>
          ))}

          <div className="dc-composer">
            <div className="flex flex-wrap gap-2">
              {commands.map(([label, name, sub]) => (
                <button key={label} type="button" className="dc-chip" disabled={busy} onClick={() => send({ kind: "command", name, sub, options: [] })}>
                  {label}
                </button>
              ))}
            </div>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void send({
                  kind: "command",
                  name: "printstaff",
                  sub: "close",
                  options: [
                    { name: "when", type: 3, value: closeForm.when },
                    { name: "reason", type: 3, value: closeForm.reason },
                    { name: "maintenance", type: 5, value: closeForm.maintenance },
                  ],
                });
              }}
            >
              <span className="dc-meta">/printstaff close</span>
              <input
                className="dc-input"
                placeholder="when: Fri 12:30-4pm"
                value={closeForm.when}
                onChange={(event) => setCloseForm({ ...closeForm, when: event.target.value })}
                required
              />
              <input
                className="dc-input"
                placeholder="reason: CSA meeting"
                value={closeForm.reason}
                onChange={(event) => setCloseForm({ ...closeForm, reason: event.target.value })}
                required
              />
              <label className="dc-meta inline-flex items-center gap-1">
                <input type="checkbox" checked={closeForm.maintenance} onChange={(event) => setCloseForm({ ...closeForm, maintenance: event.target.checked })} />
                maintenance
              </label>
              <button type="submit" className="dc-btn dc-btn-primary" disabled={busy}>
                <Send size={13} aria-hidden /> Send
              </button>
            </form>
          </div>
        </section>

        <aside className="flex min-w-0 flex-col gap-4">
          <section className="dc-channel" aria-label="#3d-printing">
            <header className="dc-channel-head">
              <Hash size={15} aria-hidden />
              3d-printing
              <span className="dc-meta ml-auto">public</span>
            </header>
            {publicBoard ? (
              <BotLine pinned>
                <Message payload={publicBoard.payload} busy={busy} onComponent={clickOn({ messageId: publicBoard.id })} />
              </BotLine>
            ) : (
              <p className="dc-meta p-4">Set PRINTQ_PUBLIC_CHANNEL_ID to post this board.</p>
            )}
          </section>

          <section className="dc-channel" aria-label="Direct messages">
            <header className="dc-channel-head">
              <MessageSquare size={15} aria-hidden />
              DMs to members
              <span className="dc-meta ml-auto">buttons act as the member</span>
            </header>
            {dms.length === 0 ? <p className="dc-meta p-4">No DMs yet.</p> : null}
            {dms.map((dm) => (
              <BotLine key={dm.id} note={`to ${dm.to}`}>
                <Message
                  payload={{ embeds: [{ title: dm.title, description: dm.body, color: 0x52a040 }], components: dm.components ?? [] }}
                  busy={busy}
                  onComponent={clickOn({ notificationId: dm.id })}
                />
              </BotLine>
            ))}
          </section>
        </aside>
      </div>

      {modal ? (
        <div className="dc-modal-backdrop" role="dialog" aria-modal="true" aria-label={modal.data.title}>
          <form
            className="dc-modal"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const fields = Object.fromEntries(
                modal.data.components.flatMap((row) => row.components).map((input) => [input.custom_id, String(form.get(input.custom_id) ?? "")])
              );
              const current = modal;
              setModal(null);
              const result = await send({ kind: "modal", customId: current.data.custom_id, fields }, current.source);
              if (result?.type === 7 && result.data && current.source.transient) {
                const next = result.data;
                setEphemerals((items) =>
                  items.map((item) => (item.payload.embeds === current.source.transient?.embeds ? { ...item, payload: next } : item))
                );
              }
            }}
          >
            <div className="dc-embed-title">{modal.data.title}</div>
            {modal.data.components
              .flatMap((row) => row.components)
              .map((input) => (
                <label key={input.custom_id} className="flex flex-col gap-1.5">
                  <span className="dc-field-name">
                    {input.label}
                    {input.required === false ? "" : " *"}
                  </span>
                  <input
                    name={input.custom_id}
                    className="dc-input"
                    defaultValue={input.value}
                    placeholder={input.placeholder}
                    required={input.required !== false}
                    maxLength={input.max_length}
                    autoFocus
                  />
                </label>
              ))}
            <div className="flex justify-end gap-2">
              <button type="button" className="dc-btn dc-btn-secondary" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button type="submit" className="dc-btn dc-btn-primary">
                Submit
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
