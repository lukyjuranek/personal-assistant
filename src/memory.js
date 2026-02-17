const conversations = new Map();

export function getConversation(userId) {
  if (!conversations.has(userId)) {
    conversations.set(userId, []);
  }
  return conversations.get(userId);
}

export function saveToHistory(userId, userMessage, reply) {
  const history = getConversation(userId);
  history.push({ role: 'user', content: userMessage });
  history.push({ role: 'assistant', content: reply });

  // Keep last 20 messages
  if (history.length > 20) {
    history.splice(0, history.length - 20);
  }
}

export function clearHistory(userId) {
  conversations.delete(userId);
}
