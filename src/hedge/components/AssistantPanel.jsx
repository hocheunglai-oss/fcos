import React, { useEffect, useRef, useState } from "react";
import { Bot, Send, Trash2, X } from "lucide-react";
import { calcSwapMtm } from "../lib/domain";
import { Button, IconButton } from "./ui";
import { runHedgeAssistant } from "@/hedge/api/backendFunctions";

const SUGGESTIONS = ["Any hedging gaps?", "MTM risk summary", "Suggest a hedge", "Position overview"];

export function AssistantPanel({ open, onClose, data, settings }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [loading, messages]);

  const sendMessage = async (text) => {
    const clean = text.trim();
    if (!clean || loading) return;
    const nextMessages = [...messages, { role: "user", content: clean }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    try {
      const physicals = [...data.physicals.filter((record) => !record.is_closed), ...data.physicals.filter((record) => record.is_closed)].slice(0, 30).map((record) => ({ product: record.product, qty_min: record.qty_min, qty_max: record.qty_max, sell_price: record.sell_price, buy_price: record.buy_price, sell_pricing_month: record.sell_pricing_month, buy_pricing_month: record.buy_pricing_month, delivery_date_from: record.delivery_date_from, counterparty: record.counterparty, vessel_name: record.vessel_name, trade_date: record.trade_date, is_closed: Boolean(record.is_closed) }));
      const swaps = [...data.swaps.filter((record) => !record.is_expired), ...data.swaps.filter((record) => record.is_expired).slice(0, 10)].slice(0, 50).map((record) => ({ product: record.product, direction: record.direction, swap_month: record.swap_month, quantity: record.quantity, unit: record.unit, price: record.price, venue: record.venue, broker: record.broker, trade_type: record.trade_type, is_expired: Boolean(record.is_expired), trade_date: record.trade_date, live_mtm: calcSwapMtm(record, data.mops, settings.general.sgo_bbl_per_mt, data.marketValuation)?.value ?? null }));
      const mops = [...data.mops].filter((record) => !record.is_estimate).sort((left, right) => String(right.price_date).localeCompare(String(left.price_date))).slice(0, 20).map((record) => ({ price_date: record.price_date, s380: record.s380, s05: record.s05, sgo: record.sgo }));
      const result = await runHedgeAssistant({ messages: nextMessages, physicals, swaps, mops });
      setMessages((current) => [...current, { role: "assistant", content: result?.reply || "The assistant returned no response." }]);
    } catch (error) {
      setMessages((current) => [...current, { role: "assistant", content: error.message || "The assistant is not available." }]);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;
  return (
    <div className="app-assistant-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="app-assistant" role="dialog" aria-modal="true" aria-labelledby="app-assistant-title">
        <header><span className="app-assistant__mark"><Bot size={20} /></span><div><h2 id="app-assistant-title">Trading assistant</h2><p>Live book context</p></div><IconButton label="Clear conversation" icon={Trash2} variant="quiet" onClick={() => setMessages([])} /><IconButton label="Close assistant" icon={X} variant="quiet" onClick={onClose} /></header>
        <div className="app-assistant__messages">
          {!messages.length && <div className="app-assistant__welcome"><Bot size={26} /><strong>Ask about the current book</strong><span>The assistant receives a compact snapshot of open positions and recent MOPS prices.</span></div>}
          {messages.map((message, index) => <div key={`${message.role}-${index}`} className={`app-assistant__message is-${message.role}`}>{message.content.split("\n").map((line, lineIndex) => <p key={lineIndex}>{line || " "}</p>)}</div>)}
          {loading && <div className="app-assistant__typing"><span /><span /><span /></div>}
          <div ref={bottomRef} />
        </div>
        {!messages.length && <div className="app-assistant__suggestions">{SUGGESTIONS.map((suggestion) => <button type="button" key={suggestion} onClick={() => sendMessage(suggestion)}>{suggestion}</button>)}</div>}
        <footer><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(input); } }} placeholder="Ask about positions, MTM, or hedging..." rows="2" /><Button variant="primary" icon={Send} onClick={() => sendMessage(input)} disabled={!input.trim() || loading}>Send</Button></footer>
      </aside>
    </div>
  );
}
