/No corresponding message entry (error not sent to API)/a\
  findChatEntryIndex(predicate: (entry: ChatEntry) => boolean): number {\
    return this.chatHistory.findIndex(predicate);\
  }\
\
  updateChatEntry(index: number, entry: ChatEntry): void {\
    this.chatHistory[index] = entry;\
  }
