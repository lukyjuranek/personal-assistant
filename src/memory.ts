export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

const conversations = new Map<string, HistoryMessage[]>();

export function getConversation(userId: string): HistoryMessage[] {
  if (!conversations.has(userId)) {
    conversations.set(userId, []);
  }
  return conversations.get(userId)!;
}

export function saveToHistory(
  userId: string,
  userMessage: string,
  reply: string
): void {
  const history = getConversation(userId);
  history.push({ role: "user", content: userMessage });
  history.push({ role: "assistant", content: reply });

  if (history.length > 20) {
    history.splice(0, history.length - 20);
  }
}

export function clearHistory(userId: string): void {
  conversations.delete(userId);
}
